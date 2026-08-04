'use client'

// src/app/verify-email/page.tsx
// Verification landing page, post-registration waiting room, and the
// escape hatch for a mistyped address.
//
// Phase 6a, version 3.
//
// ── WHY THE ESCAPE HATCH ─────────────────────────────────────
// Verification blocks payment, so a member who mistyped their email is
// stuck: the link goes somewhere they cannot read, and "send another"
// only sends it to the same wrong address. Their only remaining option
// would be to abandon the account — and the typo'd address is now taken
// by that dead registration, so they cannot even re-register properly.
//
// "Wrong email address?" is the way out. It is available only while
// unverified, and the new address still has to be confirmed, so it
// cannot be used to claim someone else's email.
//
// ── ENTRY POINTS ─────────────────────────────────────────────
//   ?pending=1   straight after registering
//   ?token=...   the link itself
//   neither      navigated here directly
//
// Must be in PUBLIC_ROUTES — the link may be opened on another device.

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const PAY_URL = '/dashboard/join-fee'
const PORTAL_URL = '/portal'

type Status = 'checking' | 'ok' | 'already' | 'failed' | 'pending' | 'missing'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 460, background: 'white', borderRadius: 16, padding: '36px 32px', boxShadow: '0 4px 24px rgba(13,33,55,0.08)', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  )
}

function ResendBlock({
  resending, note, onResend, label,
}: {
  resending: boolean; note: string; onResend: () => void; label: string
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onResend}
        disabled={resending}
        style={{ padding: '12px 24px', minHeight: 44, borderRadius: 10, border: `1.5px solid ${TEAL}`, background: 'white', color: TEAL, fontSize: 14, fontWeight: 600, cursor: resending ? 'not-allowed' : 'pointer', opacity: resending ? 0.6 : 1 }}
      >
        {resending ? 'Sending…' : label}
      </button>
      {note ? (
        <p style={{ fontSize: 13, color: TEAL, marginTop: 14, lineHeight: 1.5 }}>{note}</p>
      ) : null}
    </div>
  )
}

