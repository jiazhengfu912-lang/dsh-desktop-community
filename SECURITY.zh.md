# 安全政策

[English](SECURITY.md) | 中文

## 支持的版本

安全修复面向最新发布的 DSH Desktop Community 版本和当前 `master` 分支。替代发行版可用后，不再维护旧的预览安装程序。

## 私下报告漏洞

不要创建包含利用步骤、凭据、会话数据或未脱敏 `DSH_HOME` 的公开 issue。请使用 [GitHub 私有漏洞报告](https://github.com/jiazhengfu912-lang/dsh-desktop-community/security/advisories/new)。如果该表单不可用，请创建最简的[安全联系 issue](https://github.com/jiazhengfu912-lang/dsh-desktop-community/issues/new)，仅请求私有沟通渠道，不披露漏洞内容。

请提供受影响的发行版或 commit、Windows 版本、攻击前提、影响、最小复现，以及问题是否也能在上游 DSH Web 或 CLI 应用中复现。请移除 API 密钥、凭据值、个人路径、项目源码和无关会话内容。

## 响应

维护者会在收到私有报告后确认，尽可能复现问题，协调修复与披露，并在报告者未要求匿名时予以致谢。本志愿者项目不承诺响应时限。

## 安全边界

- 预览安装程序未签名；哈希匹配只能依据 `SHA256SUMS.txt` 证明发行文件完整性，不能证明发布者身份或 SmartScreen 信誉。
- 凭据和会话属于本地 DSH Host 数据。不得把它们用于 issue 附件、fixture、截图或发行产物。
- 插件会在授予本地 DSH Host 的权限下执行代码。只安装你信任的插件和来源。
- 由 Git 支持的插件安装使用单独安装的 Git for Windows 可执行文件；应用不捆绑或更新 Git。

未修改上游包中的漏洞可以与[上游仓库](https://github.com/deepseek-ai/deepseek-harness)协调，但社区打包或桌面集成缺陷应先在本仓库报告，以便维护者确认归属。
