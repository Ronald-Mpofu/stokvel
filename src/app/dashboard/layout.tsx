// src/app/dashboard/layout.tsx
// Wrapper for every /dashboard/* page.
//
// Phase 5.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────
// Middleware no longer redirects members without an active membership
// to the payment page — that gate read a stale JWT claim and, worse,
// trapped every invited member (rule 3b) in a permanent redirect to a
// fee they never owe.
//
// So a member whose membership has lapsed now REACHES their dashboard.
// This layout is what explains why some things are unavailable, via
// AccountStatusBanner. Without it they would find buttons returning 402
// with no visible reason.
//
// ── DELIBERATELY NOT A GATE ──────────────────────────────────
// No redirect and no server-side entitlement resolution here. Reading
// records is always allowed — the floor is read-only, not locked out.
// Enforcement lives on mutating API routes, where requireEntitlement()
// returns 402.
//
// Keeping this layout free of data fetching also keeps it free of a
// per-navigation query, and avoids a redirect loop with the fee page
// that sits inside this same route segment.
//
// Nested layouts (settings, for example) continue to work — Next.js
// composes them inside this one.

import AccountStatusBanner from '@/components/AccountStatusBanner'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div>
      <div style={{ padding: '16px 24px 0' }}>
        <AccountStatusBanner />
      </div>
      {children}
    </div>
  )
}
