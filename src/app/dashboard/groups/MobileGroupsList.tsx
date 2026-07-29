'use client'
// src/app/dashboard/groups/MobileGroupsList.tsx
//
// Phone layout for the groups list. Rendered by groups/page.tsx when
// useIsMobile() is true and view === 'list'.
//
// DESIGN NOTES
//
// Cards, not a table. The desktop list is a table wrapped in horizontal
// scroll on mobile — the pattern this replaces. Each group is a full-width
// tappable row showing only what someone scanning a list needs: name,
// status, member count, monthly amount.
//
// Native <select> for the status filter. It opens the OS picker, which is
// familiar, accessible, and free — a custom dropdown at 360px is worse in
// every way that matters.
//
// Search input is 16px. Anything smaller triggers iOS Safari auto-zoom on
// focus, which yanks the layout sideways mid-typing.
//
// Filtering is client-side for now, which is fine at current volumes. When
// the list grows, /api/groups already accepts ?search= and ?status= and
// returns a cursor — switch to server-side then rather than shipping the
// whole table to a phone on metered data.

import { useState, useMemo, useCallback } from 'react'
import {
  C, S, T, TOUCH, FONT_STACK, MONEY_STYLE, money,
} from '@/lib/mobile/tokens'

type Props = {
  groups: any[]
  loading: boolean
  currentUserId: string
  onOpenGroup: (group: any) => void
  onCreateGroup: () => void
}

const STATUSES = ['ALL', 'ACTIVE', 'DRAFT', 'PAUSED', 'COMPLETED', 'DISSOLVED']

// ── Pieces ────────────────────────────────────────────────────
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
      padding: '3px 8px', borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

