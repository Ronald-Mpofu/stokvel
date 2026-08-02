'use client'

// src/app/verify-email/page.tsx
// Verification landing page AND the post-registration waiting room.
//
// Phase 6a, version 2 — verification now BLOCKS payment.
//
// ── WHY BLOCKING ─────────────────────────────────────────────
// The email address is the sign-in ID. A typo means the member pays and
// can then never reach their own account: a refund, a support case and
// an orphaned Stripe subscription. Confirming first costs minutes;
// getting it wrong costs all three.
//
// ── THREE ENTRY POINTS ───────────────────────────────────────
//   ?pending=1        straight after registering — "check your inbox"
//   ?token=...        the link itself
//   no parameters     someone navigating here directly
//
// Must be in PUBLIC_ROUTES: the link may be opened on a different
// device with no session.
//
// ── AFTER SUCCESS ────────────────────────────────────────────
// Continues to /dashboard/join-fee, which is the next step in the flow
// rather than a dead end at the dashboard.

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const PAY_URL = '/dashboard/join-fee'

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
  resending,
  note,
  onResend,
  label,
}: {
  resending: boolean
  note: string
  onResend: () => void
  label: string
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

  // ── Verifying ──────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <Shell>
        <div style={{ fontSize: 40, marginBottom: 14 }}>⏳</div>
        <div style={{ fontSize: 15, color: '#64748B' }}>Confirming your email…</div>
      </Shell>
    )
  }

  // ── Verified — continue to payment ─────────────────────────
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
          href={PAY_URL}
          style={{ display: 'inline-block', padding: '13px 26px', borderRadius: 10, background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', fontSize: 15, fontWeight: 600, textDecoration: 'none' }}
        >
          Continue to payment →
        </a>
      </Shell>
    )
  }

  // ── Just registered — waiting room ─────────────────────────
  if (status === 'pending') {
    return (
      <Shell>
        <div style={{ fontSize: 46, marginBottom: 14 }}>📬</div>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: NAVY, margin: '0 0 10px' }}>
          Check your inbox
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.65, margin: '0 0 12px' }}>
          We&apos;ve sent you a confirmation link. Open it to finish setting up your
          account.
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
      </Shell>
    )
  }

  // ── Expired, invalid, or arrived here directly ─────────────
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
      <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 26 }}>
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
