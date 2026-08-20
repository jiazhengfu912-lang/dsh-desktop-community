const { readFile, readdir, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sql',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
])
const CSS_REGION = /^\s*\/\/#region \\0dsh-(?:css|inline-css):(.+\.css)\.mjs\s*$/u
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/u

/** Returns every serialized form of one checkout root, longest first. */
function repositoryRootForms(repositoryRoot) {
  return [...new Set([
    repositoryRoot.replaceAll('\\', '\\\\'),
    repositoryRoot,
    repositoryRoot.replaceAll('\\', '/'),
  ])].sort((left, right) => right.length - left.length)
}

/**
 * Rewrites checkout paths only in Rolldown's generated CSS region comments.
 * Any occurrence in executable text or a region rooted elsewhere is a build error.
 */
function sanitizeGeneratedClientText(text, repositoryRoot, filePath = '<staged file>') {
  const rootForms = repositoryRootForms(repositoryRoot)
  const parts = text.split(/(\r\n|\n|\r)/u)
  let replacements = 0
  for (let index = 0; index < parts.length; index += 2) {
    let line = parts[index]
    const matchingRoots = rootForms.filter(root => line.includes(root))
    const region = CSS_REGION.exec(line)
    if (matchingRoots.length > 0) {
      if (region === null) {
        throw new Error(`checkout path outside a generated CSS region in ${filePath}`)
      }
      for (const root of matchingRoots) {
        const occurrences = line.split(root).length - 1
        line = line.replaceAll(root, '<repository>')
        replacements += occurrences
      }
      parts[index] = line
      continue
    }
    if (region !== null && WINDOWS_ABSOLUTE.test(region[1])) {
      throw new Error(`generated CSS region uses an unexpected absolute path in ${filePath}`)
    }
  }
  return { replacements, text: parts.join('') }
}

/** Sanitizes generated client artifacts throughout one staged application. */
async function sanitizeStagedText(packagedAppRoot, repositoryRoot) {
  let replacements = 0
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
      }
      else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
        const original = await readFile(entryPath, 'utf8')
        const sanitized = sanitizeGeneratedClientText(original, repositoryRoot, entryPath)
        replacements += sanitized.replacements
        if (sanitized.replacements > 0) await writeFile(entryPath, sanitized.text)
      }
    }
  }
  await visit(packagedAppRoot)
  return replacements
}

const FORBIDDEN_BRAND_PACKAGES = [
  'dsh-client-ui-brand-official',
  'dsh-skill-badge',
  'dsh-web-frontend',
]

/** Removes packages that carry upstream product artwork from the staged community app. */
async function removeForbiddenBrandPackages(packagedAppRoot) {
  for (const packageName of FORBIDDEN_BRAND_PACKAGES) {
    const packagePath = path.resolve(
      packagedAppRoot,
      'node_modules',
      '@deepseek-ai',
      packageName,
    )
    const relativeTarget = path.relative(packagedAppRoot, packagePath)
    if (path.isAbsolute(relativeTarget) || relativeTarget.startsWith(`..${path.sep}`)) {
      throw new Error(`refusing to remove path outside packaged app: ${packagePath}`)
    }
    await rm(packagePath, { force: true, recursive: true })
  }
}

/** Applies community artifact closure rules to the staged Electron application. */
async function afterPack({ appOutDir }) {
  const packagedAppRoot = path.resolve(appOutDir, 'resources', 'app')
  const repositoryRoot = path.resolve(__dirname, '..', '..', '..')
  await removeForbiddenBrandPackages(packagedAppRoot)
  const replacements = await sanitizeStagedText(packagedAppRoot, repositoryRoot)
  process.stdout.write(`DESKTOP_LOCAL_PATHS_STRIPPED count=${replacements}\n`)
}

module.exports = {
  afterPack,
  removeForbiddenBrandPackages,
  repositoryRootForms,
  sanitizeGeneratedClientText,
  sanitizeStagedText,
}
module.exports.default = afterPack
