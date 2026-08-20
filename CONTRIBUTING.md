# Contributing

English | [中文](CONTRIBUTING.zh.md)

DSH Desktop Community accepts focused contributions to the Windows desktop distribution and its shared DSH dependencies. This is an independent community repository; changes intended for the unmodified harness core may be better submitted to the [upstream repository](https://github.com/deepseek-ai/deepseek-harness).

## Before starting

- Search [Issues](https://github.com/jiazhengfu912-lang/dsh-desktop-community/issues) and [Discussions](https://github.com/jiazhengfu912-lang/dsh-desktop-community/discussions) for existing work.
- Open an issue before a large user-visible, architecture, persistence, packaging, or release-process change.
- Never include API keys, credentials, `.dsh` contents, real session logs, personal paths, or screenshots containing private workspaces.
- Read [AGENTS.md](AGENTS.md), [Development](docs/development.md), and the applicable subtree instructions before editing.

## Development setup

Use Node.js `^22.19.0` or `>=24.0.0` and pnpm `11.7.0`:

```powershell
git clone https://github.com/jiazhengfu912-lang/dsh-desktop-community.git
Set-Location dsh-desktop-community
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run build
```

The repository is a monorepo. Keep desktop-specific work in `apps/desktop` and change a shared package only when the desktop behavior requires it. Do not commit dependencies or output directories such as `node_modules`, `lib`, `dist`, or `release`.

Only `.github/workflows/desktop-ci.yml` (Windows desktop checks for pull requests and `master`) and `.github/workflows/desktop-release.yml` (`desktop-v*` tags) run automatically in this community repository. Maintainers can also dispatch either Desktop workflow explicitly to retry the same pinned validation. Every other inherited upstream workflow requires an explicit `workflow_dispatch`; this fork does not assume access to the official enterprise runners, API secrets, GitHub Pages, or npm publishing credentials.

## Pull requests

- Create a focused branch and keep unrelated local changes out of the commit.
- Add or update tests that exercise the changed behavior through its real entry path.
- Update user and package documentation with the code. Every paired document requires matching English, Chinese, and `.i18n.yaml` files.
- Add or update an Agent Note for non-trivial behavior, architecture, persistence, test-strategy, or release-process decisions.
- State what changed, the exact checks run, and any acceptance layer that remains unverified.

Generated installers are release assets, not pull-request files. Public screenshots must use a temporary `DSH_HOME`, fictitious workspace names, and no credentials or personal paths.

## Checks

Run checks proportional to the changed area. Desktop changes normally require:

```powershell
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop typecheck
pnpm --filter @deepseek-ai/dsh-desktop test
pnpm --filter @deepseek-ai/dsh-desktop package
pnpm run doc-sync
pnpm run lint
git diff --check
```

Do not claim installer, plugin-market, or data-reuse acceptance from a source build alone. Report source checks, packaged smokes, installer behavior, and visible GUI behavior as separate results.

## Community conduct

Keep reports reproducible and technical. Do not post another person's credentials, private data, or exploit details. Use the process in [Security](SECURITY.md) for vulnerabilities and [Support](SUPPORT.md) for usage questions.
