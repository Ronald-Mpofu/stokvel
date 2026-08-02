'use client'

// src/app/dashboard/membership/CommunityMembershipPanel.tsx
// Community Membership self-service panel.
//
// Phase 2e.
//
// Self-contained: drop it into any page, or use the wrapper page in
// this folder. It owns its own fetch, state and toast.
//
// ── WHAT THIS SCREEN HAS TO GET RIGHT ────────────────────────
// Cancelling is the moment a member is most likely to misread what
// happens to their money. So the copy leads with what they KEEP:
// access and adverts run to the date they already paid for, and the
// membership simply stops renewing. Nothing is forfeited.
//
// When cancelling is unavailable because Community Membership is their
// only entitlement source (rule 2d), the reason is shown in full rather
// than leaving a disabled button with no explanation.
//
// ── CONVENTIONS ──────────────────────────────────────────────
// Inline styles, teal/navy palette, toast top-right at 4000ms,
// useIsMobile at a 640px breakpoint. Every helper component is defined
// at MODULE level — defining them inside render remounts them on every
// keystroke and loses cursor focus.

import { useState, useEffect, useCallback } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const RED = '#B42318'
const AMBER = '#B54708'
const BORDER = '#E4E7EC'
const MUTED = '#667085'

// ── Types ────────────────────────────────────────────────────

type Membership = {
  userId: string
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED'
  startedAt: string
  expiresAt: string
  optedOutAt: string | null
  autoRenew: boolean
  cancelAtPeriodEnd: boolean
  currency: string
  source: string
  stripeSubscriptionId: string | null
}

type PanelData = {
  membership: Membership | null
  canCancel: boolean
  canResume: boolean
  blockedReason: string | null
  entitlement: {
    isEntitled: boolean
    canSeeAdverts: boolean
    qualifyingGroupCount: number
  } | null
}

type ToastState = { kind: 'success' | 'error'; text: string } | null

// ── Helpers ──────────────────────────────────────────────────

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

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const diff = new Date(iso).getTime() - Date.now()
  return diff <= 0 ? 0 : Math.ceil(diff / 86_400_000)
}

// ── Module-level components ──────────────────────────────────

function ToastBar({ toast }: { toast: ToastState }) {
  if (!toast) return null
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        maxWidth: 380,
        padding: '12px 16px',
        borderRadius: 8,
        color: '#FFFFFF',
        background: toast.kind === 'success' ? '#0B6B4F' : '#8C1D18',
        boxShadow: '0 8px 24px rgba(13, 33, 55, 0.18)',
        fontSize: 14,
        lineHeight: 1.45,
      }}
    >
      <span style={{ marginRight: 8 }}>{toast.kind === 'success' ? '✅' : '❌'}</span>
      {toast.text}
    </div>
  )
}

function StatusBadge({ membership }: { membership: Membership | null }) {
  let label = 'Not enrolled'
  let bg = '#F2F4F7'
  let fg = MUTED

  if (membership) {
    if (membership.status === 'ACTIVE' && membership.cancelAtPeriodEnd) {
      label = 'Ending'
      bg = '#FEF0C7'
      fg = AMBER
    } else if (membership.status === 'ACTIVE') {
      label = 'Active'
      bg = '#D1FADF'
      fg = TEAL
    } else if (membership.status === 'SUSPENDED') {
      label = 'Paused'
      bg = '#FEF0C7'
      fg = AMBER
    } else {
      label = 'Expired'
      bg = '#FEE4E2'
      fg = RED
    }
  }

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 12px',
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.2,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

function DetailRow({
  label,
  value,
  isMobile,
}: {
  label: string
  value: string
  isMobile: boolean
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '180px 1fr',
        gap: isMobile ? 2 : 12,
        padding: '10px 0',
        borderBottom: `1px solid ${BORDER}`,
        fontSize: 14,
      }}
    >
      <div style={{ color: MUTED }}>{label}</div>
      <div style={{ color: NAVY, fontWeight: 500 }}>
        {isMobile ? value : `: ${value}`}
      </div>
    </div>
  )
}

function ActionButton({
  onClick,
  disabled,
  variant,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  variant: 'primary' | 'danger' | 'ghost'
  children: React.ReactNode
}) {
  const palette =
    variant === 'primary'
      ? { bg: TEAL, fg: '#FFFFFF', border: TEAL }
      : variant === 'danger'
      ? { bg: '#FFFFFF', fg: RED, border: '#FDA29B' }
      : { bg: '#FFFFFF', fg: MUTED, border: BORDER }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 16px',
        borderRadius: 8,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.fg,
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  )
}

