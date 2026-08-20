/** Package-owned invariant companion. @module @deepseek-ai/dsh-document-viewer/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-document-viewer'

/** Cordis companion plugin name. */
export const name = 'document-viewer-invariant'

/** Service required to reserve package invariant ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the host owns one stateless HTTP registration and the
 * browser contributes a transient Better Sidebar viewer. Route disposal,
 * registration disposal, and workspace confinement are exercised by package tests.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
