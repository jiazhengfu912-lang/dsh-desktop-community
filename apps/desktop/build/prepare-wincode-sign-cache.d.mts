export interface WindowsCodeSignArtifact {
  readonly electronBuilderVersion: string
  readonly version: string
  readonly url: string
  readonly sha512: string
  readonly requiredFiles: readonly string[]
}

export interface ElectronBuilderCacheEnvironment {
  readonly cacheOverride?: string
  readonly localAppData?: string
}

export const WINDOWS_CODE_SIGN_ARTIFACT: Readonly<WindowsCodeSignArtifact>

export function sha512Hex(value: NodeJS.ArrayBufferView): string

export function resolveElectronBuilderCache(environment: ElectronBuilderCacheEnvironment): string

export function missingToolchainFiles(
  root: string,
  isUsableFile: (filename: string) => boolean,
): string[]

export function assertSafeTemporaryDirectory(temporaryDirectory: string, cacheParent: string): void

export function windowsExtractionArguments(archive: string, outputDirectory: string): string[]

export function prepareWindowsCodeSignCache(): Promise<void>
