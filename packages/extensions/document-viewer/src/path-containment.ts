/** Canonical Workspace path containment. */

import { isAbsolute, relative, sep } from 'node:path'

/**
 * Return whether a canonical target is the canonical root or one of its descendants.
 * @param root - canonical workspace root.
 * @param target - canonical filesystem target.
 * @returns whether the target remains inside the workspace root.
 */
export function isWithin(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
}