// Module level — defined inside render it would remount on every
// keystroke and lose cursor focus in the input below.
function ChangeEmailBlock({
  open, value, saving, note, onOpen, onChange, onSubmit, onCancel,
}: {
  open: boolean
  value: string
  saving: boolean
  note: string
  onOpen: () => void
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  if (!open) {
    return (
      <p style={{ fontSize: 13, marginTop: 22 }}>
        <button
          type="button"
          onClick={onOpen}
          style={{ background: 'none', border: 'none', padding: 0, color: '#64748B', fontSize: 13, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
        >
          Wrong email address?
        </button>
      </p>
    )
  }

  return (
    <div style={{ marginTop: 22, padding: '16px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC', textAlign: 'left' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 6 }}>
        Use a different email address
      </div>
      <p style={{ fontSize: 12.5, color: '#64748B', lineHeight: 1.55, margin: '0 0 12px' }}>
        This becomes your sign-in ID. We&apos;ll send a fresh confirmation link to the new
        address.
      </p>
      <input
        type="email"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        autoCapitalize="none"
        style={{ width: '100%', padding: '11px 13px', minHeight: 44, border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 15, outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{ flex: 1, padding: '10px', minHeight: 44, borderRadius: 9, border: 'none', background: '#F1F5F9', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving || !value.trim()}
          style={{ flex: 2, padding: '10px', minHeight: 44, borderRadius: 9, border: 'none', background: saving || !value.trim() ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', fontSize: 13, fontWeight: 600, cursor: saving || !value.trim() ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Updating…' : 'Update and resend'}
        </button>
      </div>
      {note ? (
        <p style={{ fontSize: 12.5, color: NAVY, marginTop: 12, lineHeight: 1.5 }}>{note}</p>
      ) : null}
    </div>
  )
}

function VerifyInner() {
  const params = useSearchParams()
  const token = params.get('token')
  const pending = params.get('pending') === '1'

  const [status, setStatus] = useState<Status>(
    token ? 'checking' : pending ? 'pending' : 'missing'
  )
  const [message, setMessage] = useState('')
  const [resending, setResending] = useState(false)
  const [note, setNote] = useState('')

  // null = not yet known. Drives both the button label and its target.
  const [feeDue, setFeeDue] = useState<boolean | null>(null)
  const nextUrl = feeDue === false ? PORTAL_URL : PAY_URL

  // Resolved only after verification succeeds — before that the answer
  // is irrelevant and the request would be wasted.
  useEffect(() => {
    if (status !== 'ok' && status !== 'already') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me')
        const json = await res.json()
        if (cancelled) return
        const ent = json?.entitlement
        if (ent) {
          // Entitled without a Community Membership means a qualifying
          // group or a staff role — either way, no fee is due.
          const covered =
            ent.isEntitled &&
            (ent.qualifyingGroupIds?.length > 0 || ent.reasons?.includes('STAFF_ROLE'))
          setFeeDue(!covered)
        }
      } catch {
        // Leave null — the button falls back to the payment page, and
        // that page now shows "no fee is due" for exempt members.
      }
    })()
    return () => { cancelled = true }
  }, [status])

  const [changeOpen, setChangeOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [changeNote, setChangeNote] = useState('')

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
        const json = await res.json()
        if (cancelled) return
        if (json.success) {
          setStatus(json.data?.alreadyVerified ? 'already' : 'ok')
        } else {
          setStatus('failed')
          setMessage(json.error || 'That link could not be verified.')
        }
      } catch {
        if (!cancelled) {
          setStatus('failed')
          setMessage('Network error. Please try the link again.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  async function resend() {
    setResending(true)
    setNote('')
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend' }),
      })
      const json = await res.json()
      setNote(
        json.success
          ? json.message || 'Sent. Check your inbox.'
          : json.error || 'Could not send a new link. Try signing in first.'
      )
    } catch {
      setNote('Network error. Please try again.')
    } finally {
      setResending(false)
    }
  }

  async function changeEmail() {
    setSaving(true)
    setChangeNote('')
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change-email', email: newEmail.trim() }),
      })
      const json = await res.json()
      setChangeNote(json.success ? json.message : json.error || 'Could not update the address.')
      if (json.success) {
        setNewEmail('')
        setStatus('pending')
        setNote('')
        setTimeout(() => setChangeOpen(false), 2500)
      }
    } catch {
      setChangeNote('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Verifying ──────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <Shell>
        <div style={{ fontSize: 40, marginBottom: 14 }}>⏳</div>
        <div style={{ fontSize: 15, color: '#64748B' }}>Confirming your email…</div>
      </Shell>
    )
  }

  // ── Verified — where next? ─────────────────────────────────
  // NOT unconditionally to payment. An invited member (rule 3b) owes no
  // joining fee, and sending them to a country picker and payment
  // methods invites a payment nobody asked for. Entitlement decides.
  if (status === 'ok' || status === 'already') {
    return (
      <Shell>
        <div style={{ fontSize: 48, marginBottom: 14 }}>✅</div>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: NAVY, margin: '0 0 8px' }}>
          {status === 'already' ? 'Already confirmed' : 'Email confirmed'}
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6, margin: '0 0 26px' }}>
          {status === 'already'
            ? 'This address was confirmed earlier. You can carry on.'
            : 'Thank you. This is the address you\u2019ll sign in with.'}
        </p>
        <a
          href={nextUrl}
          style={{ display: 'inline-block', padding: '13px 26px', borderRadius: 10, background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', fontSize: 15, fontWeight: 600, textDecoration: 'none' }}
        >
          {feeDue === false ? 'Continue →' : 'Continue to payment →'}
        </a>
      </Shell>
    )
  }

  // ── Waiting room ───────────────────────────────────────────
  if (status === 'pending') {
    return (
      <Shell>
        <div style={{ fontSize: 46, marginBottom: 14 }}>📬</div>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: NAVY, margin: '0 0 10px' }}>
          Check your inbox
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.65, margin: '0 0 12px' }}>
          We&apos;ve sent you a confirmation link. Open it to finish setting up your account.
        </p>
        <div style={{ background: '#F0FDF9', border: '1px solid #A6F4C5', borderRadius: 10, padding: '12px 16px', margin: '0 0 22px', fontSize: 13, color: NAVY, lineHeight: 1.6, textAlign: 'left' }}>
          Your email address is also your sign-in ID, so we confirm it before taking any
          payment — that way a mistyped address can never leave you locked out of an
          account you&apos;ve paid for.
        </div>
        <p style={{ fontSize: 13, color: '#94A3B8', margin: '0 0 20px', lineHeight: 1.55 }}>
          Nothing arrived? Check your spam folder first — then request another link.
        </p>
        <ResendBlock resending={resending} note={note} onResend={resend} label="Send another link" />
        <ChangeEmailBlock
          open={changeOpen}
          value={newEmail}
          saving={saving}
          note={changeNote}
          onOpen={() => setChangeOpen(true)}
          onChange={setNewEmail}
          onSubmit={changeEmail}
          onCancel={() => { setChangeOpen(false); setChangeNote('') }}
        />
      </Shell>
    )
  }

  // ── Expired, invalid, or arrived directly ──────────────────
  return (
    <Shell>
      <div style={{ fontSize: 44, marginBottom: 14 }}>✉️</div>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: NAVY, margin: '0 0 10px' }}>
        {status === 'missing' ? 'Confirm your email' : 'That link has expired'}
      </h1>
      <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.65, margin: '0 0 22px' }}>
        {status === 'missing'
          ? 'Open the link in the email we sent you, or request a fresh one below.'
          : message || 'Confirmation links are valid for 48 hours. Request a new one below.'}
      </p>
      <ResendBlock resending={resending} note={note} onResend={resend} label="Send me a new link" />
      <ChangeEmailBlock
        open={changeOpen}
        value={newEmail}
        saving={saving}
        note={changeNote}
        onOpen={() => setChangeOpen(true)}
        onChange={setNewEmail}
        onSubmit={changeEmail}
        onCancel={() => { setChangeOpen(false); setChangeNote('') }}
      />
      <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 24 }}>
        <a href="/login" style={{ color: TEAL, fontWeight: 600, textDecoration: 'none' }}>
          Back to sign in
        </a>
      </p>
    </Shell>
  )
}

export default function VerifyEmailPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<Shell><div style={{ fontSize: 15, color: '#64748B' }}>Loading…</div></Shell>}>
      <VerifyInner />
    </Suspense>
  )
}
