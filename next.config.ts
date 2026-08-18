import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Standalone output keeps the VPS image small: `node .next/standalone/server.js`.
  output: 'standalone',
  // better-sqlite3 is a native module and must not be bundled.
  serverExternalPackages: ['better-sqlite3'],
}

export default nextConfig
