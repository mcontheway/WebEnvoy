# Spike：official Chrome 137+ 持久扩展与 runtime bootstrap 解耦

> 关联事项：Refs #280, #281, #233, #239
> 状态：admission-ready spike input for #279
> 更新时间：2026-03-26

## 背景与问题定义

WebEnvoy 当前浏览器运行时主链，默认建立在“official Chrome + per-run staged extension + CLI 每次启动时把 run/profile/fingerprint bootstrap 一并塞进扩展包”的前提上。

这一前提在 official branded Google Chrome 137+ 上已经失效：Chrome branded build 不再支持通过 `--load-extension` 在命令行注入 unpacked extension；后续版本还继续收紧配套扩展 flag。若仍坚持 official Chrome 作为 stealth 主运行时，就不能再把“扩展安装”与“单次运行上下文注入”耦合成同一步骤。

本 spike 的目标不是设计最终实现，也不是继续修 launcher，而是回答以下 Go / No-Go 问题：

1. official Chrome 137+ 下，持久安装扩展是否能成为稳定主链。
2. 当前 per-run bootstrap payload 是否能从“扩展包内容”迁移为“runtime 上下文输入”。
3. extension ID / profile / native messaging / main-world trust 在新模式下如何重新划边界。
4. developer mode 与 stealth 风险是否仍在可接受范围内。
5. 证据是否足以进入 #279 的 architecture/spec PR。

## 非目标

- 不在本 spike 中修改正式架构文档。
- 不在本 spike 中实现运行时代码或迁移脚本。
- 不把 Chromium / Chrome for Testing 包装成 stealth 主路径答案。
- 不把企业策略强制安装、Chrome Web Store 正式分发、签名打包流程一次性设计完。
- 不在本 spike 中承诺解决 Worker 线程、Layer 3/4 行为模型等既有反风控长线问题。

## 现有架构为什么不成立

当前仓库里的主链假设，已经直接体现出“扩展随 run 一起被 staging”的设计：

- [extension/content-script.ts](/Users/mc/dev/WebEnvoy-wt-280/extension/content-script.ts) 在启动时读取全局 `__webenvoy_fingerprint_bootstrap_payload__`，并兜底读取扩展包内的 `__webenvoy_fingerprint_bootstrap.json`。
- [extension/background.ts](/Users/mc/dev/WebEnvoy-wt-280/extension/background.ts) 通过内存态 `trustedFingerprintContexts`、startup trust 和 Native Messaging 握手来维护当前 session 的可信上下文。
- [src/commands/runtime.ts](/Users/mc/dev/WebEnvoy-wt-280/src/commands/runtime.ts) 在每次 `runtime.ping` 时临时拼装 `fingerprint_context`，再透传到 runtime bridge。
- [extension/manifest.json](/Users/mc/dev/WebEnvoy-wt-280/extension/manifest.json) 当前没有 `key`，意味着 unpacked 安装时 extension ID 不具备稳定契约。

这套模型的问题不只是“启动参数变了”，而是三个边界原先被混在一起：

1. 扩展安装载体：扩展文件如何进入 Chrome。
2. 持久身份边界：哪个 profile 绑定哪个 extension ID / native host allowlist。
3. 单次运行上下文：run_id / session_id / fingerprint runtime / main-world secret 如何进入已安装扩展。

在 `--load-extension` 可用时，三者可以被同一次启动过程偷懒打包。Chrome 137+ 后，这种偷懒路径不再成立。

## 关键未知项与实验方法

| 证据项 | 问题 | 方法 |
|---|---|---|
| E1 | official Chrome branded build 是否真的不再允许 `--load-extension` | 核对 Chromium Extensions 公告；本机确认 official Chrome 版本 |
| E2 | 配套扩展 flag 是否继续收紧 | 核对 Chromium Extensions 后续公告 |
| E3 | 持久安装扩展是否具备稳定 extension ID 契约 | 核对 Chrome manifest `key` / Native Messaging 官方文档；检查仓库当前 manifest |
| E4 | Native Messaging 是否天然依赖稳定 extension ID | 核对官方 Native Messaging 文档 |
| E5 | 当前 per-run bootstrap payload 的真实承载点在哪里 | 阅读仓库 `runtime.ts` / `background.ts` / `content-script.ts` |
| E6 | 单次运行上下文能否从扩展包内容中剥离 | 基于现有代码路径做输入边界分析 |
| E7 | developer mode / unpacked 安装风险是否可作为 stealth 主路径接受 | 核对 Chrome 官方/Chromium 公告，结合威胁模型做判断 |
| E8 | official Chrome profile 中是否存在持久扩展与 Native Messaging 的标准落点 | 本机查看 Chrome user data / NativeMessagingHosts 目录 |

