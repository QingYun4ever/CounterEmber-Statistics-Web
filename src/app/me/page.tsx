import { redirect } from 'next/navigation'
import MePicker from '@/components/MePicker'
import { getMe } from '@/lib/me-server'
import { allPlayerNames } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function MePage() {
  const names = allPlayerNames()
  const me = await getMe()

  // A remembered name that no longer exists (database reset, rename) falls through to the picker.
  if (me && names.includes(me)) {
    redirect(`/players/${encodeURIComponent(me)}`)
  }

  return <MePicker names={names} />
}
