'use client'
// src/app/dashboard/groups/MobileSchemeHub.tsx
//
// The group screen. Six scheme cards, each showing where this member
// stands, and a tap opens that scheme's passbook.
//
// This replaces the single passbook that used to sit inside
// MobileGroupDetail. Cycles now belong to schemes, so a member in four
// schemes keeps four books — exactly as they would on paper — and the
// group screen becomes the index rather than the ledger.
//
// ONE REQUEST
//   Everything here comes from /api/groups/schemes in a single call.
//   Nothing is fetched per card.
//
// WHO MAY ACT
//   canManage and each card's adminAction arrive from the route. This file
//   never inspects a role or a token — an admin gets the create action
//   because the server said so, and the create endpoint checks again anyway.
//
// NO DERIVATION
//   subtitle and trailing arrive as finished strings. This file decides
//   colour and layout, never meaning. If a card reads wrongly, the fix
//   belongs in the route.
//
// WHY THIS OWNS THE SCREEN CHROME
//   It renders the navy header itself, including the group name and the
//   two money figures. MobileGroupDetail used to own that header; having
//   both render one would stack two headers on a 360px screen. So the
//   caller passes what it still owns through two slots — statusPill and
//   footer — rather than wrapping this component in another header.
//
// All sub-components are at module level. Declared inside the render they
// would remount on every state change and rebuild the whole list.

import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  C, S, T, TOUCH, FONT_STACK, MONEY_STYLE, money,
} from '@/lib/mobile/tokens'
import { APP_BOTTOM_NAV_HEIGHT } from '@/lib/mobile/passbook'
import MobileGroceryClubSheet from './MobileGroceryClubSheet'

export type HubScheme = {
  id: string
  name: string
  schemeType: string
  grammar: string
  state: 'NOT_ENROLLED' | 'NOT_AVAILABLE' | 'NO_LEDGER' | 'NOT_STARTED' | 'ACTIVE'
  enrolled: boolean
  openable: boolean
  subtitle: string
  trailing: string
  contributionAmount: number | null
  contributionFrequency: string | null
  amount: number | null
  overdue: boolean
  monthsPaid: number
  monthsTotal: number
  // Server-decided admin affordance. 'CREATE' means the caller manages this
  // group, is not in this scheme, and a mobile create sheet exists for it.
  adminAction: 'CREATE' | null
}

type HubData = {
  group: {
    id: string
    name: string | null
    currency: string
    city: string | null
    country: string | null
    memberCount: number
  }
  totals: {
    holdings: number
    dueNow: number
    schemesEnrolled: number
    schemesTotal: number
  }
  schemes: HubScheme[]
  // Resolved server-side from GroupMember.role and Group.adminUserId. Used
  // for display only — every write endpoint re-authorises independently.
  canManage: boolean
}

// Amber for anything owed, so a debt never wears the same colour as a
// holding. Matches the passbook's own inversion.
const AMBER_ON_NAVY = '#FAC775'

// One glyph per scheme type. Text rather than an icon font: one less asset
// to download on a metered connection, and it renders on a device with no
// icon support at all.
const GLYPH: Record<string, string> = {
  SAVINGS_POOL: '◉',
  GROCERY_CLUB: '▣',
  ASSETS: '▤',
  PROPERTY: '⌂',
  INVESTMENT: '◈',
  LOANS: '◐',
}

