'use client'

// src/components/AccountStatusBanner.tsx
//
// Phase 4f.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────
// Group subscription lapse emails go to the GROUP ADMIN ONLY. That is
// the right call — members cannot fix their group's billing, and a mass
// email about someone else's card causes more alarm than it resolves.
//
// But it leaves a gap: a member whose group has lapsed loses the
// ability to transact through no fault of their own, and would
// otherwise get no explanation at all. This banner IS that explanation.
// Without it, the admin-only decision is silent failure.
//
// Two components:
//
//   AccountStatusBanner   self-fetching, for the dashboard layout.
//                         Reads entitlement from /api/auth/me and
//                         explains any loss of access.
//
//   GroupPausedBanner     props-driven, for a group page where the
//                         status is already known.
//
// ── TONE ─────────────────────────────────────────────────────
// The rule throughout: say what still works before saying what does
// not. A member who sees "your access is restricted" and nothing else
// assumes their money is at risk. It is not — records stay readable in
// every one of these states, and the banner says so first.
//
// ── PHASE 5 ──────────────────────────────────────────────────
// Entitlement is currently advisory (`enforced: false`), so these are
// warnings about what WILL happen. Copy is written to be correct either
// way, so nothing needs rewording when enforcement is switched on.

import { useState, useEffect } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const AMBER = '#B54708'
const BORDER = '#E4E7EC'

type Entitlement = {
  isEntitled: boolean
  canTransact: boolean
  canAccessPortal: boolean
  canSeeAdverts: boolean
  reasons: string[]
  qualifyingGroupIds: string[]
  subscriptionLapsedGroupIds: string[]
  communityMembership: { status: string; expiresAt: string | null } | null
}

type Tone = 'warn' | 'info'

// ── Module-level components ──────────────────────────────────

function Banner({
  tone,
  icon,
  title,
  children,
  actionLabel,
  actionHref,
}: {
  tone: Tone
  icon: string
  title: string
  children: React.ReactNode
  actionLabel?: string
  actionHref?: string
}) {
  const palette =
    tone === 'warn'
      ? { bg: '#FFFCF5', border: '#FEC84B', fg: AMBER }
      : { bg: '#F6FEF9', border: '#A6F4C5', fg: TEAL }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        marginBottom: 16,
        borderRadius: 10,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
      }}
    >
      <div style={{ fontSize: 18, lineHeight: 1 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 2 }}>
          {title}
        </div>
        <div style={{ fontSize: 12.5, color: palette.fg, lineHeight: 1.55 }}>
          {children}
        </div>
      </div>
      {actionLabel && actionHref ? (
        <a
          href={actionHref}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            background: TEAL,
            color: '#FFFFFF',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {actionLabel}
        </a>
      ) : null}
    </div>
  )
}

// ── Group-scoped banner (props-driven) ───────────────────────

export function GroupPausedBanner({
  groupName,
  status,
  isManager,
}: {
  groupName: string
  status: string
  isManager?: boolean
}) {
  if (status !== 'PAUSED') return null

  return (
    <Banner
      tone="warn"
      icon="⏸️"
      title={`${groupName} is paused`}
      actionLabel={isManager ? 'Reactivate group' : undefined}
      actionHref={isManager ? '/dashboard/groups' : undefined}
    >
      {isManager ? (
        <>
          Nothing has been deleted — contributions, loans, stakes and history are all
          intact. New activity is paused until the group subscription is renewed.
        </>
      ) : (
        <>
          Your records are safe and still viewable — contributions, stakes and balances
          are unchanged. New activity is paused while the group administrator sorts out
          the group subscription.
        </>
      )}
    </Banner>
  )
}

// ── Account-wide banner (self-fetching) ──────────────────────

export default function AccountStatusBanner() {
  const [ent, setEnt] = useState<Entitlement | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me')
        const json = await res.json()
        if (!cancelled && json.success && json.entitlement) {
          setEnt(json.entitlement as Entitlement)
        }
      } catch {
        // Silent — a banner that cannot load must not become an error
        // message of its own.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!loaded || !ent) return null

  // ── Group billing lapse ─────────────────────────────────────
  // Highest priority: the member did nothing wrong, and this is the one
  // case where the cause is entirely outside their control. Deliberately
  // does NOT name the admin or suggest chasing them.
  if (ent.subscriptionLapsedGroupIds.length > 0 && ent.qualifyingGroupIds.length === 0) {
    const n = ent.subscriptionLapsedGroupIds.length
    return (
      <Banner tone="warn" icon="⚠️" title="Your group's subscription needs attention">
        Everything you&apos;ve contributed is safe and still visible — contributions,
        stakes, loan balances and statements are all unchanged. {n === 1 ? 'A group you belong to has' : `${n} groups you belong to have`}{' '}
        a billing issue, so new activity is paused until the group administrator resolves
        it. There&apos;s nothing you need to do.
      </Banner>
    )
  }

  // ── Membership lapsed, no group to fall back on ─────────────
  if (!ent.isEntitled) {
    const expired = ent.reasons.includes('COMMUNITY_MEMBERSHIP_EXPIRED')
    return (
      <Banner
        tone="warn"
        icon="🔒"
        title={expired ? 'Your Community Membership has expired' : 'Your account is read-only'}
        actionLabel="Renew"
        actionHref="/dashboard/join-fee"
      >
        You can still see everything about your own money — contributions, stakes, loan
        balances and statements are all still here. What&apos;s paused is making new
        contributions and seeing groups advertising for members.
      </Banner>
    )
  }

  // ── Membership ending, but a group keeps them covered ───────
  if (
    ent.communityMembership?.status === 'ACTIVE' &&
    ent.qualifyingGroupIds.length > 0 &&
    !ent.canSeeAdverts
  ) {
    return (
      <Banner tone="info" icon="ℹ️" title="Community Membership ending">
        Your group membership keeps your full access, so nothing changes for your
        contributions or schemes. You&apos;ll just stop seeing groups advertising for new
        members.
      </Banner>
    )
  }

  return null
}
