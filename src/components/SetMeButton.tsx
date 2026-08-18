'use client'

import { useRouter } from 'next/navigation'
import { writeMe } from '@/lib/me'

/** Toggles "this profile is me", which is what the 「我」 tab jumps to. */
export default function SetMeButton({ name, isMe }: { name: string; isMe: boolean }) {
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={() => {
        writeMe(isMe ? null : name)
        router.refresh()
      }}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        isMe
          ? 'border-indigo-100 bg-indigo-50/80 text-indigo-700 hover:bg-indigo-100/80'
          : 'border-white/80 bg-white/70 text-ink-500 hover:text-ink-900'
      }`}
      title={isMe ? '取消后导航栏的「我」会重新询问' : '记住这是我，之后点「我」直接进这一页'}
    >
      {isMe ? '✓ 这是我' : '设为我'}
    </button>
  )
}
