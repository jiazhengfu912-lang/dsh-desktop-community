# Agent Note: 社区 master 分支保护

Status: implemented

[English](2026-08-20-community-master-branch-protection.md) | 中文

## 问题

社区仓库需要一条可审计的 `master` 合入路径，同时不能假定始终有第二位维护者。所需状态检查的工作流使用路径过滤时，无法保护每个 pull request，因为被排除的变更不会上报该检查。管理员绕过、直接 push、force push 或删除分支也会使受保护历史和发行源码偏离经过评审的 pull request 路径。

## 决策

`master` 分支要求 pull request，并要求 `windows-desktop` 状态检查通过且严格保持最新。所需审批数为零。保护规则对管理员同样生效，并禁用 force push 和删除分支。

Desktop CI 不使用路径过滤，处理每个 `pull_request` 事件。因此，无论变更只涉及文档、其他非桌面路径还是桌面代码，`windows-desktop` 检查都会上报结果。

## 备选方案

**要求一次批准评审。** 人工批准可以提供独立评审，但可能阻止唯一活跃维护者合并已经验证的安全或发行修复。初始社区仓库允许不审批，同时保留强制 pull request 记录和 Windows 验证。

**保留 pull request 路径过滤。** 选择性 CI 可以减少 runner 使用量，但被跳过的工作流无法满足所需状态检查。所需检查必须具有覆盖每个 pull request 的执行路径。

**允许管理员绕过或紧急直接 push。** 绕过可以缩短恢复工作，但会使最可能影响发行版的变更失去相同的来源和验证保证。紧急变更仍使用普通 pull request 和所需检查路径。

## 后果

每项变更都会留下 pull request 记录和 Windows Desktop 结果，包括仅涉及文档的变更。`master` 前进后，pull request 必须重新运行严格检查，管理员也不能把直接 push 或 force push 用作紧急捷径。所需审批数为零并不保证独立人工评审；该设置避免单维护者死锁，同时仓库依赖可见 diff 和强制自动化。项目拥有可靠的其他维护者后，可以提高审批数。
