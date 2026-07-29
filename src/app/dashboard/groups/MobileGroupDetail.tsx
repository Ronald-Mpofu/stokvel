'use client'
// src/app/dashboard/groups/MobileGroupDetail.tsx
//
// Phone layout for a single group. Rendered by groups/page.tsx when
// useIsMobile() is true — the desktop detail view is untouched.
//
// DESIGN NOTES
//
// No horizontal scroll anywhere. The old mobile pattern wrapped tables
// in overflow-x, which is the single most reliable way to lose a user on
// a 360px screen. Everything here is a vertical list of rows.
//
// Accordion sections rather than tabs. Four tab labels do not fit at
// 360px without truncating, and truncated labels are unusable. This also
// matches the accordion convention already used in Settings and Overview.
//
// The passbook empty state is the PRIMARY state today — Cycle,
// Contribution and PayoutSchedule are all empty — so it is written as an
// invitation with a next action, not as a placeholder.
//
// All helper components are at module level. Defined inside render they
// remount on every keystroke and steal input focus.

import { useState, useEffect, useCallback } from 'react'
import {
  C, S, T, TOUCH, FONT_STACK, MONEY_STYLE, money,
} from '@/lib/mobile/tokens'

// ── Types ─────────────────────────────────────────────────────
type PassbookEntry = {
  monthNumber: number
  dueDate: string
  amountDue: number
  amountPaid: number
  status: string
  paidAt: string | null
  paymentMethod: string | null
}

type RotationEntry = {
  monthNumber: number
  scheduledDate: string
  amount: number
  status: string
  recipientName: string | null
  isMe: boolean
}

type PassbookData = {
  group: { id: string; name: string; currency: string; status: string; contributionAmount: number }
  cycle: { id: string; number: number; startDate: string; endDate: string; totalMembers: number; poolAmount: number } | null
  me: { userId: string; position: number | null; totalPaid: number; monthsPaid: number; monthsTotal: number }
  passbook: PassbookEntry[]
  rotation: RotationEntry[]
}

type Props = {
  group: any
  members: any[]
  membersLoading: boolean
  currentUserId: string
  canManage: boolean
  onBack: () => void
  onInvite: () => void
  onOpenScheme: (schemeId: string) => void
  onStartCycle?: () => void
}

// ── Small pieces ──────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    ACTIVE:    { bg: C.tealBg,  fg: C.tealDark },
    DRAFT:     { bg: '#EEF2F7', fg: '#475569' },
    PAUSED:    { bg: C.amberBg, fg: C.amberText },
    COMPLETED: { bg: '#EEF2F7', fg: '#475569' },
    DISSOLVED: { bg: C.redBg,   fg: '#7F1D1D' },
  }
  const c = map[status] || map.DRAFT
  return (
    <span style={{
      background: c.bg, color: c.fg, fontSize: T.micro.fontSize,
      padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
    }}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

function SectionHeader({
  label, open, onToggle, hint,
}: { label: string; open: boolean; onToggle: () => void; hint?: string }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: '100%', minHeight: TOUCH.min, display: 'flex', alignItems: 'center',
        gap: S.sm, padding: `${S.md}px ${S.screenX}px`, background: C.surface,
        border: 'none', borderTop: `1px solid ${C.border}`, cursor: 'pointer',
        fontFamily: FONT_STACK, textAlign: 'left',
      }}
    >
      <span style={{ flex: 1, fontSize: T.heading.fontSize, fontWeight: 500, color: C.text }}>
        {label}
      </span>
      {hint ? (
        <span style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>{hint}</span>
      ) : null}
      <span style={{
        fontSize: 18, color: C.textMuted,
        transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms',
      }}>
        ⌄
      </span>
    </button>
  )
}

