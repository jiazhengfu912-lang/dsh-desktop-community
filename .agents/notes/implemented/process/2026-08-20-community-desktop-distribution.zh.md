# Agent Note: 社区桌面发行

Status: implemented

[English](2026-08-20-community-desktop-distribution.md) | 中文

## 问题

上游 monorepo 不发布这个由社区维护的 Windows 桌面安装程序。直接从混合开发工作区分发安装程序，会导致其源码来源、产品身份、许可证载荷、插件依赖版本和数据复用声明难以验证。复用上游产品美术资源或承诺完整的 Web 到 Desktop 迁移，也会错误描述该软件包实际拥有的内容。

## 决策

本仓库以 **DSH Desktop Community** 发布应用，使用 app id `io.github.jiazhengfu912.dshdesktop`、独立美术资源和固定的 `DSH-Desktop-Community-Setup-x64.exe` 产物名称。面向用户的材料通过[上游 DSH 仓库](https://github.com/deepseek-ai/deepseek-harness)进行归属说明，同时声明该发行版由社区独立维护，未经 DeepSeek 背书。内部 `@deepseek-ai/*` 包名保持为兼容标识符。

Desktop 应用、社区品牌、文档查看器和 Electron 目录选择器包均为社区私有组装包。它们的 manifest 指向本仓库并省略 npm 发布元数据，因此上游 DSH 发布路径会拒绝把它们作为官方包发布。

官方美术资源由 `ui-brand-official` 持有；通用侧边栏与会话包不提供产品美术 fallback。Desktop 构建器从应用目录排除官方品牌、徽章技能和未使用的 Web frontend 包，Desktop overlay 则安装 `ui-brand-community`。该插件还会遮蔽 `settings.onboarding` 中名为 `welcome-notice` 的单元并在不渲染内容的情况下完成它，因此 Desktop 应用不会继承上游产品专属的测试声明；共享 Web 插件及其确认记录保持不变。overlay 会把 `DSH Desktop Community` 作为模型可见的部署身份，同时保持共享 system-prompt 默认值不变。打包验证会拒绝已排除的包目录、鲸鱼资源、`logo=deepseek` 标记以及 renderer 和配置文本中的官方美术或产品名称 token；兼容包名仍然允许。

发行构建从 `build-info.json` 记录的仓库 commit 开始，包含 `LICENSE` 和 `THIRD_PARTY_NOTICES.md`，并通过 GitHub Releases 发布安装程序、`SHA256SUMS.txt` 和构建信息。软件包组装会禁止 Electron Builder 自动发布；只有经过验证的 GitHub Release 步骤负责发布产物。安装程序不作为 Git blob 存储。未签名的预览版保持普通 latest release，使固定的 `/releases/latest/download/DSH-Desktop-Community-Setup-x64.exe` URL 能够解析；发行说明明确缺少签名及其 SmartScreen 后果。

社区仓库中的自动 GitHub Actions 仅限 pull request 与 `master` 上的 Windows Desktop CI，以及 `desktop-v*` 标签的 Desktop 发行组装。两个 Desktop 工作流也提供 `workflow_dispatch`，使维护者无需改变自动事件策略即可重新执行同一套固定版本验证。其他继承自上游的工作流只能通过 `workflow_dispatch` 手动运行；可复用的单文件可执行程序构建器还保留 `workflow_call`，以便手动触发的 Python 发行调用它。本 fork 不假定拥有上游企业 runner、API secret、GitHub Pages 或 npm 发布凭据。

载体将 Electron 精确固定为 `43.4.1`，Electron 原生目录选择器包接受同一受支持主版本。应用就绪前，主进程获取 Electron 的进程级单实例锁并订阅 `second-instance`；若聚焦请求到达时两个可见窗口都不存在，该请求会保持待处理，直到启动窗口就绪。单实例状态不会写入 Electron `userData` 或 `DSH_HOME`。

每个具备权限的 renderer 到主进程 IPC channel 都归属于应用或启动窗口角色。授权要求消息来自当前角色的准确 `WebContents`、其主 frame 以及固定 URL 和 origin。两个窗口都拒绝 renderer 发起的文档导航、重定向和子窗口；只有生命周期持有的 `loadURL`、`loadFile` 和重新加载操作可以替换其文档。

桌面 Host 解析常规 DSH home 并打开 `web` profile。在同一台电脑、同一个 Windows 用户和相同 `DSH_HOME` 下，它会原位复用健康的 Host 会话、附件、设置、凭据引用、profiles、插件声明、预设和用户 skills。该行为是数据复用而不是迁移：它不复制项目文件、浏览器 `localStorage`、云端会话、其他用户或电脑上的数据，也不复制损坏的会话日志。Web 和 Desktop Host 不得同时写入同一个 home。

插件包操作通过 `desktopProfiles` 和 `desktopPnpm` 使用应用的私有 Node 与 pnpm 运行时。该应用专属运行时把 pnpm 的 `store` 和 `cache` 目录放在 Electron `userData` 下，并继续读取活动 profile 的 `.npmrc` 与继承的代理配置。Desktop CLI 不经过命令 shell，直接启动随包 pnpm JavaScript 入口，因此 Unicode 路径和 Windows 命令元字符会保留为原始 argv。注册表和本地文件包不要求全局 pnpm 命令。由 Git 支持的规格要求外部安装 Git for Windows，并在 Git 不可用时于调用 pnpm 前失败。

## 验证

- 源码验证运行根构建以及桌面类型检查和单元测试。
- 聚焦安全验证会拒绝陈旧 sender、子 frame 和错误 URL，拒绝 renderer 导航及子窗口，并覆盖窗口就绪前后的第二实例聚焦。
- 客户端验证会证明社区身份在 `welcome-notice` slot 单元中胜出、在不渲染内容的情况下完成该步骤，并在卸载时恢复上游 occupant。system-prompt 验证会证明部署身份覆盖。打包验证从打包应用中启动 worker、文档查看器、侧边栏、Host、插件 fixture 安装和插件清单，并验证中性品牌闭包。
- 安装程序验证检查静默安装、已安装启动、快捷方式和可执行文件元数据、许可证载荷、静默卸载以及临时 `DSH_HOME` 的保留。
- 发行验证拒绝不匹配的版本与 tag，记录上游基线和工具版本，并在下载后检查已发布产物哈希。
- 工作流验证会解析所有 Actions YAML 文件，仅允许两个 Desktop 工作流使用自动仓库事件，并要求每个工作流都提供手动执行入口；已记录的可复用构建器还保留 `workflow_call`。

## 备选方案

**发布现有开发安装程序。** 未采用，因为从混合工作区组装的产物无法证明干净的源码闭包，而且可能保留不兼容的插件对等依赖、私有路径、陈旧品牌或缺失的声明。

**使用 DeepSeek 或鲸鱼品牌提高辨识度。** 未采用，因为社区发布者不拥有上游商标身份。上游归属说明保持明确，但不会把本安装程序表现为官方产品。

**为 Desktop 重写共享欢迎声明。** 未采用，因为该文案及其确认记录属于上游 Web 产品。仅限 Desktop 的 slot 遮蔽会移除不适用的步骤，而不 fork 其弹窗、持久化逻辑或共享 Web 语义。

**把全部 Web 和浏览器数据复制到 Electron 存储。** 未采用，因为 Host 数据已有权威 `DSH_HOME`，仅存在于浏览器的状态则由不同组件拥有，也没有完整迁移格式。复制凭据或会话还会产生不必要的安全和一致性风险。

**捆绑 Git、签署首个安装程序或添加自动更新。** 未用于首个社区预览版，因为每项内容都需要单独的供应链、许可证、凭据和生命周期决策。发行限制会披露这些缺失项。

**使用 PID 文件和聚焦请求轮询协调实例。** 未采用，因为先检查 PID 再写入文件并不是原子化的所有权决策，PID 复用可能标识错误进程，而且文件失败过去会允许另一个 Host 启动。Electron 锁持有进程排他权，其事件承载聚焦请求。

**信任所有携带 preload bridge 的 frame。** 未采用，因为陈旧窗口、子 frame 或已导航文档不得从 preload 继承 Host API 权限。角色、frame 和固定文档检查把该权限限制在由主进程创建的两个文档中。

**在社区 fork 中保持上游自动化启用。** 未采用，因为这些工作流需要上游持有的 runner、secret、Pages 配置或 registry 发布权限。它们仍可由维护者显式手动触发，但不会成为社区仓库自动事件。

## 后果

独立 app id 和产品名称可避免替换上游品牌安装，但用户必须选择由哪个 Host 进程拥有共享的 `DSH_HOME`。固定产物名称提供一键 latest URL，`SHA256SUMS.txt` 则在没有代码签名身份的情况下提供完整性证据。由 Git 支持的插件用户需要单独安装 Git，且未签名预览版要求用户自行处理 SmartScreen。Electron 补丁更新是显式锁文件变更，而不是版本范围解析；renderer 创建的外部窗口需要未来新增由主进程明确授权的操作，上游验证或发布工作流也需要显式手动触发。跨电脑传输、浏览器 UI 状态导入、云端导入、自动更新和损坏日志修复仍不属于本发行版。
