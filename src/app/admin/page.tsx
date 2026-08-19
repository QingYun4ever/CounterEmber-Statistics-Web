import { cookies } from 'next/headers'
import AdminConsole from '@/components/AdminConsole'
import AdminLogin from '@/components/AdminLogin'
import { ADMIN_SESSION_COOKIE, adminKeyConfigured, adminSessionValid } from '@/lib/api-auth'
import { listDeviceTokens, listPairRequests, listPairingCodes } from '@/lib/db'
import { allPlayerNames } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '站长 · CE Stats',
  robots: { index: false, follow: false },
}

/**
 * Operator-only console. Not linked from the nav on purpose: it is reached by URL and gated on the
 * server-side admin key, so an ordinary visitor never sees it exists.
 */
export default async function AdminPage() {
  const configured = adminKeyConfigured()
  const store = await cookies()
  const authenticated = configured && adminSessionValid(store.get(ADMIN_SESSION_COOKIE)?.value)

  if (!authenticated) return <AdminLogin configured={configured} />

  return (
    <AdminConsole
      players={allPlayerNames()}
      initialRequests={listPairRequests()}
      initialCodes={listPairingCodes()}
      initialDevices={listDeviceTokens()}
      ingestEnabled={process.env.CESTATS_INGEST_ENABLED !== 'false'}
    />
  )
}
