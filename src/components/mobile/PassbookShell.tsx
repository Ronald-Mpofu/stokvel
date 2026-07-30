'use client'
// src/components/mobile/PassbookShell.tsx
//
// The one screen every windfall scheme's passbook is rendered in.
//
// Savings pool, grocery club, solar kit, property stake, investment
// holding and loan repayment all arrive here. What differs between them is
// the ledger rows, the three standing figures and the verb on the button —
// all of which are data. Nothing structural changes, which is why a
// seventh scheme later is a configuration entry rather than a new screen.
//
// LAYOUT RULES
//
// No horizontal scroll anywhere. Everything is a vertical list; the widest
// element is the row, and the row truncates rather than pushing the
// column. On a 360px handset a sideways-scrolling ledger is unusable.
//
// The button is at the bottom because that is where a thumb rests, and it
// names its amount so paying takes no arithmetic and no menu.
//
// Three KPIs maximum. A fourth truncates at 360px, and a truncated number
// is worse than an absent one.
//
// All sub-components are at module level. Declared inside the render they
// would remount on every state change and rebuild the whole ledger.

import { useMemo } from 'react'
import {
  C, S, T, TOUCH, FONT_STACK, MONEY_STYLE, money,
} from '@/lib/mobile/tokens'
import {
  safeRows, safeKpis, HERO_DEBIT_ON_NAVY,
} from '@/lib/mobile/passbook'
import type { PassbookView, PassbookKpi, PassbookQueue } from '@/lib/mobile/passbook'
import LedgerRow from './LedgerRow'

// ── Header pieces ─────────────────────────────────────────────
function HeaderKpi({ kpi }: { kpi: PassbookKpi }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: T.caption.fontSize,
          color: 'rgba(255,255,255,0.55)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {kpi.label}
      </div>
      <div
        style={{
          ...MONEY_STYLE,
          fontSize: T.small.fontSize,
          color: '#fff',
          marginTop: 2,
          whiteSpace: 'nowrap',
        }}
      >
        {kpi.value}
      </div>
    </div>
  )
}

function ProgressBar({ pct, tone }: { pct: number; tone: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: 7,
        borderRadius: 4,
        background: 'rgba(255,255,255,0.14)',
        overflow: 'hidden',
        marginTop: 11,
      }}
    >
      <div style={{ width: `${clamped}%`, height: 7, background: tone }} />
    </div>
  )
}