function GroupCard({ group, isOwner, onOpen }: { group: any; isOwner: boolean; onOpen: () => void }) {
  const initials = String(group.name || '?')
    .split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <button
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: S.md, width: '100%',
        padding: `13px ${S.screenX}px`, minHeight: 68,
        background: C.surface, border: 'none',
        borderTop: `1px solid ${C.border}`,
        fontFamily: FONT_STACK, textAlign: 'left', cursor: 'pointer',
      }}
    >
      <div style={{
        width: 42, height: 42, borderRadius: 11, background: C.tealBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, fontWeight: 500, color: C.tealDark, flexShrink: 0,
      }}>
        {initials}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, marginBottom: 3 }}>
          <span style={{
            fontSize: T.body.fontSize, fontWeight: 500, color: C.text, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {group.name}
          </span>
          <StatusPill status={group.status || 'DRAFT'} />
        </div>
        <div style={{
          fontSize: T.caption.fontSize, color: C.textMuted,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {group.memberCount ?? 0} {group.memberCount === 1 ? 'member' : 'members'}
          {' · '}
          <span style={MONEY_STYLE}>{money(group.contributionAmount, group.currency)}</span>
          {' per month'}
          {isOwner ? ' · you own this' : ''}
        </div>
      </div>

      <span style={{ color: C.textFaint, fontSize: 18, flexShrink: 0 }} aria-hidden="true">›</span>
    </button>
  )
}

function EmptyState({ hasFilters, onCreateGroup, onClear }: {
  hasFilters: boolean; onCreateGroup: () => void; onClear: () => void
}) {
  return (
    <div style={{ padding: `${S.xxl}px ${S.screenX}px`, textAlign: 'center', background: C.surface }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16, background: C.tealBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 14px', fontSize: 24, color: C.teal,
      }}>
        ◎
      </div>
      <div style={{ fontSize: T.title.fontSize, fontWeight: 500, color: C.text, marginBottom: 6 }}>
        {hasFilters ? 'No groups match' : 'Create your first group'}
      </div>
      <p style={{
        fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.55,
        margin: '0 auto', maxWidth: 280,
      }}>
        {hasFilters
          ? 'Try a different search or status.'
          : 'A group is where members pool contributions and take turns receiving the payout.'}
      </p>
      <button
        onClick={hasFilters ? onClear : onCreateGroup}
        style={{
          marginTop: S.xl, minHeight: TOUCH.primary, width: '100%',
          background: hasFilters ? C.surface : C.teal,
          color: hasFilters ? C.teal : '#fff',
          border: hasFilters ? `1px solid ${C.teal}` : 'none',
          borderRadius: 12, fontSize: 16, fontWeight: 500,
          fontFamily: FONT_STACK, cursor: 'pointer',
        }}
      >
        {hasFilters ? 'Clear filters' : 'Create group'}
      </button>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function MobileGroupsList({
  groups, loading, currentUserId, onOpenGroup, onCreateGroup,
}: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')

  // Memoised: without this, every keystroke re-lowercases and re-scans
  // the whole array, and so does every unrelated state change.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return groups.filter(g => {
      const matchSearch = !q || String(g.name || '').toLowerCase().includes(q)
      const matchStatus = status === 'ALL' || g.status === status
      return matchSearch && matchStatus
    })
  }, [groups, search, status])

  const clear = useCallback(() => { setSearch(''); setStatus('ALL') }, [])
  const hasFilters = search.trim() !== '' || status !== 'ALL'

  return (
    <div style={{
      fontFamily: FONT_STACK, background: C.surfaceAlt, minHeight: '100vh',
      paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
    }}>

      <div style={{ background: C.navy, padding: `14px ${S.screenX}px 16px` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, marginBottom: 14 }}>
          <span style={{ flex: 1, color: '#fff', fontSize: T.title.fontSize, fontWeight: 500 }}>
            Groups
          </span>
          <button
            onClick={onCreateGroup}
            aria-label="Create group"
            style={{
              width: TOUCH.icon, height: TOUCH.icon, marginRight: -10,
              background: 'transparent', border: 'none',
              color: '#fff', fontSize: 26, cursor: 'pointer', lineHeight: 1,
            }}
          >
            +
          </button>
        </div>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search groups"
          style={{
            width: '100%', minHeight: TOUCH.min, boxSizing: 'border-box',
            padding: `0 ${S.md}px`, borderRadius: 10, border: 'none',
            background: 'rgba(255,255,255,0.12)', color: '#fff',
            fontSize: T.input.fontSize, fontFamily: FONT_STACK, outline: 'none',
          }}
        />
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: S.sm,
        padding: `${S.md}px ${S.screenX}px`, background: C.surface,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <label htmlFor="group-status" style={{ fontSize: T.small.fontSize, color: C.textMuted }}>
          Status
        </label>
        <select
          id="group-status"
          value={status}
          onChange={e => setStatus(e.target.value)}
          style={{
            flex: 1, minHeight: TOUCH.min, padding: `0 ${S.sm}px`,
            border: `1px solid ${C.border}`, borderRadius: 10,
            background: C.surface, color: C.text,
            fontSize: T.input.fontSize, fontFamily: FONT_STACK,
          }}
        >
          {STATUSES.map(s => (
            <option key={s} value={s}>
              {s === 'ALL' ? 'All statuses' : s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <span style={{ fontSize: T.caption.fontSize, color: C.textFaint, minWidth: 28, textAlign: 'right' }}>
          {filtered.length}
        </span>
      </div>

      <div style={{ background: C.surface }}>
        {loading ? (
          <div style={{ padding: `${S.xxl}px ${S.screenX}px`, color: C.textFaint, fontSize: T.small.fontSize, textAlign: 'center' }}>
            Loading groups…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasFilters={hasFilters} onCreateGroup={onCreateGroup} onClear={clear} />
        ) : (
          filtered.map((g: any) => (
            <GroupCard
              key={g.id}
              group={g}
              isOwner={g.adminUserId === currentUserId}
              onOpen={() => onOpenGroup(g)}
            />
          ))
        )}
      </div>

    </div>
  )
}