## 证据结果

### E1. official Chrome 137+ 下 `--load-extension` 作为 branded build 主链已失效

结论：`primary`

- Chromium Extensions 公告明确说明：自 Chrome 137 起，official Chrome branded builds 移除 `--load-extension`；该变化不适用于 Chromium / Chrome for Testing。
- 这不是推测，也不是单个自动化框架回归；Chromium 团队将其定义为官方安全收紧动作。
- 本机已确认安装的是 official Google Chrome `146.0.7680.165`，因此继续依赖 branded Chrome 命令行注入 unpacked extension 不具备可持续性。

对 WebEnvoy 的含义：

- 当前“official Chrome + per-run staged extension”不能继续作为正式主路径。
- 若继续坚持 official Chrome 主路径，就必须把扩展安装改为持久存在。

### E2. Chrome 139 继续移除 `--disable-extensions-except` 等配套 flag

结论：`primary`

- Chromium Extensions 后续公告显示，Chrome 139 branded builds 又继续移除 `--disable-extensions-except` 与 `--extensions-on-chrome-urls`。
- 这说明 Chrome 的方向不是“只禁一个 flag，其他 staging 手段仍可长期依赖”，而是持续关闭 branded build 上的命令行扩展装载/隔离旁路。

对 WebEnvoy 的含义：

- 不能把 #279 定义成“再找一个命令行旗标替代 `--load-extension`”。
- 新架构必须假设“扩展已预先存在于 profile 中”，而不是启动时动态注入。

### E3. extension ID 必须从“临时生成”升级为正式稳定边界

结论：`primary`

- Chrome 官方 manifest 文档明确提供 `key` 用于保持 extension ID 稳定。
- Native Messaging 官方文档要求 host manifest 使用精确的 `allowed_origins = ["chrome-extension://<id>/"]`，不支持通配。
- 当前仓库的 [extension/manifest.json](/Users/mc/dev/WebEnvoy-wt-280/extension/manifest.json) 没有 `key`，因此 unpacked/developer-mode 路径下 extension ID 不能被视为正式契约。

对 WebEnvoy 的含义：

- 新主链里，extension ID 不能再是每次 staging 后顺手得到的副产物。
- #279 必须冻结一个稳定 ID 策略，否则 native messaging 注册、profile 绑定、升级与回滚都无法形成正式边界。

### E4. Native Messaging 天然要求“稳定 extension identity”

结论：`primary`

- Chrome Native Messaging 官方文档明确要求 host manifest 用 `allowed_origins` 显式列出 extension origin。
- 官方文档还说明 native host 启动时会收到调用者 origin，说明 extension identity 是 Native Messaging 信任边界的一部分，而不是可忽略实现细节。

对 WebEnvoy 的含义：

- “持久扩展 + runtime bootstrap 解耦”不等于把 extension identity 弱化，反而要求先把 identity 稳定下来。
- 对于 #279，native host 注册模型应围绕“稳定 extension ID + 可追溯 origin”展开，而不是围绕 run 级临时包名或临时目录。

### E5. 当前 per-run bootstrap payload 实际分成两类

结论：`primary`

从代码阅读可以把当前 bootstrap 内容拆成两类：

1. 静态扩展资产
   - background / content-script / main-world bridge 代码
   - host permissions / content_scripts / Native Messaging permission
   - 与 run 无关的默认行为
2. 单次运行上下文
   - `run_id`
   - `session_id`
   - `profile`
   - `fingerprint_runtime`
   - `fingerprint_patch_manifest`
   - `main_world_secret`
   - 某次执行的 trust priming / startup trust

当前问题是第二类上下文部分仍通过 `__webenvoy_fingerprint_bootstrap.json` 和启动阶段的隐式 global 注入承接，这本质上依赖“扩展包是 per-run staging 产物”。

