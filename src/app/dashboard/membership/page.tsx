// src/app/dashboard/membership/page.tsx
// Community Membership page.
//
// Deliberately thin. All behaviour lives in CommunityMembershipPanel so
// the same component can be embedded in an existing profile or settings
// page instead of using this route:
//
//   import CommunityMembershipPanel from '@/app/dashboard/membership/CommunityMembershipPanel'
//   ...
//   <CommunityMembershipPanel />

import CommunityMembershipPanel from './CommunityMembershipPanel'

export const dynamic = 'force-dynamic'

export default function MembershipPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1
        style={{
          margin: '0 0 6px 0',
          fontSize: 22,
          fontWeight: 700,
          color: '#0D2137',
        }}
      >
        Membership
      </h1>
      <p style={{ margin: '0 0 20px 0', fontSize: 14, color: '#667085' }}>
        Manage your Community Membership and renewal.
      </p>
      <CommunityMembershipPanel />
    </div>
  )
}
