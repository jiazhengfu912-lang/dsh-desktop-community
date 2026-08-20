/** Lifecycle transfer for a Host that has settled but is not yet published. */

import type { Context } from '@deepseek-ai/cordis'

/**
 * Run a synchronous ownership claim and dispose the Host if it rejects the
 * settled service set. Cleanup failure retains both errors for diagnosis.
 * @param ctx - settled Host context not yet published to the Electron shell.
 * @param claim - synchronous validation and handle construction.
 * @returns the claimed handle or value.
 */
export async function claimSettledHost<T>(ctx: Context, claim: () => T): Promise<T> {
  try {
    return claim()
  } catch (error) {
    try {
      await ctx.fiber.dispose()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'desktop host boot: settled Host validation failed and cleanup was incomplete',
      )
    }
    throw error
  }
}
