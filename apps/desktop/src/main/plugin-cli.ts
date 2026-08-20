/** Private Electron RunAsNode bootstrap for the packaged DSH plugin command. */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'

/** Remove Electron Node mode before DSH starts pnpm or lifecycle children. */
export function clearElectronRunAsNode(environment: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === RUN_AS_NODE) Reflect.deleteProperty(environment, name)
  }
}

/** Load the packaged DSH CLI after removing its Electron-only launch marker. */
export async function runDesktopPluginCli(
  environment: NodeJS.ProcessEnv = process.env,
  load: (url: string) => Promise<unknown> = url => import(url),
): Promise<void> {
  clearElectronRunAsNode(environment)
  const appRequire = createRequire(new URL('../../package.json', import.meta.url))
  const dshManifest = appRequire.resolve('@deepseek-ai/dsh/package.json')
  await load(pathToFileURL(join(dirname(dshManifest), 'lib', 'bin.js')).href)
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && fileURLToPath(import.meta.url) === entry
}

if (isDirectExecution()) {
  void runDesktopPluginCli().catch((error: unknown) => {
    process.stderr.write(`desktop plugin command failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