对 WebEnvoy 的含义：

- 真正需要解耦的不是所有 bootstrap，而是“把单次运行上下文从扩展文件内容里剥离出来”。
- 这为新架构提供了明确拆分面：扩展持久安装，run 上下文另行注入。

### E6. 单次运行上下文可以从“扩展包内容”迁移到“runtime 输入通道”

结论：`admission_ready`

基于当前代码结构，可以收敛出一个更合理的输入边界：

- 持久扩展只承载长期代码与权限。
- CLI / runtime controller 只在 run 开始时发送一次 `runtime bootstrap envelope`。
- extension background 负责把该 envelope 绑定到 `(profile, session_id, run_id)`。
- content script / main-world bridge 只从 background 拉取本次允许的 runtime 上下文，不再依赖扩展包内 per-run JSON 文件。

为什么这个结论已经到 `admission_ready`：

- 仓库代码已存在 background 内存态 trusted context、session 维度清理、profile 维度清理等机制，说明“上下文由 background 维护”并非新概念。
- 当前 `runtime.ts -> transport -> background -> content-script` 已有参数透传链，不需要凭空发明第二套总线。
- 需要冻结的是契约，而不是先做代码证明。

对 #279 的直接输入：

- 应新增正式对象，例如 `runtime_bootstrap_envelope` 或等价对象名。
- 它必须属于 run/session 级输入，不属于扩展安装资产，也不属于 profile 永久元数据。

### E7. developer mode / unpacked 安装不能直接被视为 stealth 主路径

结论：`candidate`, not `admission_ready`

已知事实：

- Chrome 在 133 收紧了 unpacked extension 与 developer mode 的关系。
- 137/139 进一步持续关闭 branded build 的命令行装载旁路。
- 137 官方建议之一仍是通过 `chrome://extensions` 的 “Load unpacked” 手工安装扩展。

但对 WebEnvoy 的威胁模型而言，这还不够：

- “官方允许开发时这么做”不等于“高防 stealth 主路径应长期依赖 developer mode”。
- developer mode 是明显的浏览器运行状态变化；本 spike 没有一手证据证明其在目标平台上一定触发风控，但也没有足够证据证明可以当正式隐身主路径忽略。

因此本 spike 的收敛是：

- unpacked + developer mode 可以作为过渡实验路径或内部 candidate。
- 它不能在 #279 被直接冻结成最终 stealth 主路径。
- #281 后续必须保留“从 developer-mode candidate 迁移到更稳定安装/升级机制”的开放空间。

### E8. official Chrome profile 已天然具备“持久扩展 + Native Messaging”落点

结论：`primary`

本机观察到 official Chrome user data 下已有：

