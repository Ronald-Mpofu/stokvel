// src/app/portal/membership/page.tsx
// Community Membership, inside the portal.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────
// The same panel lives at /dashboard/membership, but /dashboard is
// admin-only in middleware, so a MEMBER was redirected to /portal and
// could never reach it. That made the rule 3f opt-in unreachable by
// precisely the people it is for — invited members, who are all
// MEMBERs by definition.
//
// Middleware now lets both roles through to /dashboard/membership as
// well, so deep links keep working. This route exists so members have a
// path inside their OWN space rather than being sent into the admin
// area to manage their own subscription.
//
// One component, two routes. Behaviour cannot drift between them.

import CommunityMembershipPanel from '@/app/dashboard/membership/CommunityMembershipPanel'

export const dynamic = 'force-dynamic'

export default function PortalMembershipPage() {
  return (
    <div style={{ padding: 24, maxWidth: 780, margin: '0 auto' }}>
      <a
        href="/portal"
        style={{ display: 'inline-block', marginBottom: 14, fontSize: 13, fontWeight: 600, color: '#667085', textDecoration: 'none' }}
      >
        ← Back to my portal
      </a>
      <h1 style={{ margin: '0 0 6px 0', fontSize: 22, fontWeight: 700, color: '#0D2137' }}>
        Membership
      </h1>
      <p style={{ margin: '0 0 20px 0', fontSize: 14, color: '#667085', lineHeight: 1.6 }}>
        Manage your Community Membership and renewal.
      </p>
      <CommunityMembershipPanel />
    </div>
  )
}
