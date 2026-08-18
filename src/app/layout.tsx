import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Nav from '@/components/Nav'
import { getMe } from '@/lib/me-server'
import './globals.css'

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'CE Stats',
  description: '仿 CS2 团队爆破 · 对局数据统计',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe()

  return (
    <html lang="zh-CN" className={inter.variable}>
      <body
        style={{
          fontFamily:
            'var(--font-inter), -apple-system, "Segoe UI", system-ui, "Microsoft YaHei", "PingFang SC", sans-serif',
        }}
      >
        <div className="aurora" />
        <Nav me={me} />
        <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-8">{children}</main>
      </body>
    </html>
  )
}
