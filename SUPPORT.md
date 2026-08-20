# Support

English | [中文](SUPPORT.zh.md)

DSH Desktop Community provides volunteer community support for this Windows distribution. It does not provide official DeepSeek customer support, service-level guarantees, remote access to your computer, or recovery of private data.

## Choose the right channel

| Request | Channel |
| --- | --- |
| Installation, usage, plugin selection, or general questions | [Community Discussions](https://github.com/jiazhengfu912-lang/dsh-desktop-community/discussions) |
| Reproducible desktop, installer, startup, or plugin-market defect | [Bug report](https://github.com/jiazhengfu912-lang/dsh-desktop-community/issues/new?template=bug.md) |
| Vulnerability or sensitive security finding | [Security policy](SECURITY.md) |
| Defect reproduced in an unmodified upstream Web or CLI build | [Upstream DSH repository](https://github.com/deepseek-ai/deepseek-harness) |

## Before reporting a desktop problem

1. Confirm the Windows version, application version, and whether the installer hash matches `SHA256SUMS.txt`.
2. Close every other DSH Web Host and desktop process that may use the same `DSH_HOME`.
3. Record the exact action, expected result, actual result, and the final relevant error lines.
4. State whether `DSH_HOME` is default or custom without publishing its private contents.
5. For plugin installation, include the package specification and whether Git for Windows is installed; remove tokens and credential-bearing URLs.

Do not upload `.credentials.yaml`, `.env`, API keys, complete session logs, proprietary project files, or screenshots containing personal paths. Replace usernames, workspace names, and session identifiers with neutral placeholders.

## Data recovery limits

The desktop application reuses healthy local Host data when the computer, Windows user, and `DSH_HOME` match. Support does not promise repair of corrupt session logs, cross-computer migration, browser `localStorage` recovery, cloud-conversation import, or restoration of deleted project files.
