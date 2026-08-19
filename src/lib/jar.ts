import { inflateRawSync } from 'node:zlib'

/**
 * Just enough of the ZIP format to pull one file out of a jar.
 *
 * A mod jar's `fabric.mod.json` is the only place that states which Minecraft versions the jar
 * actually supports; the filename only names the one it was compiled against. Reading it beats
 * guessing, and it survives someone renaming the file after upload.
 *
 * No dependency: Node already has the hard part (inflate), and the container format is a handful
 * of fixed-layout records. Jars this size never need ZIP64, so that case simply bails out.
 */

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_MIN_SIZE = 22
/** The comment field the End Of Central Directory record sits in front of is at most 64 KiB. */
const EOCD_MAX_SEARCH = EOCD_MIN_SIZE + 0xffff

function findEndOfCentralDirectory(buf: Buffer): number | null {
  const start = Math.max(0, buf.length - EOCD_MAX_SEARCH)
  for (let i = buf.length - EOCD_MIN_SIZE; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i
  }
  return null
}

/** Returns the decompressed entry, or null if the jar is unreadable or has no such entry. */
export function readJarEntry(jar: Buffer, entryName: string): Buffer | null {
  try {
    const eocd = findEndOfCentralDirectory(jar)
    if (eocd === null) return null

    const entries = jar.readUInt16LE(eocd + 10)
    let offset = jar.readUInt32LE(eocd + 16)
    // 0xffffffff is the marker for "the real value is in the ZIP64 record", which we do not read.
    if (offset === 0xffffffff) return null

    for (let i = 0; i < entries; i++) {
      if (offset + 46 > jar.length || jar.readUInt32LE(offset) !== CENTRAL_SIGNATURE) return null

      const method = jar.readUInt16LE(offset + 10)
      const compressedSize = jar.readUInt32LE(offset + 20)
      const nameLength = jar.readUInt16LE(offset + 28)
      const extraLength = jar.readUInt16LE(offset + 30)
      const commentLength = jar.readUInt16LE(offset + 32)
      const localOffset = jar.readUInt32LE(offset + 42)
      const name = jar.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')

      if (name === entryName) {
        // The local header repeats the name and extra fields, at its own lengths.
        if (localOffset + 30 > jar.length) return null
        const localNameLength = jar.readUInt16LE(localOffset + 26)
        const localExtraLength = jar.readUInt16LE(localOffset + 28)
        const dataStart = localOffset + 30 + localNameLength + localExtraLength
        const data = jar.subarray(dataStart, dataStart + compressedSize)

        if (method === 0) return Buffer.from(data)
        if (method === 8) return inflateRawSync(data)
        return null
      }

      offset += 46 + nameLength + extraLength + commentLength
    }
    return null
  } catch {
    return null
  }
}
