# gildas-lormeau/SingleFile 深度调研报告

## 1. 宏观信息
- **仓库地址**: [gildas-lormeau/SingleFile](https://github.com/gildas-lormeau/SingleFile)
- **Stars**: ~20.6k
- **定位**: 可能是世界上最好的网页完全离线保存扩展。它可以将当前极其复杂的网页（甚至包含了几十个引用的 CSS 和数百张图）强行打包成一个极其干净且所见即所得的单一 `.html` 文件。
- **核心技术栈**: JavaScript, Web Extension API, Data URI 转换。

## 2. 核心架构与底层机制 (The Monolithic HTML Packer)
它的目的不是为了“爬取”特定的字段文本，而是为了保存网页在此时此刻的“绝对快照”。为了将网页扁平化，它在 Content Script 做了天量的清洗工作：

### 2.1 依赖剥离与 Data URI 内嵌 (Resource Virtualization)
- **图片处理**: 它遍历 DOM 树内所有的 `<img>`, `<picture>` 以及 CSS 中的 `url(xxx.png)`。通过发 Fetch 请求拿下图片的二进制 Blob 流，然后就地转化为 `data:image/xxx;base64,...`，最后直接替换掉 DOM 元素的 `src` 属性。
- **字体与样式 (CSS/Fonts)**: 遍历所有的 `link[rel="stylesheet"]`，拉取里面的原文，经过剔除无用样式 (`removeUnusedFonts`) 和重复项压缩合并后，将外链强行替换为内嵌的 `<style>` 标签。字体文件 (TTF/WOFF) 同样被抽取出 base64，塞回到 `@font-face` 声明中。
- **JavaScript 剥离**: 默认情况下，它会粗暴地移除页面内所有的 `<script>` 标签。这是因为它保存的是触发过事件、拉取过 Ajax 之后的“渲染后快照”。如果把 JS 也存进去，当你用浏览器打开这个离线 HTML 时，JS 重新运行会导致整个原本渲染好的页面发生不可逆的错乱或白屏。

### 2.2 大体量 IPC 通信瓶颈 (YABSON Compression)
- 当一个包含了大量高清图片的网页全部转换为 Base64 内嵌格式后，这个生成的巨型 HTML 文本往往会达到数十乃至数百兆字节。
- 此时，普通的 `chrome.runtime.sendMessage` 会因为无法承受单次几百兆的 JSON 序列化负荷而直接崩溃。
- SingleFile 采用了分块传输与定制的 `YABSON` (Yet Another BSON) 二进制流压缩算法。Content Script 将产物压缩后，分 Piece 切片推送给 Background Script，再统一由后台通过 `URL.createObjectURL` 唤起用户的下载框或推送到远端 WebDAV。

## 3. 总结与借鉴价值
SingleFile 给离线存储引擎提供了一套教科书级别的清洗管线。
在 WebEnvoy 的场景中：
1. **构建“视觉断言快照”**: Agent 在执行某些极度关键的操作（比如银行转账提交）时，可以调用一套类似于 SingleFile 的前端逻辑。把当前的页面（包含被填写的验证码图片、提示错误文字）**强行打包进一个 HTML 文件**。这个文件只包含纯 HTML/CSS，没有 JS，无论什么时候点开看，它都完美定格了那个瞬间的视觉呈现。这是做 Agent Debug 和留证的神器。
2. **剔除冗余干扰**: 学习它内嵌的 `removeUnusedFonts` 和 `removeAlternativeFonts` 算法逻辑，对于希望给 LLM 喂尽量少量 HTML 源码以降低 Token 消耗的框架非常有参考意义。
