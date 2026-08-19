import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readJarEntry } from './jar'

/**
 * The mod jars offered on /download.
 *
 * They are read off disk rather than bundled into the image, because they are built from the
 * `mod/` half of this repo on a machine with a JDK and then uploaded to the server by hand.
 * Point CESTATS_MOD_DIR at wherever they land; in Docker that is the same volume as the database.
 */

/** Only what a player needs, and only what we can state truthfully. */
export interface ModRelease {
  file: string
  /** From the jar's own metadata when readable, else parsed out of the filename. */
  version: string | null
  /** The Minecraft version this jar was compiled against. */
  target: string | null
  /** The full range it declares support for, e.g. ">=1.21.9 <1.22". */
  supports: string | null
  bytes: number
  modified: number
  sha256: string
}

export function modDir(): string {
  return process.env.CESTATS_MOD_DIR ?? path.join(process.cwd(), 'data', 'mods')
}

/** Deliberately narrow: these names end up in a Content-Disposition header. */
const FILE_RE = /^[A-Za-z0-9._+-]+\.jar$/
/** `cestats-mc1.21.4-0.2.0+mc1.21.4.jar` */
const NAME_RE = /^cestats-mc([\d.]+)-(.+?)\+mc[\d.]+\.jar$/

export function isDownloadableName(file: string): boolean {
  return FILE_RE.test(file) && !file.endsWith('-sources.jar')
}

interface FabricModJson {
  version?: string
  depends?: { minecraft?: string | string[] }
}

/** Hashing a jar takes a few milliseconds; size+mtime is enough to know when to redo it. */
const cache = new Map<string, { stamp: string; release: ModRelease }>()

function describe(dir: string, file: string): ModRelease | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(path.join(dir, file))
    if (!stat.isFile()) return null
  } catch {
    return null
  }

  const stamp = `${stat.size}:${stat.mtimeMs}`
  const hit = cache.get(file)
  if (hit?.stamp === stamp) return hit.release

  let jar: Buffer
  try {
    jar = fs.readFileSync(path.join(dir, file))
  } catch {
    return null
  }

  const fromName = NAME_RE.exec(file)
  let version = fromName?.[2] ?? null
  let supports: string | null = null

  const entry = readJarEntry(jar, 'fabric.mod.json')
  if (entry) {
    try {
      const meta = JSON.parse(entry.toString('utf8')) as FabricModJson
      if (typeof meta.version === 'string') version = meta.version
      const declared = meta.depends?.minecraft
      supports = Array.isArray(declared) ? declared.join(' 或 ') : (declared ?? null)
    } catch {
      // Unparseable metadata is not a reason to hide the file.
    }
  }

  const release: ModRelease = {
    file,
    version,
    target: fromName?.[1] ?? null,
    supports,
    bytes: stat.size,
    modified: stat.mtimeMs,
    sha256: createHash('sha256').update(jar).digest('hex'),
  }
  cache.set(file, { stamp, release })
  return release
}

/** Compares dotted versions numerically, so 1.21.11 sorts above 1.21.8. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Newest Minecraft version first; anything unparseable sinks to the bottom. */
export function modReleases(): ModRelease[] {
  const dir = modDir()

  let files: string[]
  try {
    files = fs.readdirSync(dir)
  } catch {
    return []
  }

  return files
    .filter(isDownloadableName)
    .map((file) => describe(dir, file))
    .filter((r): r is ModRelease => r !== null)
    .sort((a, b) => {
      if (a.target && b.target) return compareVersions(a.target, b.target)
      if (a.target) return -1
      if (b.target) return 1
      return a.file.localeCompare(b.file)
    })
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
