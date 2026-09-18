'use client'

import { useState } from 'react'
import { AccountMenu } from '@/components/shell'

/**
 * The sidebar's bottom row, at the sidebar's width. Signed in and not, because
 * the menu is not the same list in both — there is no sign-out row without
 * someone to sign out.
 */
export function AccountMenuDemo() {
  const [signedOut, setSignedOut] = useState(0)

  return (
    <div className="flex flex-wrap items-end gap-8">
      <div className="w-[188px]">
        <AccountMenu
          identity={{ label: 'Koshik Raj', detail: 'koshik@example.com' }}
          onSignOut={() => setSignedOut((n) => n + 1)}
        />
      </div>
      <div className="w-[188px]">
        <AccountMenu identity={{ label: '0xd8da…6045', mono: true }} onSignOut={() => {}} />
      </div>
      <div className="w-[188px]">
        <AccountMenu />
      </div>
      <p role="status" className="basis-full text-[12px] text-[var(--ot-text-3)]">
        {signedOut > 0 ? `Sign out pressed ${signedOut}×. Nothing happened — this is the styleguide.` : ''}
      </p>
    </div>
  )
}