// Row height, icon size and padding are shared so the ledger scans as a
// single column even as statuses differ.
function PassbookRow({ entry, currency }: { entry: PassbookEntry; currency: string }) {
  const paid = entry.status === 'PAID' || entry.status === 'PRE_PAID'
  const overdue = !paid && new Date(entry.dueDate) < new Date()
  const notDue = !paid && !overdue

  const tone = overdue
    ? { bg: C.amberBg, chip: '#EF9F27', chipFg: C.amberText, title: C.amberText, sub: '#854F0B' }
    : paid
      ? { bg: 'transparent', chip: C.tealBg, chipFg: C.teal, title: C.text, sub: C.textFaint }
      : { bg: 'transparent', chip: C.surfaceAlt, chipFg: C.textFaint, title: C.textMuted, sub: C.textFaint }

  const monthLabel = new Date(entry.dueDate).toLocaleDateString(undefined, { month: 'long' })

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: S.md,
      padding: `13px ${S.screenX}px`, borderTop: `1px solid ${C.border}`,
      background: tone.bg, minHeight: TOUCH.min, opacity: notDue ? 0.6 : 1,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 8, background: tone.chip,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: tone.chipFg, fontSize: 17, flexShrink: 0,
      }}>
        {paid ? '✓' : overdue ? '!' : '–'}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: T.body.fontSize, fontWeight: 500, color: tone.title }}>
          {monthLabel}
        </div>
        <div style={{
          fontSize: T.caption.fontSize, color: tone.sub,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {paid
            ? `Paid ${entry.paidAt ? new Date(entry.paidAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}${entry.paymentMethod ? ` · ${entry.paymentMethod.replace(/_/g, ' ').toLowerCase()}` : ''}`
            : overdue
              ? `Due ${new Date(entry.dueDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
              : 'Not yet due'}
        </div>
      </div>

      <span style={{
        ...MONEY_STYLE, fontSize: 15, flexShrink: 0,
        fontWeight: paid ? 400 : 500,
        color: overdue ? C.amberText : paid ? C.textMuted : C.textFaint,
      }}>
        {money(entry.amountDue, currency)}
      </span>
    </div>
  )
}

// The empty state is the screen most admins will see today. It names the
// situation and gives one next action — not a shrug.
function NoCycleYet({ canManage, onStartCycle }: { canManage: boolean; onStartCycle?: () => void }) {
  return (
    <div style={{ padding: `${S.xxl}px ${S.screenX}px`, textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16, background: C.tealBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 14px', fontSize: 26, color: C.teal,
      }}>
        ↻
      </div>
      <div style={{ fontSize: T.title.fontSize, fontWeight: 500, color: C.text, marginBottom: 6 }}>
        {canManage ? 'Start the first cycle' : 'Saving hasn’t started yet'}
      </div>
      <p style={{
        fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.55,
        margin: '0 auto', maxWidth: 280,
      }}>
        {canManage
          ? 'A cycle sets the contribution schedule and the payout order. Once it starts, everyone’s passbook fills in here.'
          : 'Your passbook appears here once the group admin opens the first cycle.'}
      </p>
      {canManage && onStartCycle ? (
        <button
          onClick={onStartCycle}
          style={{
            marginTop: S.xl, minHeight: TOUCH.primary, width: '100%',
            background: C.teal, color: '#fff', border: 'none', borderRadius: 12,
            fontSize: 16, fontWeight: 500, fontFamily: FONT_STACK, cursor: 'pointer',
          }}
        >
          Set up first cycle
        </button>
      ) : null}
    </div>
  )
}

function MemberRow({ member, isMe }: { member: any; isMe: boolean }) {
  const name = member.fullName || 'Member'
  const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: S.md,
      padding: `11px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}`,
      minHeight: TOUCH.min,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%', background: C.tealBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: T.caption.fontSize, fontWeight: 500, color: C.tealDark, flexShrink: 0,
      }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: T.body.fontSize, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}{isMe ? ' (you)' : ''}
        </div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>
          {(member.role || 'MEMBER').replace(/_/g, ' ').toLowerCase()}
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function MobileGroupDetail({
  group, members, membersLoading, currentUserId, canManage,
  onBack, onInvite, onOpenScheme, onStartCycle,
}: Props) {
  const [data, setData] = useState<PassbookData | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string[]>(['passbook'])
  const [showAllMembers, setShowAllMembers] = useState(false)

  const toggle = useCallback((key: string) => {
    setOpen(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }, [])

  useEffect(() => {
    if (!group?.id) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/groups/passbook?groupId=${group.id}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d.success) setData(d.data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [group?.id])

  const currency = data?.group.currency || group?.currency || 'USD'
  const cycle = data?.cycle ?? null
  const passbook = data?.passbook ?? []
  const me = data?.me

  const nextDue = passbook.find(p => p.status !== 'PAID' && p.status !== 'PRE_PAID')
  const receiver = data?.rotation.find(r => r.status !== 'COMPLETED')
  const visibleMembers = showAllMembers ? members : members.slice(0, 5)

  return (
    <div style={{
      fontFamily: FONT_STACK, background: C.surfaceAlt, minHeight: '100vh',
      paddingBottom: nextDue ? 'calc(84px + env(safe-area-inset-bottom, 0px))' : S.xxl,
    }}>

      {/* Header */}
      <div style={{ background: C.navy, padding: `14px ${S.screenX}px 16px` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, marginBottom: 14 }}>
          <button
            onClick={onBack}
            aria-label="Back to groups"
            style={{
              width: TOUCH.icon, height: TOUCH.icon, marginLeft: -12,
              background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.8)',
              fontSize: 22, cursor: 'pointer',
            }}
          >
            ←
          </button>
          <span style={{
            flex: 1, color: '#fff', fontSize: T.heading.fontSize, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {group?.name}
          </span>
          <StatusPill status={group?.status || 'DRAFT'} />
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: S.sm }}>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: T.caption.fontSize }}>
            Your total in
          </span>
          <span style={{ ...MONEY_STYLE, color: '#fff', fontSize: T.display.fontSize, fontWeight: 500 }}>
            {money(me?.totalPaid ?? 0, currency)}
          </span>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: T.caption.fontSize, marginTop: 2 }}>
          {cycle && me
            ? `${me.monthsPaid} of ${me.monthsTotal} months paid`
            : `${group?.memberCount ?? 0} members · ${money(group?.contributionAmount ?? 0, currency)} per month`}
        </div>
      </div>

      {/* Rotation strip — the thing members open the app to check */}
      {receiver ? (
        <div style={{
          background: C.tealBg, padding: `12px ${S.screenX}px`,
          display: 'flex', alignItems: 'center', gap: 11,
        }}>
          <span style={{ fontSize: 20, color: C.teal }}>◷</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: T.small.fontSize, color: C.tealDark, fontWeight: 500 }}>
              {receiver.isMe ? 'You receive this month' : `${receiver.recipientName || 'A member'} receives this month`}
            </div>
            <div style={{ fontSize: T.caption.fontSize, color: C.teal }}>
              {me?.position ? `You are ${me.position} in the rotation` : 'You are not in this rotation'}
            </div>
          </div>
        </div>
      ) : null}

      {/* Passbook */}
      <div style={{ background: C.surface, marginTop: S.md }}>
        <SectionHeader
          label="Your passbook"
          hint={cycle ? `Cycle ${cycle.number}` : undefined}
          open={open.includes('passbook')}
          onToggle={() => toggle('passbook')}
        />
        {open.includes('passbook') ? (
          loading ? (
            <div style={{ padding: `${S.xl}px ${S.screenX}px`, color: C.textFaint, fontSize: T.small.fontSize }}>
              Loading…
            </div>
          ) : passbook.length === 0 ? (
            <NoCycleYet canManage={canManage} onStartCycle={onStartCycle} />
          ) : (
            passbook.map(entry => (
              <PassbookRow key={entry.monthNumber} entry={entry} currency={currency} />
            ))
          )
        ) : null}
      </div>

      {/* Members */}
      <div style={{ background: C.surface, marginTop: S.md }}>
        <SectionHeader
          label="Members"
          hint={String(members.length || group?.memberCount || 0)}
          open={open.includes('members')}
          onToggle={() => toggle('members')}
        />
        {open.includes('members') ? (
          <div>
            {membersLoading ? (
              <div style={{ padding: `${S.xl}px ${S.screenX}px`, color: C.textFaint, fontSize: T.small.fontSize }}>
                Loading…
              </div>
            ) : members.length === 0 ? (
              <div style={{ padding: `${S.xl}px ${S.screenX}px` }}>
                <p style={{ fontSize: T.small.fontSize, color: C.textMuted, margin: `0 0 ${S.lg}px` }}>
                  No members yet. Invite people to start building the group.
                </p>
                {canManage ? (
                  <button
                    onClick={onInvite}
                    style={{
                      minHeight: TOUCH.min, width: '100%', background: C.surface,
                      color: C.teal, border: `1px solid ${C.teal}`, borderRadius: 12,
                      fontSize: 15, fontWeight: 500, fontFamily: FONT_STACK, cursor: 'pointer',
                    }}
                  >
                    Invite members
                  </button>
                ) : null}
              </div>
            ) : (
              <div>
                {visibleMembers.map((m: any) => (
                  <MemberRow key={m.userId || m.id} member={m} isMe={m.userId === currentUserId} />
                ))}
                {members.length > 5 && !showAllMembers ? (
                  <button
                    onClick={() => setShowAllMembers(true)}
                    style={{
                      width: '100%', minHeight: TOUCH.min, background: 'transparent',
                      border: 'none', borderTop: `1px solid ${C.borderLight}`,
                      color: C.teal, fontSize: T.small.fontSize, fontFamily: FONT_STACK,
                      cursor: 'pointer',
                    }}
                  >
                    Show all {members.length} members
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Sticky pay bar — thumb reach, names the amount and the month */}
      {nextDue ? (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          background: C.surface, borderTop: `1px solid ${C.border}`,
          padding: `${S.md}px ${S.screenX}px calc(${S.md}px + env(safe-area-inset-bottom, 0px))`,
          zIndex: 40,
        }}>
          <button
            onClick={() => onOpenScheme('contribute')}
            style={{
              width: '100%', minHeight: TOUCH.primary, background: C.teal, color: '#fff',
              border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 500,
              fontFamily: FONT_STACK, cursor: 'pointer',
            }}
          >
            Pay {money(nextDue.amountDue, currency)} for{' '}
            {new Date(nextDue.dueDate).toLocaleDateString(undefined, { month: 'long' })}
          </button>
        </div>
      ) : null}

    </div>
  )
}