function SchemeCard({
  scheme, currency, onOpen, onCreate,
}: {
  scheme: HubScheme
  currency: string
  onOpen: (s: HubScheme) => void
  onCreate: (s: HubScheme) => void
}) {
  // A manager's not-enrolled card is an invitation to set the scheme up, not
  // a dead end. "Ask your admin" shown to the admin is the bug this fixes.
  const isCreate = !scheme.openable && scheme.adminAction === 'CREATE'
  const dim = !scheme.enrolled
  const owed = scheme.overdue

  const chipBg = dim ? C.surfaceAlt : owed ? C.amberBg : C.tealBg
  const chipFg = dim ? C.textFaint : owed ? C.amberText : C.teal

  // Money is formatted here, not on the server. The route sends the terms
  // as a number so a group in AUD does not read "150 monthly".
  const subtitle = [
    scheme.subtitle,
    typeof scheme.contributionAmount === 'number' && scheme.contributionAmount > 0
      ? `${money(scheme.contributionAmount, currency)} ${scheme.contributionFrequency || 'monthly'}`
      : '',
  ].filter(Boolean).join(' · ')

  // A card that cannot be opened renders as a div, not a disabled button.
  // A member should not be able to tap into a dead end and be told nothing
  // happened.
  const interactive = scheme.openable || isCreate

  const inner = (
    <>
      <div
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          flexShrink: 0,
          background: chipBg,
          color: chipFg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 17,
        }}
      >
        {GLYPH[scheme.schemeType] || '●'}
      </div>

      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <div
          style={{
            fontSize: T.body.fontSize,
            fontWeight: 500,
            color: dim ? C.textMuted : C.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {scheme.name}
        </div>
        <div
          style={{
            fontSize: T.caption.fontSize,
            color: C.textFaint,
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {subtitle}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0, maxWidth: 118 }}>
        {typeof scheme.amount === 'number' ? (
          <div style={{ ...MONEY_STYLE, fontSize: 15, color: C.text }}>
            {money(scheme.amount, currency)}
          </div>
        ) : null}
        <div
          style={{
            fontSize: T.caption.fontSize,
            marginTop: 2,
            color: isCreate ? C.teal : owed ? C.amberText : C.textFaint,
            fontWeight: isCreate ? 500 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {scheme.trailing}
        </div>
      </div>
    </>
  )

  const shared = {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: S.md,
    width: '100%',
    minHeight: TOUCH.min,
    padding: `13px ${S.screenX}px`,
    background: dim ? C.surfaceAlt : C.surface,
    fontFamily: FONT_STACK,
    textAlign: 'left' as const,
  }

  if (!interactive) {
    return <div style={{ ...shared, borderTop: `1px solid ${C.border}` }}>{inner}</div>
  }

  return (
    <button
      onClick={() => (isCreate ? onCreate(scheme) : onOpen(scheme))}
      aria-label={isCreate ? `Set up ${scheme.name}` : `Open ${scheme.name}`}
      style={{ ...shared, border: 'none', borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}
    >
      {inner}
    </button>
  )
}

function HubSkeleton() {
  // Placeholder rows at the real card height, so the list does not jump
  // when data lands.
  return (
    <div aria-busy="true" aria-label="Loading your schemes">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: S.md,
            minHeight: TOUCH.min,
            padding: `13px ${S.screenX}px`,
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: 9, background: C.surfaceAlt, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ height: 11, width: '44%', borderRadius: 4, background: C.surfaceAlt }} />
            <div style={{ height: 9, width: '62%', borderRadius: 4, background: C.surfaceAlt, marginTop: 7 }} />
          </div>
          <div style={{ width: 52, height: 11, borderRadius: 4, background: C.surfaceAlt, flexShrink: 0 }} />
        </div>
      ))}
    </div>
  )
}

