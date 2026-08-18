/**
 * Deep-compares the upload payloads produced by the two independent implementations:
 *
 *   TypeScript  web/scripts/import-log.ts --dump <dir>
 *   Java        mod  ./gradlew test        -> mod/build/wire
 *
 * They parse the same raw chat lines, so every field must agree. Key order is ignored (the two
 * languages iterate maps differently); values are not.
 *
 *   npx tsx scripts/compare-wire.ts <tsDir> <javaDir>
 */
import fs from 'node:fs'
import path from 'node:path'

const [tsDir, javaDir] = process.argv.slice(2)
if (!tsDir || !javaDir) {
  console.error('用法: tsx scripts/compare-wire.ts <ts载荷目录> <java载荷目录>')
  process.exit(2)
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const diffs: string[] = []

function compare(a: Json, b: Json, at: string): void {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    // Numbers survive a JSON round trip differently in the two languages only if they differ.
    if (a !== b) diffs.push(`${at}: ts=${JSON.stringify(a)} java=${JSON.stringify(b)}`)
    return
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    diffs.push(`${at}: 类型不同 (array vs object)`)
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${at}: 数组长度 ts=${a.length} java=${b.length}`)
      return
    }
    a.forEach((item, i) => compare(item, b[i], `${at}[${i}]`))
    return
  }
  const ao = a as Record<string, Json>
  const bo = b as Record<string, Json>
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
  for (const key of [...keys].sort()) {
    if (!(key in ao)) {
      diffs.push(`${at}.${key}: ts 缺少该键`)
      continue
    }
    if (!(key in bo)) {
      diffs.push(`${at}.${key}: java 缺少该键`)
      continue
    }
    compare(ao[key], bo[key], `${at}.${key}`)
  }
}

const tsFiles = fs.readdirSync(tsDir).filter((f) => f.endsWith('.json')).sort()
const javaFiles = fs.readdirSync(javaDir).filter((f) => f.endsWith('.json')).sort()

console.log(`ts   ${tsFiles.length} 份载荷  ${tsDir}`)
console.log(`java ${javaFiles.length} 份载荷  ${javaDir}\n`)

if (tsFiles.join() !== javaFiles.join()) {
  console.error('✗ 两侧的 matchId 文件名不一致')
  console.error(`  ts:   ${tsFiles.join(', ')}`)
  console.error(`  java: ${javaFiles.join(', ')}`)
  process.exit(1)
}

for (const name of tsFiles) {
  const a = JSON.parse(fs.readFileSync(path.join(tsDir, name), 'utf8')) as Json
  const b = JSON.parse(fs.readFileSync(path.join(javaDir, name), 'utf8')) as Json
  const before = diffs.length
  compare(a, b, name.replace('.json', ''))
  console.log(`${diffs.length === before ? '✓' : '✗'} ${name}`)
}

if (diffs.length > 0) {
  console.error(`\n✗ 发现 ${diffs.length} 处差异：`)
  for (const d of diffs.slice(0, 40)) console.error(`   ${d}`)
  if (diffs.length > 40) console.error(`   ...还有 ${diffs.length - 40} 处`)
  process.exit(1)
}

console.log('\n✓ 两套实现输出完全一致')
