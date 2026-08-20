/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkPrivateCommunityAssemblyManifest,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@deepseek-ai/dsh-experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@deepseek-ai/dsh-prototype' },
    })).toEqual([
      '@deepseek-ai/dsh-prototype: experimental package name must start with "@deepseek-ai/dsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-prototype: experimental package must set "private": true',
      '@deepseek-ai/dsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@deepseek-ai/dsh-consumer',
          [section]: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@deepseek-ai/dsh-consumer: ${section}.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@deepseek-ai/dsh-test-only',
        devDependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@deepseek-ai/dsh-experimental-consumer',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@deepseek-ai/dsh-python-runtime',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@deepseek-ai/dsh-python-runtime: dependencies.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('private community assembly constraints', () => {
  const communityRepository = (directory: string) => ({
    type: 'git',
    url: 'git+https://github.com/jiazhengfu912-lang/dsh-desktop-community.git',
    directory,
  })

  it.each([
    ['apps/desktop', '@deepseek-ai/dsh-desktop'],
    ['packages/client/ui-brand-community', '@deepseek-ai/dsh-client-ui-brand-community'],
    ['packages/extensions/document-viewer', '@deepseek-ai/dsh-document-viewer'],
    ['packages/host/directory-picker-electron', '@deepseek-ai/dsh-host-directory-picker-electron'],
  ])('accepts private community assembly %s tied to its source directory', (dir, name) => {
    expect(checkPrivateCommunityAssemblyManifest({
      dir,
      manifest: {
        name,
        private: true,
        repository: communityRepository(dir),
      },
    })).toEqual([])
  })

  it('rejects npm publication metadata and an ambiguous source location', () => {
    expect(checkPrivateCommunityAssemblyManifest({
      dir: 'apps/desktop',
      manifest: {
        name: '@deepseek-ai/dsh-desktop',
        private: false,
        publishConfig: { access: 'public' },
        repository: { type: 'git', url: communityRepository('apps/desktop').url },
      },
    })).toEqual([
      '@deepseek-ai/dsh-desktop: community assembly must set "private": true',
      '@deepseek-ai/dsh-desktop: community assembly must omit publishConfig',
      `@deepseek-ai/dsh-desktop: community assembly repository must use ${communityRepository('apps/desktop').url} with directory apps/desktop`,
    ])
  })
})
