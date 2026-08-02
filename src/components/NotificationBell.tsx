'use client'

// src/components/NotificationBell.tsx
// In-app notification centre — bell, unread badge, dropdown panel.
//
// Phase 4e.
//
// Drop into the dashboard header:
//   import NotificationBell from '@/components/NotificationBell'
//   <NotificationBell />
//
// ── DATA ─────────────────────────────────────────────────────
// GET  /api/notifications?limit=20      list + unreadCount
// POST /api/notifications MARK_READ     one
// POST /api/notifications MARK_ALL_READ all
//
// The API resolves the caller from the session, so no userId prop is
// needed — and passing one would be ignored anyway.
//
// ── POLLING ──────────────────────────────────────────────────
// Every 60s while the tab is visible. Paused when hidden, so a
// backgrounded tab does not sit there querying all day. Polling rather
// than websockets: the volume does not justify a socket, and a missed
// notification simply appears a minute later.
//
// ── CONVENTIONS ──────────────────────────────────────────────
// Inline styles, teal/navy, useIsMobile at 640px, helper components at
// MODULE level so they are not remounted on every render.

import { useState, useEffect, useCallback, useRef } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const BORDER = '#E4E7EC'
const MUTED = '#667085'
const POLL_MS = 60_000

type Item = {
  id: string
  subject: string | null
  body: string
  isRead: boolean
  readAt: string | null
  groupId: string | null
  templateId: string | null
  createdAt: string
}

function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return isMobile
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

// ── Module-level components ──────────────────────────────────

function Badge({ count }: { count: number }) {
  if (count < 1) return null
  return (
    <span
      style={{
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        borderRadius: 999,
        background: '#D92D20',
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: '18px',
        textAlign: 'center',
        border: '2px solid #FFFFFF',
        boxSizing: 'content-box',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function Row({ item, onRead }: { item: Item; onRead: (id: string) => void }) {
  return (
    <div
      onClick={() => { if (!item.isRead) onRead(item.id) }}
      style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${BORDER}`,
        cursor: item.isRead ? 'default' : 'pointer',
        background: item.isRead ? '#FFFFFF' : '#F0FDF9',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: item.isRead ? 500 : 700,
            color: NAVY,
            lineHeight: 1.4,
          }}
        >
          {item.subject || 'Notification'}
        </div>
        <div style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>
          {timeAgo(item.createdAt)}
        </div>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 12,
          color: MUTED,
          lineHeight: 1.5,
          whiteSpace: 'pre-line',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {item.body}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ padding: '32px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🔔</div>
      Nothing here yet. We&apos;ll let you know when something needs your attention.
    </div>
  )
}

// ── Bell ─────────────────────────────────────────────────────

export default function NotificationBell() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=20')
      const json = await res.json()
      if (json.success) {
        setItems(json.data.notifications || [])
        setUnread(json.data.unreadCount || 0)
      }
    } catch {
      // A failed poll is not worth surfacing — the next one will retry.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll only while the tab is visible.
  useEffect(() => {
    let timer: any = null
    const start = () => {
      if (timer) return
      timer = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVisibility = () => { document.hidden ? stop() : (load(), start()) }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [load])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const markRead = useCallback(async (id: string) => {
    // Optimistic — the row greys out immediately; a failed call is
    // corrected by the next poll.
    setItems(prev => prev.map(i => (i.id === id ? { ...i, isRead: true } : i)))
    setUnread(prev => Math.max(0, prev - 1))
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MARK_READ', notificationId: id }),
      })
    } catch {
      load()
    }
  }, [load])

  const markAllRead = useCallback(async () => {
    setItems(prev => prev.map(i => ({ ...i, isRead: true })))
    setUnread(0)
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MARK_ALL_READ' }),
      })
    } catch {
      load()
    }
  }, [load])

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        style={{
          position: 'relative',
          width: 38,
          height: 38,
          borderRadius: 10,
          border: `1px solid ${BORDER}`,
          background: '#FFFFFF',
          cursor: 'pointer',
          fontSize: 17,
          lineHeight: 1,
        }}
      >
        🔔
        <Badge count={unread} />
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 46,
            right: 0,
            width: isMobile ? 'calc(100vw - 32px)' : 380,
            maxWidth: 380,
            maxHeight: 460,
            display: 'flex',
            flexDirection: 'column',
            background: '#FFFFFF',
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(13, 33, 55, 0.16)',
            zIndex: 900,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: NAVY,
            }}
          >
            <div style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 700 }}>
              Notifications
            </div>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#8FD4BF',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div style={{ padding: '24px 16px', color: MUTED, fontSize: 13, textAlign: 'center' }}>
                Loading…
              </div>
            ) : items.length === 0 ? (
              <EmptyState />
            ) : (
              <div>
                {items.map(item => (
                  <Row key={item.id} item={item} onRead={markRead} />
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              padding: '10px 16px',
              borderTop: `1px solid ${BORDER}`,
              background: '#F9FAFB',
              textAlign: 'center',
            }}
          >
            <a
              href="/dashboard/notifications"
              style={{ fontSize: 12, fontWeight: 600, color: TEAL, textDecoration: 'none' }}
            >
              View all
            </a>
          </div>
        </div>
      ) : null}
    </div>
  )
}
