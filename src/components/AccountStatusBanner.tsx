'use client'

// src/components/AccountStatusBanner.tsx
//
// Phase 4f, version 2 — short headline, explanation on demand.
//
// ── WHY THE COPY IS SHORT ────────────────────────────────────
// v1 led with a paragraph reassuring the member their records were
// safe. Well-intentioned, but a banner is read in about two seconds and
// a wall of text in it reads as a problem rather than a notice. Members
// skipped it and still did not know what to do.
//
// So: one short line stating the state, one action, and a "Why?" toggle
// carrying the reassurance for anyone who wants it. Same information,
// available rather than imposed.
//
// ── WHY THIS EXISTS AT ALL ───────────────────────────────────
// Group subscription lapse emails go to the GROUP ADMIN ONLY — members
// cannot fix someone else's card, and a mass email would alarm more
// than it resolves. But that leaves members losing the ability to
// transact with no explanation. This banner is that explanation.
//
// Two components:
//   AccountStatusBanner   self-fetching, for dashboard/portal layouts
//   GroupPausedBanner     props-driven, for a group page

import { useState, useEffect } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const AMBER = '#B54708'

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
  detail,
  actionLabel,
  actionHref,
}: {
  tone: Tone
  icon: string
  title: string
  /** Shown only when the member asks. Keeps the banner to one line. */
  detail: React.ReactNode
  actionLabel?: string
  actionHref?: string
}) {
  const [open, setOpen] = useState(false)

  const palette =
    tone === 'warn'
      ? { bg: '#FFFCF5', border: '#FEC84B', fg: AMBER }
      : { bg: '#F6FEF9', border: '#A6F4C5', fg: TEAL }

  return (
    <div
      style={{
        padding: '10px 14px',
        marginBottom: 16,
        borderRadius: 10,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 160, fontSize: 13.5, fontWeight: 600, color: NAVY }}>
          {title}
        </span>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={{
            background: 'none',
            border: 'none',
            padding: '4px 6px',
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 600,
            color: palette.fg,
            textDecoration: 'underline',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {open ? 'Hide' : 'Why?'}
        </button>
        {actionLabel && actionHref ? (
          <a
            href={actionHref}
            style={{
              padding: '7px 14px',
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

      {open ? (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${palette.border}`, fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
          {detail}
        </div>
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
      actionLabel={isManager ? 'Reactivate' : undefined}
      actionHref={isManager ? '/dashboard/groups' : undefined}
      detail={
        isManager ? (
          <>
            Nothing has been deleted — contributions, loans, stakes and history are all
            intact. New activity is paused until the group subscription is renewed.
          </>
        ) : (
          <>
            Your records are safe and still viewable. New activity is paused while the
            group administrator sorts out the group subscription.
          </>
        )
      }
    />
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
  // Highest priority: the member did nothing wrong and cannot fix it.
  // No payment prompt — there is nothing for them to pay.
  if (ent.subscriptionLapsedGroupIds.length > 0 && ent.qualifyingGroupIds.length === 0) {
    return (
      <Banner
        tone="warn"
        icon="⚠️"
        title="Your group's subscription needs attention"
        detail={
          <>
            Everything you&apos;ve contributed is safe and still visible. New activity is
            paused until the group administrator resolves the group&apos;s billing —
            there&apos;s nothing you need to do.
          </>
        }
      />
    )
  }

  // ── Not entitled ────────────────────────────────────────────
  if (!ent.isEntitled) {
    return (
      <Banner
        tone="warn"
        icon="🔒"
        title="Account inactive — payment outstanding"
        actionLabel="Pay now"
        actionHref="/dashboard/join-fee"
        detail={
          <>
            You can still see everything about your own money — contributions, stakes,
            loan balances and statements are all still here. What&apos;s paused is making
            new contributions and seeing groups looking for members.
          </>
        }
      />
    )
  }

  // ── Membership ending, group keeps them covered ─────────────
  if (
    ent.communityMembership?.status === 'ACTIVE' &&
    ent.qualifyingGroupIds.length > 0 &&
    !ent.canSeeAdverts
  ) {
    return (
      <Banner
        tone="info"
        icon="ℹ️"
        title="Community Membership ending"
        detail={
          <>
            Your group membership keeps your full access, so nothing changes for your
            contributions or schemes. You&apos;ll just stop seeing groups looking for new
            members.
          </>
        }
      />
    )
  }

  return null
}
