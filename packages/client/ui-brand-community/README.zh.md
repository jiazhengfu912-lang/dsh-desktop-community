# @deepseek-ai/dsh-client-ui-brand-community

[English](README.md) | 中文

本包使用 DSH Desktop Community 标识填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`。它还会遮蔽 `settings.onboarding` 中名为 `welcome-notice` 的条目并立即完成该步骤，因此社区应用不会呈现上游产品专属的测试声明。只有[桌面 overlay](../../../apps/desktop/desktop.patch.yml)插入该插件；上游 Web 组合继续使用自身的品牌包和声明。

该标记是原创的终端与电路 SVG，会继承每个宿主界面的颜色和请求尺寸。紧凑名称图稿将几何 DSH 字母组合与 `DESKTOP COMMUNITY` 配对。它既不导入鱼形标记，也不导入官方 wordmark。三个图稿 occupant 通过嵌套的 `slots.inject()` 作为一组声明感知注册安装。声明覆盖使用列表 slot 的低优先级遮蔽规则，不复制上游弹窗或确认存储；卸载本插件会恢复上游 occupant。

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **本包只持有浏览器身份策略** —— 窗口标题、可执行文件资源、安装器和快捷方式由桌面应用配置，提供方名称仍由各提供方插件持有。
- **wordmark 使用已安装的等宽字体** —— 不同 Windows 安装的字形度量可能略有差异，但其 SVG 框架和 slot 几何保持固定。
