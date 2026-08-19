import fs from 'node:fs/promises'
import path from 'node:path'
import { isDownloadableName, modDir } from '@/lib/mod-releases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Serves a mod jar out of CESTATS_MOD_DIR.
 *
 * The files are uploaded by hand and never built here, so the name is treated as untrusted:
 * it has to match the allowed shape, and the resolved path has to still be inside the directory.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file: raw } = await params
  const file = decodeURIComponent(raw)

  if (!isDownloadableName(file)) {
    return new Response('not found', { status: 404 })
  }

  const dir = path.resolve(modDir())
  const target = path.resolve(dir, file)
  // Belt and braces: the name pattern already rules out separators and dots.
  if (target !== path.join(dir, file)) {
    return new Response('not found', { status: 404 })
  }

  let body: Buffer
  try {
    body = await fs.readFile(target)
  } catch {
    return new Response('not found', { status: 404 })
  }

  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': 'application/java-archive',
      'content-length': String(body.length),
      'content-disposition': `attachment; filename="${file}"`,
      // Jars are replaced in place on release, so revalidate rather than trusting a long cache.
      'cache-control': 'public, max-age=0, must-revalidate',
    },
  })
}
