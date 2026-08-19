'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: '总览' },
  { href: '/matches', label: '比赛' },
  { href: '/players', label: '排行' },
  { href: '/download', label: '下载' },
  { href: '/me', label: '我' },
]

export default function Nav({ me }: { me: string | null }) {
  const pathname = usePathname()

  // Viewing your own profile should light up 「我」, not 「排行」.
  const myProfile = me ? `/players/${encodeURIComponent(me)}` : null
  const onMyProfile = myProfile !== null && pathname === myProfile

  return (
    <header className="sticky top-0 z-20 border-b border-white/60 bg-white/45 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-8 px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/icon.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 rounded-lg"
            priority
          />
          <span className="text-[15px] font-semibold tracking-tight">CE Stats</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((link) => {
            let active: boolean
            if (link.href === '/me') {
              active = pathname === '/me' || onMyProfile
            } else if (link.href === '/') {
              active = pathname === '/'
            } else {
              active = pathname.startsWith(link.href) && !onMyProfile
            }
            return (
              <Link
                key={link.href}
                href={link.href === '/me' && myProfile ? myProfile : link.href}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  active
                    ? 'bg-white/80 font-medium text-ink-900 shadow-sm'
                    : 'text-ink-500 hover:bg-white/50 hover:text-ink-700'
                }`}
              >
                {link.label}
                {link.href === '/me' && me ? (
                  <span className="ml-1.5 text-[11px] text-ink-300">{me}</span>
                ) : null}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