// The round-robin queue, published to everyone in it. Eight blocks fit at
// 360px; past that the blocks collapse to a summary line instead of
// shrinking below a legible size.
function QueueStrip({ queue }: { queue: PassbookQueue }) {
  const blocks = useMemo(() => {
    if (queue.total > 8) return null
    return Array.from({ length: queue.total }, (_, i) => i + 1)
  }, [queue.total])

  return (
    <div style={{ marginTop: 16 }}>
      {blocks ? (
        <div style={{ display: 'flex', gap: 6 }}>
          {blocks.map(n => {
            const isMe = n === queue.position
            const done = n <= queue.delivered
            return (
              <div
                key={n}
                style={{
                  flex: 1,
                  height: 30,
                  borderRadius: 5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: T.caption.fontSize,
                  background: isMe ? '#5DCAA5' : done ? C.teal : 'rgba(255,255,255,0.12)',
                  color: isMe ? C.tealDark : done ? '#fff' : 'rgba(255,255,255,0.75)',
                }}
              >
                {isMe ? 'You' : n}
              </div>
            )
          })}
        </div>
      ) : (
        <div
          style={{
            fontSize: T.small.fontSize,
            color: '#fff',
            background: 'rgba(255,255,255,0.10)',
            borderRadius: 8,
            padding: `8px ${S.md}px`,
          }}
        >
          Position {queue.position} of {queue.total}
        </div>
      )}
      <div style={{ fontSize: T.caption.fontSize, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>
        {queue.caption}
      </div>
    </div>
  )
}

// ── Empty and loading ─────────────────────────────────────────
// An empty passbook is a normal state, not a failure — a scheme with no
// cycle yet is exactly where most groups start. So it names the situation
// and offers the next action rather than shrugging.
function PassbookEmpty({
  title, body, actionLabel, onAction,
}: {
  title: string
  body: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div style={{ padding: `${S.xxl}px ${S.screenX}px`, textAlign: 'center' }}>
      <div
        aria-hidden="true"
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: C.tealBg,
          color: C.teal,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 14px',
          fontSize: 26,
        }}
      >
        ↻
      </div>
      <div
        style={{
          fontSize: T.title.fontSize,
          fontWeight: 500,
          color: C.text,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontSize: T.small.fontSize,
          color: C.textMuted,
          lineHeight: 1.55,
          margin: '0 auto',
          maxWidth: 280,
        }}
      >
        {body}
      </p>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
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
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function LedgerSkeleton() {
  // Three grey rows at the real row height, so the ledger does not jump
  // when data lands. A spinner would reflow the whole column.
  const rows = [0, 1, 2]
  return (
    <div aria-busy="true" aria-label="Loading your passbook">
      {rows.map(i => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: S.md,
            padding: `13px ${S.screenX}px`,
            minHeight: TOUCH.min,
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <div style={{ width: 34, height: 34, borderRadius: 8, background: C.surfaceAlt, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ height: 11, width: '46%', borderRadius: 4, background: C.surfaceAlt }} />
            <div style={{ height: 9, width: '64%', borderRadius: 4, background: C.surfaceAlt, marginTop: 7 }} />
          </div>
          <div style={{ width: 48, height: 11, borderRadius: 4, background: C.surfaceAlt, flexShrink: 0 }} />
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
type Props = {
  view: PassbookView | null
  loading: boolean
  onBack: () => void
  // Fired by the sticky bar. The shell does not know how a payment is
  // taken — that stays with the caller, so this component never imports a
  // payment module.
  onAction: () => void
  // Shown when the scheme has no ledger yet.
  emptyTitle: string
  emptyBody: string
  emptyActionLabel?: string
  onEmptyAction?: () => void
}

export default function PassbookShell({
  view, loading, onBack, onAction,
  emptyTitle, emptyBody, emptyActionLabel, onEmptyAction,
}: Props) {
  const rows = safeRows(view)
  const kpis = safeKpis(view)
  const currency = view?.scheme.currency || 'USD'
  const debit = view?.hero.tone === 'DEBIT'
  const heroColor = debit ? HERO_DEBIT_ON_NAVY : '#fff'
  const showBar = Boolean(view && view.action.kind !== 'NONE' && rows.length > 0)

  return (
    <div
      style={{
        fontFamily: FONT_STACK,
        background: C.surfaceAlt,
        minHeight: '100vh',
        paddingBottom: showBar
          ? 'calc(84px + env(safe-area-inset-bottom, 0px))'
          : S.xxl,
      }}
    >

      <div style={{ background: C.navy, padding: `14px ${S.screenX}px 18px` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm }}>
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
          <span
            style={{
              flex: 1,
              minWidth: 0,
              color: 'rgba(255,255,255,0.6)',
              fontSize: T.caption.fontSize,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {view?.scheme.groupName || ''}
          </span>
        </div>

        <div
          style={{
            color: '#fff',
            fontSize: T.title.fontSize,
            fontWeight: 500,
            marginTop: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {view?.scheme.name || ' '}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: T.caption.fontSize, marginTop: 3 }}>
          {view?.terms || ''}
        </div>

        {view ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: T.caption.fontSize, color: 'rgba(255,255,255,0.6)' }}>
              {view.hero.label}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
              <span
                style={{
                  ...MONEY_STYLE,
                  fontSize: T.display.fontSize,
                  fontWeight: 500,
                  color: heroColor,
                }}
              >
                {money(view.hero.amount, currency)}
              </span>
              {typeof view.hero.ofAmount === 'number' ? (
                <span style={{ fontSize: T.caption.fontSize, color: 'rgba(255,255,255,0.6)' }}>
                  of {money(view.hero.ofAmount, currency)}
                </span>
              ) : null}
            </div>
            {typeof view.hero.progressPct === 'number' ? (
              <ProgressBar pct={view.hero.progressPct} tone={debit ? HERO_DEBIT_ON_NAVY : '#5DCAA5'} />
            ) : null}
          </div>
        ) : null}

        {kpis.length > 0 ? (
          <div
            style={{
              display: 'flex',
              gap: S.xl,
              marginTop: 16,
              paddingTop: 13,
              borderTop: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            {kpis.map(k => (
              <HeaderKpi key={k.label} kpi={k} />
            ))}
          </div>
        ) : null}

        {view?.queue ? <QueueStrip queue={view.queue} /> : null}
      </div>

      <div style={{ background: C.surface, marginTop: S.md }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: S.sm,
            padding: `${S.md}px ${S.screenX}px 4px`,
          }}
        >
          <span style={{ flex: 1, fontSize: T.small.fontSize, color: C.textMuted }}>
            {view?.caption.left || 'Your passbook'}
          </span>
          <span style={{ fontSize: T.caption.fontSize, color: C.textFaint, whiteSpace: 'nowrap' }}>
            {view?.caption.right || ''}
          </span>
        </div>

        {loading ? (
          <LedgerSkeleton />
        ) : rows.length === 0 ? (
          <PassbookEmpty
            title={emptyTitle}
            body={emptyBody}
            actionLabel={emptyActionLabel}
            onAction={onEmptyAction}
          />
        ) : (
          rows.map(r => <LedgerRow key={r.id} row={r} currency={currency} />)
        )}
      </div>

      {showBar && view ? (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 40,
            background: C.surface,
            borderTop: `1px solid ${C.border}`,
            padding: `${S.md}px ${S.screenX}px calc(${S.md}px + env(safe-area-inset-bottom, 0px))`,
            display: 'flex',
            alignItems: 'center',
            gap: S.md,
          }}
        >
          <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, lineHeight: 1.35, flexShrink: 0 }}>
            {view.action.hintTop}
            <br />
            {view.action.hintBottom}
          </div>
          <button
            onClick={onAction}
            style={{
              flex: 1,
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
            {view.action.verb}
            {typeof view.action.amount === 'number'
              ? ` ${money(view.action.amount, currency)}`
              : ''}
          </button>
        </div>
      ) : null}

    </div>
  )
}
