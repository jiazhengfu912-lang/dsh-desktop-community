# `@deepseek-ai/dsh-document-viewer`

English | [中文](README.zh.md)

Desktop Workspace document preview as a dual-face Cordis plugin. The Host face serves bounded, read-only content from registered Workspaces. The Web Client face registers PDF, DOCX, PPTX, and Markdown renderers with `dsh-better-sidebar`; it does not add another file browser or sidebar action. The desktop patch enables both packages by default, while shared Web profiles do not include them.

This package is private and is distributed only inside the DSH Desktop Community installer.

## Usage

1. Open a DSH Workspace and click **Expand sidebar** at the upper right.
2. Use Better Sidebar's existing explorer or filename search.
3. Select a supported file. The preview opens in the existing editor tab beside the file tree.

There is no separate **Documents** entry. File tabs, tree navigation, search, refresh, narrow-screen layout, and request cancellation remain owned by Better Sidebar. Closing a tab or selecting another file aborts the previous custom load; unmounting a PPTX preview also calls `destroy()`.

| Format | Renderer |
|---|---|
| PDF | Same-origin sandboxed iframe backed by Chromium's PDF viewer |
| Markdown (`.md`, `.markdown`) | Shared `MarkdownText` renderer with GFM, code, and TeX; relative Workspace resources are not loaded |
| DOCX | `docx-preview`, with `altChunk` rendering and link navigation disabled |
| PPTX | `@aiden0z/pptx-renderer`, with lazy media/slides, a windowed list, and archive limits |

Legacy DOC/PPT, macro-enabled or encrypted Office documents, editing, writes, recursive indexing, and file watching are not supported.

## Better Sidebar integration

The Client plugin injects `betterSidebar`, `workspaces`, and `locale`, then registers one `custom` file viewer at priority `100` for `pdf`, `docx`, `pptx`, `md`, and `markdown`. Better Sidebar supplies the selected absolute path and session scope to the loader. The loader identifies the registered Workspace by session membership, converts the selection to a non-empty Workspace-relative POSIX path, and fetches only the package-owned content route. The React component receives loaded document data and does not read Cordis or native paths.

The desktop composition mounts `dsh-better-sidebar` only when no enabled instance was supplied by an earlier user-profile bundle. This keeps an existing installed sidebar and its preferences authoritative while giving fresh desktop profiles the same file-management surface.

## Host route

`GET|HEAD /document-viewer/content?workspaceId=&path=` serves one supported file with an exact MIME type, `nosniff`, an inline filename, ETag handling, and single-byte-range `206`/`416` behavior. DOCX and PPTX central directories are scanned before response headers are sent; encrypted, malformed, over-entry, or over-expanded archives are rejected.

The route accepts only a relative POSIX file path inside the selected registered Workspace. Absolute paths, empty paths, dot segments, NUL, backslashes, encoded separators, symbolic links, junctions, and resolved path escape are rejected without returning Host absolute paths. Better Sidebar remains responsible for directory browsing and search, so this package exposes no duplicate listing route.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `maxFileBytes` | 64 MiB | Largest document served or scanned |
| `maxExpandedBytes` | 256 MiB | Largest summed OOXML uncompressed size |
| `maxArchiveEntries` | 4096 | Largest OOXML central-directory entry count |

Client bundle metadata declares `dsh.client.platform: web`; the package produces `lib/index.js`, `lib/invariant.js`, and `lib/client.js` from separate Host and Client TypeScript faces.

## Model Experience

### Workspace document preview

#### What the model sees

Nothing; `document-viewer` registers browser renderers and a read-only Host content route without adding prompt text, tools, or request content.

#### Token effect

None; previewed document bytes and renderer state do not enter a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Office layout is approximate and does not promise Microsoft Office pixel parity.
- Markdown Workspace-relative images and links are deliberately not resolved.
- PDF presentation depends on Chromium's built-in PDF support.
- Outside the desktop composition, the Client contribution remains inactive until a compatible Better Sidebar service is present.