function NoticeBox({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        padding: '12px 14px',
        borderRadius: 8,
        border: `1px solid ${tone === 'warn' ? '#FEC84B' : BORDER}`,
        background: tone === 'warn' ? '#FFFCF5' : '#F9FAFB',
        color: tone === 'warn' ? AMBER : MUTED,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────

export default function CommunityMembershipPanel() {
  const isMobile = useIsMobile()

  const [data, setData] = useState<PanelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)

  const showToast = useCallback((kind: 'success' | 'error', text: string) => {
    setToast({ kind, text })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // All fetched data lives in React state. Module-level variables are
  // unreliable as caches between App Router navigations.
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/community-membership')
      const json = await res.json()
      if (json.success) {
        setData(json.data)
      } else {
        showToast('error', json.error || 'Could not load your membership')
      }
    } catch {
      showToast('error', 'Could not load your membership')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    load()
  }, [load])

  const act = useCallback(
    async (action: 'cancel' | 'resume') => {
      setBusy(true)
      try {
        const res = await fetch('/api/community-membership', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        const json = await res.json()
        if (json.success) {
          showToast('success', json.message || 'Membership updated')
          setConfirming(false)
          await load()
        } else {
          showToast('error', json.error || 'Could not update your membership')
          setConfirming(false)
        }
      } catch {
        showToast('error', 'Could not update your membership')
        setConfirming(false)
      } finally {
        setBusy(false)
      }
    },
    [load, showToast]
  )

  if (loading) {
    return (
      <div style={{ padding: 24, color: MUTED, fontSize: 14 }}>
        Loading your membership…
      </div>
    )
  }

  const membership = data?.membership ?? null
  const remaining = daysUntil(membership?.expiresAt ?? null)

  return (
    <div style={{ maxWidth: 720, padding: isMobile ? 16 : 0 }}>
      <ToastBar toast={toast} />

      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          overflow: 'hidden',
          background: '#FFFFFF',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'flex-start' : 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '16px 20px',
            background: NAVY,
          }}
        >
          <div>
            <div style={{ color: '#FFFFFF', fontSize: 16, fontWeight: 700 }}>
              Community Membership
            </div>
            <div style={{ color: '#98A2B3', fontSize: 13, marginTop: 2 }}>
              Browse and join groups looking for new members
            </div>
          </div>
          <StatusBadge membership={membership} />
        </div>

        <div style={{ padding: isMobile ? '14px 16px' : '18px 20px' }}>
          {!membership ? (
            <div>
              <div style={{ color: NAVY, fontSize: 14, lineHeight: 1.6 }}>
                You don&apos;t currently hold a Community Membership. It gives you
                visibility of groups advertising for new members, and is charged
                annually.
              </div>
              {data?.entitlement && data.entitlement.qualifyingGroupCount > 0 ? (
                <NoticeBox tone="info">
                  You already have full access through your group membership, so
                  this is optional — it only adds the group adverts.
                </NoticeBox>
              ) : null}
              <div style={{ marginTop: 16 }}>
                <a
                  href="/dashboard/join-fee"
                  style={{
                    display: 'inline-block',
                    padding: '9px 16px',
                    borderRadius: 8,
                    background: TEAL,
                    color: '#FFFFFF',
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Join the community
                </a>
              </div>
            </div>
          ) : (
            <div>
              <DetailRow
                label={membership.cancelAtPeriodEnd ? 'Access until' : 'Renews on'}
                value={formatDate(membership.expiresAt)}
                isMobile={isMobile}
              />
              <DetailRow
                label="Member since"
                value={formatDate(membership.startedAt)}
                isMobile={isMobile}
              />
              <DetailRow
                label="Automatic renewal"
                value={membership.autoRenew ? 'On' : 'Off'}
                isMobile={isMobile}
              />
              <DetailRow
                label="Group adverts"
                value={data?.entitlement?.canSeeAdverts ? 'Visible' : 'Hidden'}
                isMobile={isMobile}
              />

              {membership.cancelAtPeriodEnd ? (
                <NoticeBox tone="warn">
                  This membership will not renew. You keep full access and group
                  adverts until {formatDate(membership.expiresAt)}
                  {remaining !== null ? ` — ${remaining} day${remaining === 1 ? '' : 's'} left` : ''}
                  . You can restart it any time before then.
                </NoticeBox>
              ) : null}

              {data?.blockedReason ? (
                <NoticeBox tone="info">{data.blockedReason}</NoticeBox>
              ) : null}

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  marginTop: 18,
                  alignItems: 'center',
                }}
              >
                {data?.canResume ? (
                  <ActionButton
                    variant="primary"
                    disabled={busy}
                    onClick={() => act('resume')}
                  >
                    {busy ? 'Working…' : 'Keep my membership'}
                  </ActionButton>
                ) : null}

                {data?.canCancel && !confirming ? (
                  <ActionButton variant="danger" onClick={() => setConfirming(true)}>
                    End membership
                  </ActionButton>
                ) : null}

                {confirming ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 14,
                      color: NAVY,
                    }}
                  >
                    <span>
                      Stop renewing? You keep access until{' '}
                      {formatDate(membership.expiresAt)}.
                    </span>
                    <ActionButton
                      variant="danger"
                      disabled={busy}
                      onClick={() => act('cancel')}
                    >
                      {busy ? 'Working…' : 'Yes, stop renewing'}
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirming(false)}
                    >
                      No, keep it
                    </ActionButton>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
