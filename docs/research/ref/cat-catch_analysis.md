# xifangczy/cat-catch 深度调研报告

## 1. 宏观信息
- **仓库地址**: [xifangczy/cat-catch](https://github.com/xifangczy/cat-catch)
- **Stars**: ~18.4k
- **定位**: 著名的老牌“猫抓”浏览器资源嗅探扩展，主攻音视频提取与 M3U8/HLS 流媒体下载。
- **核心技术栈**: JavaScript, Chrome Extension API (MV3)。

## 2. 核心架构与底层机制 (Media Detection)
猫抓之所以能成为嗅探界的最强王者，其核心在于它构建了**三位一体**的媒体资源捕获网，覆盖了从网络层到底层缓冲区的全部生命周期：

### 2.1 Request Interception (发包层嗅探)
在 `background.js` 中，深度绑定 `chrome.webRequest` API：
- 利用 `onSendHeaders` 阶段进行早期的正则 URL 匹配过滤。
- 利用 `onResponseStarted` 在拿到请求头部时，通过深度解析 MIME type 和 Content-Disposition 头来确定是否是媒体文件。命中则无缝存入 `chrome.storage.session`。这能截获绝大多数标准的明文静态资源。

### 2.2 Cache Capture (内部缓冲层劫持)
针对 WebRTC 和动态流（Blob URL 播放），猫抓向页面强行注入 `catch.js` 去劫持底层的 `MediaSource` 对象：
- **Proxying `addSourceBuffer` / `appendBuffer`**: 每次视频播放器向内存写入视频数据流 (ArrayBuffer) 时，猫抓都会偷偷 copy 一份进自己的 `catchMedia` 数组中。
- 当触发 `endOfStream` 时，通过二进制特征码匹配（如找 MP4 的 `ftyp` 魔数，或 WebM 的 `0x1A45DFA3`）将所有碎片拼接还原为完整的视频文件，甚至能直接甩给外部的 FFmpeg 进程合并。这让那些隐藏真实请求地址的流媒体平台防线形同虚设。

### 2.3 Key Detection (暴力密钥搜刮)
为了解决 HLS / M3U8 的 AES-128 加密问题，猫抓在 `search.js` 中开启了近乎疯狂的 **JS 原型链全局劫持**：
- 它不仅拦截常规的 `fetch` 和 `XMLHttpRequest` 去寻找 `byteLength == 16` 的解密密钥缓冲。
- 更进一步劫持了 `JSON.parse`, `Array.prototype.slice` (专门找切片长度为 16 的变基操作), 各种类型化数组构造器 (`Uint8Array`, `Uint32Array`), 哪怕是针对加密文本的 `btoa`/`atob` (专逮 24 字符 base64 结尾含 `==` 的特征) 和 `DataView` 全都不放过。
- 只要在内存流动过任何疑似 16 字节的密钥序列，都会被 `postMessage` 踢给 Background 用于自动化解密。

## 3. M3U8 / HLS 下载分发架构
由于长期受困于浏览器对单文件大小和持续下载时间的限制，它的 M3U8 处理极为完善：
- 内部利用 `hls.js` 进行纯解析，将庞大的切片分发逻辑转化为对象树 (`m3u8.js`)。
- **降维打击 - 唤起本地下载器**: 支持构造自定义前缀的 `m3u8dl://` URL Scheme。点击下载时，浏览器直接唤起计算机本地同名的专业下载器程序（并附带上文暴力扒出来的解密 Keys 和参数），彻底绕过浏览器本身的沙盒存储硬伤。
- **浏览器内极限存储 (Stream Saver)**: 针对没有本地下载器的场景，接入 `StreamSaver.js` 以便让合成超过 2GB 内存配额门槛的超大混合流媒体可以直接串流写入用户硬盘。

## 4. 总结与借鉴价值
猫抓项目的核心价值不在于外层 UI，而是它为了“拿到数据”所采用的 **极致的 JS API Proxy 代理思想**。
在 WebEnvoy 的自动化或数据采集中，如果我们面临的是数据被反爬脚本混淆加密，前端仅通过 Canvas 或 Media 解析渲染的场景。我们完全可以复用这种：**预先注入 Content Script，暴力劫持/覆写底层类型构造函数 (如 ArrayBuffer, JSON, Atob) 的窃听思路**。
与其绞尽脑汁去推导后端的加密 JS 算法逻辑，不如直接在前端引擎解释环境的最底层“守株待兔”拦截明文结果，这是一种非常高效且通用的降维破解手段。
