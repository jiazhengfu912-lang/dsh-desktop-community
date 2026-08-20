# 支持

[English](SUPPORT.md) | 中文

DSH Desktop Community 为本 Windows 发行版提供志愿者社区支持。它不提供 DeepSeek 官方客户支持、服务等级保证、远程访问你的电脑或私有数据恢复服务。

## 选择正确渠道

| 请求 | 渠道 |
| --- | --- |
| 安装、使用、插件选择或一般问题 | [社区 Discussions](https://github.com/jiazhengfu912-lang/dsh-desktop-community/discussions) |
| 可复现的桌面、安装程序、启动或插件市场缺陷 | [Bug 报告](https://github.com/jiazhengfu912-lang/dsh-desktop-community/issues/new?template=bug.md) |
| 漏洞或敏感安全发现 | [安全政策](SECURITY.md) |
| 在未修改的上游 Web 或 CLI 构建中复现的缺陷 | [上游 DSH 仓库](https://github.com/deepseek-ai/deepseek-harness) |

## 报告桌面问题之前

1. 确认 Windows 版本、应用版本以及安装程序哈希是否与 `SHA256SUMS.txt` 一致。
2. 关闭可能使用同一个 `DSH_HOME` 的所有其他 DSH Web Host 和桌面进程。
3. 记录准确操作、预期结果、实际结果和最后几行相关错误。
4. 说明 `DSH_HOME` 使用默认值还是自定义值，但不要发布其中的私有内容。
5. 对于插件安装，请提供包规格以及是否已安装 Git for Windows；移除 token 和含凭据的 URL。

不要上传 `.credentials.yaml`、`.env`、API 密钥、完整会话日志、专有项目文件或包含个人路径的截图。请用中性占位符替换用户名、工作区名称和会话标识符。

## 数据恢复限制

电脑、Windows 用户和 `DSH_HOME` 相同时，桌面应用会复用健康的本地 Host 数据。支持不承诺修复损坏的会话日志、跨电脑迁移、恢复浏览器 `localStorage`、导入云端会话或恢复已删除的项目文件。
