# 参与贡献

[English](CONTRIBUTING.md) | 中文

DSH Desktop Community 接受针对 Windows 桌面发行版及其共享 DSH 依赖的聚焦贡献。本仓库是独立社区仓库；面向未修改 harness 核心的变更可能更适合提交到[上游仓库](https://github.com/deepseek-ai/deepseek-harness)。

## 开始之前

- 在 [Issues](https://github.com/jiazhengfu912-lang/dsh-desktop-community/issues) 和 [Discussions](https://github.com/jiazhengfu912-lang/dsh-desktop-community/discussions) 中搜索现有工作。
- 大型用户可见、架构、持久化、打包或发行流程变更应先创建 issue。
- 禁止包含 API 密钥、凭据、`.dsh` 内容、真实会话日志、个人路径或含有私有工作区的截图。
- 编辑前阅读 [AGENTS.md](AGENTS.md)、[开发指南](docs/development.md)及适用的子树说明。

## 开发环境

使用 Node.js `^22.19.0` 或 `>=24.0.0` 以及 pnpm `11.7.0`：

```powershell
git clone https://github.com/jiazhengfu912-lang/dsh-desktop-community.git
Set-Location dsh-desktop-community
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run build
```

本仓库是 monorepo。桌面专属工作保留在 `apps/desktop`，仅在桌面行为确有需要时修改共享包。不要提交 `node_modules`、`lib`、`dist` 或 `release` 等依赖或输出目录。

本社区仓库仅允许 `.github/workflows/desktop-ci.yml`（pull request 与 `master` 的 Windows 桌面检查）和 `.github/workflows/desktop-release.yml`（`desktop-v*` 标签）自动运行。其他继承自上游的工作流必须显式执行 `workflow_dispatch`；本 fork 不假定拥有官方企业 runner、API secret、GitHub Pages 或 npm 发布凭据。

## Pull requests

- 创建聚焦分支，不要把无关本地改动放入 commit。
- 添加或更新通过真实入口验证变更行为的测试。
- 随代码更新用户文档和包文档。每份配对文档都必须具有匹配的英文、中文和 `.i18n.yaml` 文件。
- 非平凡的行为、架构、持久化、测试策略或发行流程决策必须新增或更新 Agent Note。
- 说明改动内容、实际运行的检查以及仍未验证的验收层级。

生成的安装程序是发行产物，不属于 PR 文件。公开截图必须使用临时 `DSH_HOME`、虚构工作区名称，且不得包含凭据或个人路径。

## 检查

运行与改动范围相称的检查。桌面变更通常需要：

```powershell
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop typecheck
pnpm --filter @deepseek-ai/dsh-desktop test
pnpm --filter @deepseek-ai/dsh-desktop package
pnpm run doc-sync
pnpm run lint
git diff --check
```

不能仅凭源码构建声称安装程序、插件市场或数据复用验收通过。应分别报告源码检查、打包冒烟测试、安装程序行为和可见 GUI 行为。

## 社区行为

报告应保持可复现和技术性。不要发布他人的凭据、私有数据或漏洞利用细节。漏洞使用[安全政策](SECURITY.md)中的流程，使用问题参见[支持](SUPPORT.md)。