function HubError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: `${S.xxl}px ${S.screenX}px`, textAlign: 'center' }}>
      <div style={{ fontSize: T.body.fontSize, color: C.text, marginBottom: 6 }}>
        Could not load your schemes
      </div>
      <p
        style={{
          fontSize: T.small.fontSize,
          color: C.textMuted,
          margin: `0 auto ${S.lg}px`,
          maxWidth: 280,
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>
      <button
        onClick={onRetry}
        style={{
          minHeight: TOUCH.primary,
          padding: `0 ${S.xl}px`,
          background: C.teal,
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          fontSize: 16,
          fontFamily: FONT_STACK,
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  )
}

type Props = {
  groupId: string
  onOpenScheme: (scheme: HubScheme) => void
  onBack?: () => void
  // Rendered beside the group name. The caller owns the group's status
  // because status is a group fact, not a scheme fact.
  statusPill?: ReactNode
  // Rendered below the scheme list. Members, settings, anything else the
  // group screen still carries.
  footer?: ReactNode
  // Set when the hub is mounted inside a page that already provides its
  // own chrome and background — the member portal, for instance. It then
  // does not claim a full viewport height on top of the host page.
  embedded?: boolean
}

export default function MobileSchemeHub({
  groupId, onOpenScheme, onBack, statusPill, footer, embedded,
}: Props) {
  const [data, setData] = useState<HubData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Which scheme type's create sheet is open, if any.
  const [createFor, setCreateFor] = useState<HubScheme | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // State lives in the component, not at module level. Module-level caches
  // do not survive App Router client navigations reliably, so a value
  // stashed there reads as stale or empty on the second visit.
  const load = useCallback(async () => {
    if (!groupId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/groups/schemes?groupId=${encodeURIComponent(groupId)}`, {
        cache: 'no-store',
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Please check your connection and try again.')
      }
      setData(json.data)
    } catch (e: any) {
      setError(e?.message || 'Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = useCallback((scheme: HubScheme) => {
    setNotice(null)
    setCreateFor(scheme)
  }, [])

  const closeCreate = useCallback(() => setCreateFor(null), [])

  const afterCreate = useCallback((message: string) => {
    setCreateFor(null)
    setNotice(message)
    // Reload rather than patch local state: creating a club changes the
    // caller's enrolment, the scheme's state and the header totals, and the
    // route is the only thing that decides what those now read.
    load()
  }, [load])

  const currency = data?.group.currency || 'USD'
  const place = [data?.group.city, data?.group.country].filter(Boolean).join(', ')
  const meta = [
    place,
    data?.group.memberCount ? `${data.group.memberCount} members` : null,
    currency,
  ].filter(Boolean).join(' · ')

  return (
    <div
      style={{
        fontFamily: FONT_STACK,
        background: C.surfaceAlt,
        minHeight: embedded ? undefined : '100vh',
        borderRadius: embedded ? 14 : undefined,
        overflow: embedded ? 'hidden' : undefined,
      }}
    >

      <div style={{ background: C.navy, padding: `14px ${S.screenX}px 18px` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm }}>
          {onBack ? (
            <button
              onClick={onBack}
              aria-label="Back to groups"
              style={{
                width: TOUCH.icon,
                height: TOUCH.icon,
                marginLeft: -12,
                flexShrink: 0,
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.8)',
                fontSize: 22,
                cursor: 'pointer',
                fontFamily: FONT_STACK,
              }}
            >
              ←
            </button>
          ) : null}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              color: '#fff',
              fontSize: T.heading.fontSize,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {data?.group.name || ' '}
          </span>
          {statusPill}
        </div>

        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: T.caption.fontSize, marginTop: 4 }}>
          {meta}
        </div>

        {data ? (
          <div
            style={{
              display: 'flex',
              gap: S.xl,
              marginTop: 16,
              paddingTop: 13,
              borderTop: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: T.caption.fontSize, color: 'rgba(255,255,255,0.6)' }}>
                Your holdings
              </div>
              <div style={{ ...MONEY_STYLE, fontSize: 24, color: '#fff', marginTop: 2 }}>
                {money(data.totals.holdings, currency)}
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: T.caption.fontSize,
                  color: data.totals.dueNow > 0 ? AMBER_ON_NAVY : 'rgba(255,255,255,0.6)',
                }}
              >
                Due now
              </div>
              <div
                style={{
                  ...MONEY_STYLE,
                  fontSize: 24,
                  marginTop: 2,
                  color: data.totals.dueNow > 0 ? AMBER_ON_NAVY : 'rgba(255,255,255,0.55)',
                }}
              >
                {money(data.totals.dueNow, currency)}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ background: C.surface, marginTop: S.md }}>
        <div style={{ display: 'flex', alignItems: 'baseline', padding: `${S.md}px ${S.screenX}px 4px` }}>
          <span style={{ flex: 1, fontSize: T.small.fontSize, color: C.textMuted }}>
            Your schemes
          </span>
          {data ? (
            <span style={{ fontSize: T.caption.fontSize, color: C.textFaint, whiteSpace: 'nowrap' }}>
              You are in {data.totals.schemesEnrolled} of {data.totals.schemesTotal}
            </span>
          ) : null}
        </div>

        {notice ? (
          <div
            role="status"
            style={{
              margin: `0 ${S.screenX}px ${S.sm}px`,
              padding: `${S.sm}px ${S.md}px`,
              background: C.tealBg,
              color: C.tealDark,
              borderRadius: 10,
              fontSize: T.small.fontSize,
              lineHeight: 1.45,
            }}
          >
            {notice}
          </div>
        ) : null}

        {loading ? (
          <HubSkeleton />
        ) : error ? (
          <HubError message={error} onRetry={load} />
        ) : (
          (data?.schemes || []).map(s => (
            <SchemeCard
              key={s.id}
              scheme={s}
              currency={currency}
              onOpen={onOpenScheme}
              onCreate={openCreate}
            />
          ))
        )}
      </div>

      {footer}

      {createFor && createFor.schemeType === 'GROCERY_CLUB' ? (
        <MobileGroceryClubSheet
          groupId={groupId}
          onClose={closeCreate}
          onCreated={afterCreate}
        />
      ) : null}

      {/* Clears the app's fixed bottom nav. Without it the last scheme
          card sits underneath Home / Groups / Pool / Alerts / More. */}
      <div
        style={{
          height: embedded
            ? S.xxl
            : `calc(${APP_BOTTOM_NAV_HEIGHT}px + ${S.xxl}px + env(safe-area-inset-bottom, 0px))`,
        }}
      />
    </div>
  )
}
