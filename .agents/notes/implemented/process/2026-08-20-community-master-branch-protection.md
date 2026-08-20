# Agent Note: Community master branch protection

Status: implemented

English | [中文](2026-08-20-community-master-branch-protection.zh.md)

## Problem

The community repository needs an auditable path into `master` without assuming that a second maintainer is always available. A required status check cannot protect every pull request when its workflow uses path filters, because an excluded change leaves the check unreported. Administrator bypasses, direct pushes, force pushes, or branch deletion would also allow the protected history and release source to diverge from the reviewed pull request path.

## Decision

The `master` branch requires a pull request and the `windows-desktop` status check with strict up-to-date enforcement. The required approval count is zero. The protection applies to administrators, and force pushes and branch deletion are disabled.

Desktop CI handles every `pull_request` event without path filters. The `windows-desktop` check therefore reports for documentation-only and other non-desktop path changes as well as desktop code changes.

## Alternatives considered

**Require one approving review.** A human approval adds independent review, but it can prevent the sole active maintainer from merging a validated security or release fix. The initial community repository keeps review optional while preserving a mandatory pull request record and Windows validation.

**Keep pull-request path filters.** Selective CI reduces runner use, but a skipped workflow cannot satisfy a required status check. A required check must have an execution path for every pull request.

**Allow administrator bypass or emergency direct pushes.** Bypass shortens recovery work, but it removes the same provenance and validation guarantees from the changes most likely to affect releases. Emergency changes use the ordinary pull request and required-check path.

## Consequences

Every change receives a pull request record and a Windows Desktop result, including documentation-only changes. A pull request must rerun the strict check after `master` advances, and administrators cannot use direct or force pushes as an emergency shortcut. Zero required approvals does not guarantee independent human review; the setting avoids a single-maintainer deadlock while the repository relies on visible diffs and required automation. The approval count can increase when the project has dependable additional maintainers.
