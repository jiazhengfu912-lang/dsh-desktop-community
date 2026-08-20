# Agent Note: 桌面 Renderer 权限与单实例

Status: implemented

[English](2026-08-20-desktop-renderer-authority-and-single-instance.md) | 中文

## 问题

应用窗口和启动窗口共享同一个受限 preload，但具备权限的 IPC handler 接收消息时没有证明消息来自哪个当前窗口和 frame。因此，陈旧窗口、子 frame 或由 renderer 导航后的文档可能继续持有 Host API 权限。窗口也允许 renderer 请求的导航和子窗口，使 preload 扩展到主进程没有选择的文档。

Desktop 进程所有权使用 Electron `userData` 下的 PID 文件。先检查 PID 再写入文件并不具备原子性，PID 复用可能标识无关进程，文件错误还会允许启动流程继续成为另一个主实例。载体还通过 semver 范围解析到已不受支持的 Electron 36 运行时系列。

## 决策

`RendererAuthority` 将每个固定的 renderer 到主进程 channel 分配给应用或启动窗口角色。只有当 sender 是该角色当前的 `WebContents`、`senderFrame` 是该 WebContents 当前的主 frame，且 frame 具有该角色的准确 URL 和 origin 时，消息才获得授权。事件式未授权消息会被忽略，未授权 invoke handler 会拒绝调用，同步存储读取不会返回已存数据。`rendererReady`、`rendererFailed`、`retry` 和 `quit` 生命周期 channel 使用相同检查。注册会返回一个捕获准确 WebContents 的幂等退出函数，因此 `closed` 回调不会读取已经销毁的 BrowserWindow。

每个由主进程创建的应用或启动窗口都会在加载文档前安装 `denyRendererNavigation`。该 guard 会取消 `will-navigate` 和 `will-redirect`，并从 `setWindowOpenHandler` 返回 `deny`。Electron 不会为主进程的 `loadURL`、`loadFile` 或重新加载操作发出 `will-navigate`，因此生命周期仍独占文档替换控制权。主进程也会拒绝 renderer 更新页面标题，使可见窗口保持固定的社区产品名称。

进程会在 `app.whenReady()` 前调用 `app.requestSingleInstanceLock()`。未获得锁的进程不会启动 Host，而是直接退出；主实例订阅 `second-instance`。`SecondInstanceFocus` 会聚焦或恢复当前可见的启动／应用窗口，并在聚焦目标尚不存在时保留一个请求。该机制既不写入协调文件，也不写入 `DSH_HOME` 数据。

Desktop 应用和 Electron 目录选择器的开发依赖闭包将 Electron 固定为 `43.4.1`；目录选择器的 peer 接受受支持的 43.x 主版本。使用到的唯一 Electron 43 breaking behavior 是未提供 `defaultPath` 时，原生目录对话框改为默认打开 Downloads 目录；工作区选择器接受该行为。代码没有使用已移除的 Electron API。

## 验证

- Renderer 测试只接受当前角色，并拒绝已替换的 WebContents、子 frame 和错误 URL/origin。
- 窗口 guard 测试会取消导航和重定向，并拒绝 renderer 子窗口请求。
- Renderer 退出测试会在 BrowserWindow 不再可访问后释放预先捕获的 WebContents。
- 单实例测试覆盖锁被拒绝、聚焦目标就绪前后的第二实例聚焦，以及已销毁的陈旧目标。
- 打包后的可见 GUI 运行会观察一次保持响应的启动窗口到主窗口交接，并确认没有应用菜单或错误窗口且产品标题固定。
- 桌面测试和两个 TypeScript face 都针对已安装的 Electron `43.4.1` 声明与二进制运行。

## 备选方案

**只检查 `event.sender`。** 未采用，因为它不能区分主 frame 与 iframe，也不能证明 WebContents 仍显示主进程选择的文档。

**只检查 URL 或 origin。** 未采用，因为同 origin 的陈旧窗口仍会获得授权。WebContents identity、主 frame identity、准确 URL 和 origin 必须共同满足。

**保留 PID 和聚焦请求文件。** 未采用，因为相互独立的文件系统检查不能提供原子化进程所有权，还会把 I/O 失败转化为不安全的第二主实例。Electron 已提供平台相关的原子锁和聚焦事件。

**禁用回环 HTTP 和 WebSocket 路由。** 未采用，因为生成的 Remotes 和已安装客户端插件依赖这些路由。本次变更限制 preload IPC 权限，但不改变回环传输组合。

**保留 Electron 主版本范围。** 未采用，因为可复现的桌面产物及其原生模块构建目标必须使用锁文件记录的已审查运行时。补丁升级是显式依赖变更。

## 后果

renderer 创建的外部窗口和文档导航会被拒绝，直到未来新增由主进程明确授权目标的操作。受损子 frame、陈旧 WebContents 或错误文档无法调用具备权限的 Desktop IPC。并发启动使用 Electron 进程所有权而不触碰 Host 数据，而 Web 与 Desktop 仍需分别负责避免同时打开同一个 `DSH_HOME`。Electron 补丁更新需要显式修改 manifest 和锁文件；除非应用以后持有并提供 `defaultPath`，原生工作区选择器现在会从 Downloads 目录开始。
