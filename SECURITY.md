# Security Policy

English | [中文](SECURITY.zh.md)

## Supported versions

Security fixes target the latest published DSH Desktop Community release and the current `master` branch. Older preview installers are not maintained after a replacement release is available.

## Report a vulnerability privately

Do not open a public issue containing exploit steps, credentials, session data, or an unredacted `DSH_HOME`. Use [GitHub private vulnerability reporting](https://github.com/jiazhengfu912-lang/dsh-desktop-community/security/advisories/new). If that form is unavailable, open a minimal [security-contact issue](https://github.com/jiazhengfu912-lang/dsh-desktop-community/issues/new) that requests a private channel without disclosing the vulnerability.

Include the affected release or commit, Windows version, attack prerequisites, impact, minimal reproduction, and whether the issue also reproduces in the upstream DSH Web or CLI application. Remove API keys, credential values, personal paths, project source, and unrelated session contents.

## Response

Maintainers acknowledge a private report when it is received, reproduce it when possible, coordinate a fix and disclosure, and credit the reporter unless anonymity is requested. No response-time guarantee is offered by this volunteer project.

## Security boundaries

- The preview installer is unsigned; a hash match proves release-file integrity against `SHA256SUMS.txt`, not publisher identity or SmartScreen reputation.
- Credentials and sessions remain local DSH Host data. They are never appropriate for issue attachments, fixtures, screenshots, or release assets.
- Plugins execute code under the permissions granted to the local DSH Host. Install only plugins and sources you trust.
- Git-backed plugin installation uses the separately installed Git for Windows executable; the application does not bundle or update Git.

Vulnerabilities in unmodified upstream packages may be coordinated with the [upstream repository](https://github.com/deepseek-ai/deepseek-harness), but report community packaging or desktop integration defects here first so maintainers can establish ownership.
