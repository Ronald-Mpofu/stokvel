'use client'
// src/app/dashboard/groups/MobileSchemePassbook.tsx
//
// Fetches one scheme's passbook and hands it to PassbookShell.
//
// The split is deliberate. PassbookShell knows how to draw a ledger and
// nothing else — no fetching, no routing, no payment. This container knows
// where the data comes from and what the empty copy should say. So the
// shell stays reusable for the stake and repayment books when they arrive,
// and stays testable without a network.
//
// The route can legitimately return no view: the member may not be
// enrolled, the scheme's grammar may not be built, or the scheme may keep
// no ledger at all. Each is a real state with its own words, not an error,
// and none should show a spinner forever or a blank page.
//
// The admin's "set up first cycle" action carried over from the old
// NoCycleYet helper. An empty passbook is the state most admins meet first,
// and it should offer the one thing that fixes it.

import { useState, useEffect, useCallback } from 'react'
import { C, S, T, TOUCH, FONT_STACK } from '@/lib/mobile/tokens'
import { isPassbookView } from '@/lib/mobile/passbook'
import type { PassbookView } from '@/lib/mobile/passbook'
import PassbookShell from '@/components/mobile/PassbookShell'

type Unavailable = {
  reason: string
  grammar?: string
  message: string
}

// Empty-ledger copy per grammar. A savings pool and a grocery club are
// both waiting on an admin, but a member reads "collect" not "rotation".
const EMPTY_COPY: Record<string, { admin: string; member: string }> = {
  ROTATING: {
    admin: 'A cycle sets the contribution schedule and the payout order. Once it starts, everyone’s passbook fills in here.',
    member: 'Your passbook appears here once the group admin opens the first cycle.',
  },
  ACCUMULATING: {
    admin: 'A cycle sets the contribution schedule and the collection date. Once it starts, everyone’s passbook fills in here.',
    member: 'Your passbook appears here once the group admin opens the first cycle.',
  },
}

const EMPTY_FALLBACK = {
  admin: 'Once contributions start being recorded for this scheme, they appear here.',
  member: 'When contributions start being recorded for this scheme, they appear here.',
}

function Notice({
  title, body, onBack,
}: {
  title: string
  body: string
  onBack: () => void
}) {
  return (
    <div style={{ fontFamily: FONT_STACK, background: C.surfaceAlt, minHeight: '100vh' }}>
      <div style={{ background: C.navy, padding: `14px ${S.screenX}px 18px` }}>
        <button
          onClick={onBack}
          aria-label="Back"
          style={{
            width: TOUCH.icon,
            height: TOUCH.icon,
            marginLeft: -12,
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
        <div
          style={{
            color: '#fff',
            fontSize: T.title.fontSize,
            fontWeight: 500,
            marginTop: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
      </div>

      <div style={{ background: C.surface, marginTop: S.md, padding: `${S.xxl}px ${S.screenX}px` }}>
        <p
          style={{
            fontSize: T.small.fontSize,
            color: C.textMuted,
            lineHeight: 1.6,
            margin: 0,
            maxWidth: 300,
          }}
        >
          {body}
        </p>
        <button
          onClick={onBack}
          style={{
            marginTop: S.xl,
            width: '100%',
            minHeight: TOUCH.primary,
            background: C.teal,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 16,
            fontWeight: 500,
            fontFamily: FONT_STACK,
            cursor: 'pointer',
          }}
        >
          Back to your schemes
        </button>
      </div>
    </div>
  )
}

type Props = {
  schemeId: string
  schemeName: string
  onBack: () => void
  // Payment is not this component's business. The caller decides whether
  // that opens a sheet, a gateway, or a "not yet" toast.
  onPay?: (view: PassbookView) => void
  canManage?: boolean
  onStartCycle?: () => void
}

export default function MobileSchemePassbook({
  schemeId, schemeName, onBack, onPay, canManage, onStartCycle,
}: Props) {
  const [view, setView] = useState<PassbookView | null>(null)
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setUnavailable(null)
    try {
      const res = await fetch(
        `/api/schemes/passbook?schemeId=${encodeURIComponent(schemeId)}`,
        { cache: 'no-store' }
      )
      const json = await res.json()

      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Please check your connection and try again.')
      }

      if (json.data?.unavailable) {
        setUnavailable(json.data.unavailable)
        setView(null)
        return
      }

      // Guarded rather than trusted. A malformed payload should cost the
      // member a message, not a white screen.
      setView(isPassbookView(json.data?.view) ? json.data.view : null)
    } catch (e: any) {
      setError(e?.message || 'Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [schemeId])

  useEffect(() => {
    load()
  }, [load])

  if (error) {
    return <Notice title={schemeName} body={error} onBack={onBack} />
  }

  if (unavailable) {
    return <Notice title={schemeName} body={unavailable.message} onBack={onBack} />
  }

  const copy = (view && EMPTY_COPY[view.scheme.grammar]) || EMPTY_FALLBACK
  const canStart = Boolean(canManage && onStartCycle)

  return (
    <PassbookShell
      view={view}
      loading={loading}
      onBack={onBack}
      onAction={() => {
        if (view && onPay) onPay(view)
      }}
      emptyTitle={canStart ? 'Start the first cycle' : 'No cycle running yet'}
      emptyBody={canStart ? copy.admin : copy.member}
      emptyActionLabel={canStart ? 'Set up first cycle' : undefined}
      onEmptyAction={canStart ? onStartCycle : undefined}
    />
  )
}
