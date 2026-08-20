/** Browser stand-in for `node:module`. `createRequire` is unreachable in the
 * configured loader path and fails loud if that assumption changes. */
export const createRequire = (): never => {
  throw new Error('node:module is not available in the browser')
}
export type LoadHookContext = never
