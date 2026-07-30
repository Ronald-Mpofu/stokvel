'use client'
// src/app/dashboard/groups/MobileGroupDetail.tsx
//
// Phone layout for a single group. Rendered by groups/page.tsx when
// useIsMobile() is true — the desktop detail view is untouched.
//
// WHAT CHANGED
//
// This screen used to BE the passbook: one ledger, resolved by groupId.
// Cycles now belong to schemes, so a group running a savings pool and a
// grocery club has two active cycles, and one screen cannot hold both.
// A member in four schemes keeps four books — exactly as they would on
// paper.
//
// So this became a two-level screen. Level one is the hub: every scheme
// with this member's standing in it. Level two is one scheme's passbook.
// The switch is local state, not a route, because back should return to
// the hub with the list where the member left it — not reload it.
//
// The passbook fetch, PassbookRow and NoCycleYet all moved out. The empty
// state's "set up first cycle" action survived: it now lives in
// MobileSchemePassbook, which passes it to PassbookShell.
//
// DESIGN NOTES THAT STILL HOLD
//
// No horizontal scroll anywhere. Everything is a vertical list of rows.
//
// Accordion sections rather than tabs. Four tab labels do not fit at 360px
// without truncating, and truncated labels are unusable.
//
// All helper components are at module level. Defined inside render they
// remount on every keystroke and steal input focus.

import { useState, useCallback } from 'react'
import {
  C, S, T, TOUCH, FONT_STACK,
} from '@/lib/mobile/tokens'
import MobileSchemeHub from './MobileSchemeHub'
import type { HubScheme } from './MobileSchemeHub'
import MobileSchemePassbook from './MobileSchemePassbook'

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

function EmptyMembers({ canManage, onInvite }: { canManage: boolean; onInvite: () => void }) {
  return (
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
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function MobileGroupDetail({
  group, members, membersLoading, currentUserId, canManage,
  onBack, onInvite, onOpenScheme, onStartCycle,
}: Props) {
  // Which scheme's passbook is open, if any. Local state rather than a
  // route: returning to the hub must not refetch it or lose scroll.
  const [openPassbook, setOpenPassbook] = useState<HubScheme | null>(null)
  const [open, setOpen] = useState<string[]>(['members'])
  const [showAllMembers, setShowAllMembers] = useState(false)

  const toggle = useCallback((key: string) => {
    setOpen(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }, [])

  const closePassbook = useCallback(() => setOpenPassbook(null), [])

  // Level two: one scheme's ledger, full screen.
  if (openPassbook) {
    return (
      <MobileSchemePassbook
        schemeId={openPassbook.id}
        schemeName={openPassbook.name}
        onBack={closePassbook}
        canManage={canManage}
        onStartCycle={onStartCycle}
        // The pay action keeps the contract the parent already handles.
        // groups/page.tsx receives the same sentinel it received from the
        // old sticky bar, so nothing upstream needs changing today. When a
        // real payment flow exists this should pass a scheme id instead.
        onPay={() => onOpenScheme('contribute')}
      />
    )
  }

  const visibleMembers = showAllMembers ? members : members.slice(0, 5)

  // Passed to the hub as its footer. Plain JSX, not a component defined in
  // render — nothing here holds input focus, so there is no remount cost.
  const membersSection = (
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
            <EmptyMembers canManage={canManage} onInvite={onInvite} />
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
  )

  // A group with no id cannot be loaded. Say so rather than rendering a
  // hub that will fail its own fetch.
  if (!group?.id) {
    return (
      <div style={{
        fontFamily: FONT_STACK, background: C.surfaceAlt, minHeight: '100vh',
        padding: `${S.xxl}px ${S.screenX}px`,
      }}>
        <div style={{ fontSize: T.body.fontSize, color: C.text, marginBottom: 6 }}>
          Group not available
        </div>
        <p style={{ fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5, margin: `0 0 ${S.xl}px` }}>
          This group could not be opened. Go back and try again.
        </p>
        <button
          onClick={onBack}
          style={{
            minHeight: TOUCH.primary, width: '100%', background: C.teal, color: '#fff',
            border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 500,
            fontFamily: FONT_STACK, cursor: 'pointer',
          }}
        >
          Back to groups
        </button>
      </div>
    )
  }

  // Level one: the hub owns the screen chrome — navy header, group name,
  // holdings and what is owed. The status pill and the members list are
  // still this screen's, so they go in through slots.
  return (
    <MobileSchemeHub
      groupId={group.id}
      onBack={onBack}
      onOpenScheme={setOpenPassbook}
      statusPill={<StatusPill status={group?.status || 'DRAFT'} />}
      footer={membersSection}
    />
  )
}
