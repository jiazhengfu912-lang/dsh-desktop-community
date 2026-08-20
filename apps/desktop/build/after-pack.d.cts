export interface SanitizedText {
  replacements: number
  text: string
}

export function repositoryRootForms(repositoryRoot: string): string[]
export function sanitizeGeneratedClientText(
  text: string,
  repositoryRoot: string,
  filePath?: string,
): SanitizedText
export function sanitizeStagedText(packagedAppRoot: string, repositoryRoot: string): Promise<number>
export function removeForbiddenBrandPackages(packagedAppRoot: string): Promise<void>
export function afterPack(context: { appOutDir: string }): Promise<void>
export default afterPack
