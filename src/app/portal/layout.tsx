// src/app/portal/layout.tsx
// Wrapper for every /portal/* page.
//
// Phase 5. Same reasoning as the dashboard layout: middleware no longer
// redirects members without an active membership, so they land here and
// need to be told why some actions are unavailable.
//
// AccountStatusBanner returns null when there is nothing to say, so for
// an entitled member this renders no extra chrome at all.
//
// The banner's first case is the important one for portal members: a
// group whose subscription has lapsed. Those members did nothing wrong,
// cannot fix it themselves, and receive no email about it — the lapse
// notice goes to the group admin only. This banner is the ONLY way they
// learn what happened.

import AccountStatusBanner from '@/components/AccountStatusBanner'

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div>
      <div style={{ padding: '12px 16px 0' }}>
        <AccountStatusBanner />
      </div>
      {children}
    </div>
  )
}
