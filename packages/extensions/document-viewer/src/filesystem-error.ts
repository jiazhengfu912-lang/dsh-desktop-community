/** Filesystem error normalization for document routes. */

/** HTTP-safe status and code derived without retaining a Host path or message. */
export interface FilesystemErrorResult {
  /** HTTP status. */
  status: 403 | 404 | 500
  /** Stable response code. */
  code: 'forbidden-path' | 'document-not-found' | 'filesystem-error'
}

/**
 * Map an operating-system error code to the document route failure vocabulary.
 * @param error - value rejected by a filesystem operation.
 * @returns a status and stable response code that do not expose host paths.
 */
export function mapFilesystemError(error: unknown): FilesystemErrorResult {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return { status: 404, code: 'document-not-found' }
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return { status: 403, code: 'forbidden-path' }
  }
  return { status: 500, code: 'filesystem-error' }
}
