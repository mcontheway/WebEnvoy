# putyy/res-downloader 深度调研报告

## 1. 宏观信息
- **仓库地址**: [putyy/res-downloader](https://github.com/putyy/res-downloader)
- **Stars**: ~15.8k
- **定位**: Go 语言编写的全平台万能网络资源嗅探与下载器，主打视频号、小红书、抖音等重度加密平台的无痕提取。
- **核心技术栈**: Golang, `goproxy` (MITM 代理), Vue (桌面端 UI), WebSocket。

## 2. 核心架构与底层机制 (MITM & Concurrent Downloader)
与 `cat-catch` (也是抓包引擎) 使用的 Chrome Extension `webrequest` API 不同，`res-downloader` 采取的是**更底层的操作系统级全局 MITM (中间人) 代理攻击**。

### 2.1 操作系统级中间人代理 (Proxy System)
在启动时，软件执行了极高权限的侵入式操作：
- **自签发与信任根证书 (`p.setCa()`)**: 动态生成私钥和公钥，并调用操作系统底层命令 (`core/system_darwin.go`, `system_windows.go`) 将该伪造证书强行塞入用户的全局根证书信任池。
- **全局流量劫持 (`goproxy`)**: 在本地开启一个 HTTP/HTTPS 透明代理，并将操作系统所有的系统网络流强行引流向自己。依靠此前种入的伪造根证书，它能够无缝解密（`goproxy.AlwaysMitm`）所有原本经过 TLS/SSL 加密的 HTTPS 流量。
- **特征靶向提取 (`httpResponseEvent`)**: 解密后的明文流量经过过滤器，依靠正则匹配 (如微信视频号的特定域名) 或 `Content-Type`，分离出图片、M3U8 视频流等媒体对象的直链，打上去重的 MD5 (`UrlSign`) 后通过 WebSocket 喂给前端面板。

### 2.2 多线程断点下载与逆向解密 (Download System)
它的下载引擎设计极其硬核，为反爬和速度做了极致优化：
- **Range 探针与并发切片 (`startDownloadTask`)**: 请求文件头 `HEAD` 时如果发现服务器支持 `Accept-Ranges`，它并是不单线拉取，而是立刻启动 `globalConfig.TaskNumber` 个 Go 协程。每个协程只负责文件的一小块（比如 `Range: bytes=100-200`），并利用 `File.WriteAt` 将散乱的二进制流无序但精准地拼接到同一个占位磁盘文件里。
- **端侧秘钥还原 (`r.decodeWxFile`)**: 对于微信视频号等加密流，由于 `res-downloader` 处于大流量通道的中间节点，它不仅拦截了媒体文件，还拦截了前端获取媒体文件之前的 JSON 鉴权包。它从 JSON 包中偷走了极其私密的 `decodeKey`。等视频底层加密字节流通过并发拉满下载到本地后，直接调用解密函数在本地生成能正常播放的 MP4。

## 3. 总结与借鉴价值
`res-downloader` 为我们展示了“降维打击”的暴力美学。
对 WebEnvoy 而言：
1. **全局 MITM 代理的恐怖威力**: 相比在前端改 JS 或者玩 Chrome extension，启动一个带自签证书的本地 Proxy Sidecar 是抓取网络层数据的唯一终极手段（参考之前 DonutBrowser 也是必须搭配 Proxy Sidecar）。WebEnvoy 可以考虑内置一个极简版本的局部 Proxy 给其自己启动的 Chrome 实例使用，专偷大体积媒体数据。
2. **异步秘钥窃取**: 在处理强对抗（视频号等）的网页元素分析时，DOM 和 Request 二者缺一不可。Agent 需要具备在 XHR JSON Responses 里提取鉴权信物并缓存的能力。
