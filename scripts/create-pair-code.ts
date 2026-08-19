export {}

const arg = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const baseUrl = arg('url', process.env.CESTATS_SITE_URL ?? 'http://127.0.0.1:3100')!
const adminKey = arg('key', process.env.CESTATS_ADMIN_KEY)
const player = arg('player')

if (!adminKey) throw new Error('需要 --key 或 CESTATS_ADMIN_KEY')
if (!player) throw new Error('需要 --player <Minecraft用户名>')

const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/admin/pairing`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-admin-key': adminKey,
  },
  body: JSON.stringify({ player }),
})
const body = await response.json().catch(() => ({}))
if (!response.ok) {
  throw new Error(`生成配对码失败 HTTP ${response.status}: ${JSON.stringify(body)}`)
}

console.log(`玩家: ${body.player}`)
console.log(`配对码: ${body.code}`)
console.log(`有效至: ${new Date(body.expiresAt).toLocaleString('zh-CN')}`)
console.log(`游戏内执行: /cestats pair ${body.code}`)