- `~/Library/Application Support/Google/Chrome/<Profile>/Extensions/<extension-id>/...`
- `~/Library/Application Support/Google/Chrome/<Profile>/Local Extension Settings/<extension-id>/...`
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/*.json`

这说明 Chrome 自身已提供持久扩展与 Native Messaging 的标准承载位置，WebEnvoy 不需要自造 profile 内的“伪扩展安装层”。

对 WebEnvoy 的含义：

- 新主链可直接建立在 Chrome 原生持久 profile 语义之上。
- profile 绑定的重点不再是“每次启动复制扩展进去”，而是“某个 profile 是否已经拥有 WebEnvoy 扩展、其 ID 是什么、其 host manifest 是否匹配”。

### E9. 持久安装不等于“只能手工 Load unpacked”，但安装路径仍需分级

结论：`candidate`

从安装/分发角度，目前至少能看见三类方向：

1. `developer mode + Load unpacked`
   - 可作为当前过渡实验路径。
   - 不能作为 #280 阶段的正式 stealth 主方案。
2. `External Extensions JSON`、Windows 外部安装/注册表写入 + 用户确认启用
   - 说明持久安装并不等于每次都手工去点 `Load unpacked`。
   - 这类路径有机会降低安装摩擦，可作为后续持久安装候选路径。
   - 但它们是否满足 WebEnvoy 的 stealth、升级、跨平台一致性与用户体验目标，当前证据仍不足。
3. Chrome Web Store / 合规上架分发
   - 这是“更产品化、更合规”的潜在长期方向。
   - 它能帮助降低 developer mode 依赖，并改善用户安装心智。
   - 但它不属于本次 #280 spike 的阻断判断，当前不进入正式主结论。

对 WebEnvoy 的含义：

- #280 阶段只需要冻结“必须走持久安装扩展 + runtime bootstrap 解耦”。
- 至于最终选择 `External Extensions`、Windows 外部安装、Chrome 商店分发还是其他安装渠道，应在后续安装/分发专题中继续验证。
- 因此这些路径目前都只能作为 `candidate` 或“后续方向”，不能替代当前主结论。

## 证据分级汇总

| 结论 | 分级 | 说明 |
|---|---|---|
| official Chrome 137+ branded build 不再适合 `--load-extension` 主链 | `primary` | 已有 Chromium 官方公告 |
| 139 持续移除配套扩展 flags | `primary` | 说明不是一次性例外 |
| 持久扩展需要稳定 extension ID | `primary` | 受 `manifest.key` 与 Native Messaging `allowed_origins` 约束 |
| 当前 bootstrap 必须拆成“静态扩展资产”与“run 级上下文” | `primary` | 仓库代码已能定位真实耦合点 |
| runtime bootstrap envelope 可作为正式解耦方向 | `admission_ready` | 与现有 background/session/trust 结构兼容 |
| `External Extensions` / Windows 外部安装 + 用户确认 | `candidate` | 可作为持久安装候选路径，不是当前冻结主方案 |
| developer mode / unpacked 可暂作过渡路径 | `candidate` | 证据不足以直接冻结为 stealth 最终主链 |
| Chrome Web Store / 合规分发 | `candidate` | 值得继续评估，但不属于本次 spike 主结论 |
| Chromium / Chrome for Testing 可继续支持命令行装载 | `fallback` | 可用于开发验证，不可作为 stealth 主路径答案 |

## Go / No-Go 判断

结论：**Go**

但这里的 Go 不是“可以进入实现”，而是：

- 可以进入 #279 的 architecture/spec PR。
- 可以把正式主方向冻结为“official Chrome 持久安装扩展 + runtime bootstrap/context 解耦”。
- 不可以继续把 `per-run staged extension` 当作 official Chrome 主路径。

同时保留三条硬约束：

1. 不把 developer-mode unpacked 直接冻结成 stealth 最终答案。
2. 不把 Chromium / Chrome for Testing 从 fallback 偷换成主路径。
3. 不在 architecture PR 中跳过 extension ID、bootstrap envelope、profile 绑定三个正式边界。

## 推荐架构方向

### 1. 运行时分层重画

- **安装层**：WebEnvoy 扩展作为 profile 内持久安装资产存在。
- **身份层**：每个 profile 绑定稳定 extension ID、Native Messaging origin allowlist、扩展版本信息。
- **运行层**：每次 run 通过显式 bootstrap envelope 注入 `run_id/session_id/profile/fingerprint_runtime/main_world_secret`。

### 2. bootstrap 输入路径重画

推荐主路径：

1. CLI / runtime controller 启动或附着到指定 profile。
2. runtime controller 校验该 profile 已安装受信任的 WebEnvoy 扩展，且 extension ID 与 native host allowlist 匹配。
3. CLI 通过现有 transport 向 background 发送本次 `runtime_bootstrap_envelope`。
4. background 将 envelope 绑定到 `(profile, session_id, run_id)` 并缓存为本次 trusted context。
5. content script 在目标 tab 文档开始阶段向 background 拉取或接收当前 session 的 trusted context。
6. main-world patch 仅消费 background 已批准的 runtime 上下文，不再读取扩展包内 per-run JSON 文件。

### 3. 扩展升级路径重画

- 升级单位应从“每次 run 的 staged 扩展目录”改为“profile 中已安装扩展版本”。
- profile 元数据里应能追溯：
  - `extension_id`
  - `extension_version`
  - `install_channel`
  - `bootstrap_contract_version`
- 升级时优先保证 ID 不变、Native Messaging allowlist 不变、bootstrap contract 显式版本化。

## 对 #279 的明确输入

#279 至少应冻结以下正式边界：

1. **official Chrome 主路径修正**
   - branded Chrome 主路径不再依赖 `--load-extension`
   - Chromium / Chrome for Testing 仅作为开发/验证 fallback

2. **extension identity 契约**
   - 稳定 `extension_id` 成为正式架构对象
   - Native Messaging allowlist、profile 绑定、升级路径均围绕该对象展开

3. **bootstrap 契约**
   - 新增 run/session 级 `runtime_bootstrap_envelope`
   - 明确它承载哪些字段，不承载哪些永久元数据

4. **profile 契约扩展**
   - 现有 `profile` 模型需要新增 extension 安装状态与版本追踪字段
   - 但不得把 run 级上下文写回 profile 永久元数据

5. **trust ownership**
   - background 是 runtime trust 的唯一会话态承载点
   - content script / main-world 只消费已批准上下文
   - 不再从扩展包静态文件直接读取本次运行信任载荷

6. **developer mode 定位**
   - 只能作为 candidate / transition path
   - 不作为 stealth 正式终局承诺

7. **安装/分发路径分级**
   - `External Extensions`、Windows 外部安装/注册表 + 用户确认 可作为持久安装候选路径
   - Chrome Web Store / 合规上架可作为后续产品化方向
   - 上述路径均不替代本次必须先冻结的 runtime / identity / bootstrap 边界

## 对 #281 的输入

- #281 应把问题正式定义为 runtime 架构迁移，而不是 launcher 兼容补丁。
- 迁移主线至少拆为：
  - 持久扩展身份与安装模型
  - runtime bootstrap envelope 契约
  - profile / extension / native host 绑定与升级
  - developer-mode 过渡路径与终局替代路径
  - 验证与回归归口到 #239

## 对 #239 的输入

后续验证主线至少需要新增以下基线：

1. profile 首次安装、重启后、升级后，extension ID 是否稳定。
2. native host allowlist 与 extension origin 是否持续匹配。
3. bootstrap envelope 丢失、版本不匹配、session 漂移时，background 是否阻断 live。
4. developer-mode candidate 与更稳定安装路径在目标平台上的风险差异样本。

## 明确非目标与保留事项

以下事项本 spike 明确不冻结：

- 具体采用 Chrome Web Store、企业策略、离线打包还是其他安装分发机制作为最终安装渠道。
- developer mode 是否一定导致平台风控升级。
- 完整实现 bootstrap handshake、安装器、迁移脚本、扩展升级器。
- Layer 1 指纹、Layer 2/3 行为节律等其他反风控长期事项。

## 本次实验与阅读记录

本 spike 使用了以下本地证据方法：

- 阅读仓库文档：
  - `vision.md`
  - `docs/dev/roadmap.md`
  - `docs/dev/architecture/anti-detection.md`
  - `docs/dev/architecture/system-design/execution.md`
  - `docs/dev/architecture/system-design/account.md`
  - `docs/dev/architecture/system-design/communication.md`
  - `docs/dev/specs/FR-0012-layer1-fingerprint-profile-consistency/spec.md`
- 阅读相关 issue：`#280`, `#279`, `#281`, `#233`, `#239`
- 阅读代码：
  - [extension/content-script.ts](/Users/mc/dev/WebEnvoy-wt-280/extension/content-script.ts)
  - [extension/background.ts](/Users/mc/dev/WebEnvoy-wt-280/extension/background.ts)
  - [src/commands/runtime.ts](/Users/mc/dev/WebEnvoy-wt-280/src/commands/runtime.ts)
  - [extension/manifest.json](/Users/mc/dev/WebEnvoy-wt-280/extension/manifest.json)
- 本机环境探查：
  - `'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --version`
  - `find ~/Library/Application\\ Support/Google/Chrome -maxdepth 3 \\( -path '*/Extensions/*' -o -path '*/Local Extension Settings/*' -o -path '*/NativeMessagingHosts/*' \\)`

## 外部资料

- Chromium Extensions: [PSA: Removing `--load-extension` flag in Chrome branded builds](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY)
- Chromium Extensions: [PSA: Removing `--extensions-on-chrome-urls` and `--disable-extensions-except` flags in Chrome branded builds](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/FxMU1TvxWWg)
- Chromium Extensions: [RFC: Removing the `--load-extension` flag in branded Chrome builds](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/aEHdhDZ-V0E)
- Chrome for Developers: [Manifest - key](https://developer.chrome.com/docs/extensions/reference/manifest/key?hl=zh-CN)
- Chrome for Developers: [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
