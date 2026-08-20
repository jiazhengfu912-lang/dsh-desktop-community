# `@deepseek-ai/dsh-host-directory-picker-electron`

[English](README.md) | 中文

本包是[目录选择器能力 seam](../directory-picker/README.md) 的 Electron Service Provider。它在 `ctx.directoryPicker` 上注册 `native` 能力，并在桌面 Host 显示器上打开 Electron 的操作系统目录选择器。远程 Web 部署改用 browse provider。

## 行为

`capability()` 在服务生命周期内返回一个稳定的 `{ kind: 'native', pick(signal) }` 对象。`pick()` 使用 `openDirectory` 和 `createDirectory` 打开 `dialog.showOpenDialog()`，然后返回第一个选中的绝对目录路径。如果调用方已被取消、操作员取消对话框或 Electron 未返回路径，则返回 `null`。

该 provider 不列出目录、不读取目录内容、不持久化选择，也不会把所选目录添加到 Workspace。这些操作继续由消费方和共享目录选择器 seam 持有。

## 组合

桌面 overlay 挂载本包以替代 Web 目录选择器组合。本包为私有包，仅随 DSH Desktop Community 安装程序分发。Electron 保持为对等依赖（peer dependency），因为对话框属于应用运行时。本包不公开配置。

## 模型体验

### 原生目录选择

#### 模型看到的内容

无；`ctx.directoryPicker` 服务于本地 GUI，不注册提示词、工具或请求内容。

#### Token 影响

无；选中的原生路径返回给 Workspace UI，而不是模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider request。

## 已知限制与延期工作

- 选择器要求可访问操作系统显示器的交互式 Electron Host。
- `pick()` 返回前的取消会阻止打开新对话框；Electron 打开模态对话框后到达的 abort 无法关闭该原生对话框。
- provider 每次调用选择一个目录，不提供远程浏览或多根选择。
