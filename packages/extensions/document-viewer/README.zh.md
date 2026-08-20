# `@deepseek-ai/dsh-document-viewer`

[English](README.md) | 中文

以双端 Cordis 插件提供桌面端 Workspace 文档预览。Host 面只读、受限地提供已注册 Workspace 内的文档内容；Web Client 面把 PDF、DOCX、PPTX 与 Markdown 渲染器注册到 `dsh-better-sidebar`，不再增加另一套文件浏览器或侧边栏入口。桌面端 patch 默认启用两个包，共享 Web profile 不会自动包含它们。

本包为私有包，仅随 DSH Desktop Community 安装程序分发。

## 使用方法

1. 打开一个 DSH Workspace，点击右上角的**展开侧边栏**。
2. 使用 Better Sidebar 现有的文件树或文件名搜索。
3. 选择受支持的文件；预览会在文件树旁的现有编辑器标签页中打开。

界面中不再有单独的**文档**入口。文件标签页、目录导航、搜索、刷新、窄屏布局和请求取消继续由 Better Sidebar 持有。关闭标签页或选择其他文件会中止上一次自定义加载；PPTX 预览卸载时还会调用 `destroy()`。

| 格式 | 渲染器 |
|---|---|
| PDF | 同源 sandbox iframe，使用 Chromium 内置 PDF 查看器 |
| Markdown（`.md`、`.markdown`） | 共用 `MarkdownText`，支持 GFM、代码和 TeX；不加载 Workspace 相对资源 |
| DOCX | `docx-preview`，禁用 `altChunk` 渲染和链接跳转 |
| PPTX | `@aiden0z/pptx-renderer`，启用媒体与幻灯片懒加载、窗口化列表和压缩包限制 |

不支持旧版 DOC/PPT、含宏或加密的 Office 文档、编辑、写入、递归索引和文件监听。

## Better Sidebar 集成

Client 插件注入 `betterSidebar`、`workspaces` 和 `locale`，再以优先级 `100` 为 `pdf`、`docx`、`pptx`、`md` 与 `markdown` 注册一个 `custom` 文件查看器。Better Sidebar 把所选绝对路径和会话 scope 交给 loader。loader 按会话成员关系找到已注册 Workspace，把选择结果转换成非空的 Workspace 相对 POSIX 路径，并且只请求本包的内容路由。React 组件只接收已加载的文档数据，不读取 Cordis 或本机路径。

桌面端 composition 只会在之前的用户 profile bundle 没有提供启用中的实例时挂载 `dsh-better-sidebar`。已有侧边栏及其偏好设置继续生效，新建桌面 profile 也会获得同一套文件管理界面。

## Host 路由

`GET|HEAD /document-viewer/content?workspaceId=&path=` 以准确 MIME、`nosniff`、内联文件名和 ETag 提供单个受支持文件，并实现单段字节 Range 的 `206`／`416` 行为。DOCX 与 PPTX 会在发送响应头之前扫描 ZIP 中央目录；加密、损坏、条目过多或解压体积过大的压缩包会被拒绝。

路由只接受所选已注册 Workspace 内的相对 POSIX 文件路径。绝对路径、空路径、点段、NUL、反斜杠、编码分隔符、符号链接、junction 和解析后逃逸都会被拒绝，响应不会返回 Host 绝对路径。目录浏览和搜索继续由 Better Sidebar 负责，因此本包不再暴露重复的目录列表路由。

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `maxFileBytes` | 64 MiB | 可提供或扫描的最大文档大小 |
| `maxExpandedBytes` | 256 MiB | OOXML 解压后总大小上限 |
| `maxArchiveEntries` | 4096 | OOXML 中央目录条目数上限 |

Client bundle 元数据声明 `dsh.client.platform: web`；Host 与 Client 使用独立 TypeScript face，产出 `lib/index.js`、`lib/invariant.js` 和 `lib/client.js`。

## 模型体验

### Workspace 文档预览

#### 模型看到的内容

无；`document-viewer` 注册浏览器 renderer 和只读 Host 内容路由，不添加提示词、工具或请求内容。

#### Token 影响

无；预览文档字节和 renderer 状态不会进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider request。

## 已知限制与延期工作

- Office 排版为近似渲染，不承诺与 Microsoft Office 像素一致。
- Markdown 中的 Workspace 相对图片和链接不会被解析。
- PDF 展示依赖 Chromium 内置的 PDF 支持。
- 在桌面端 composition 之外，Client contribution 会保持未激活，直到存在兼容的 Better Sidebar service。
