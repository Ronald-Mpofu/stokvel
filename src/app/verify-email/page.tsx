'use client'

// src/app/verify-email/page.tsx
// Landing page for the link in the verification email.
//
// Phase 6a.
//
// Must be in PUBLIC_ROUTES in middleware.ts — someone opening this from
// their inbox may be on a different device with no session.
//
// ── TONE ─────────────────────────────────────────────────────
// The failure state matters more than the success one. An expired link
// is the common case, not an error the member caused, so the page
// offers a new one rather than reporting a fault. And because
// verification does not block payment, the copy says so — nobody should
// think their account is stuck.

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'

type Status = 'checking' | 'ok' | 'already' | 'failed' | 'missing'

// Module-level, so it is not remounted on every state change.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: '#F8FAFC', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 440, background: 'white', borderRadius: 16, padding: '36px 32px', boxShadow: '0 4px 24px rgba(13,33,55,0.08)', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  )
}

function VerifyInner() {
  const params = useSearchParams()
  const token = params.get('token')

  const [status, setStatus] = useState<Status>(token ? 'checking' : 'missing')
  const [message, setMessage] = useState('')
  const [resending, setResending] = useState(false)
  const [resendNote, setResendNote] = useState('')

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
    setResendNote('')
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend' }),
      })
      const json = await res.json()
      setResendNote(
        json.success
          ? json.message || 'Sent. Check your inbox.'
          : json.error || 'Could not send a new link. Try signing in first.'
      )
    } catch {
      setResendNote('Network error. Please try again.')
    } finally {
      setResending(false)
    }
  }

  if (status === 'checking') {
    return (
      <Shell>
        <div style={{ fontSize: 40, marginBottom: 14 }}>⏳</div>
        <div style={{ fontSize: 15, color: '#64748B' }}>Confirming your email…</div>
      </Shell>
    )
  }

  if (status === 'ok' || status === 'already') {
    return (
      <Shell>
        <div style={{ fontSize: 48, marginBottom: 14 }}>✅</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: NAVY, margin: '0 0 8px' }}>
          {status === 'already' ? 'Already confirmed' : 'Email confirmed'}
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6, margin: '0 0 24px' }}>
          {status === 'already'
            ? 'This address was confirmed earlier — nothing more to do.'
            : 'Thank you. Your email address is confirmed.'}
        </p>
        <a
          href="/dashboard"
          style={{ display: 'inline-block', padding: '12px 24px', borderRadius: 10, background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
        >
          Continue →
        </a>
      </Shell>
    )
  }

  return (
    <Shell>
      <div style={{ fontSize: 44, marginBottom: 14 }}>✉️</div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: NAVY, margin: '0 0 8px' }}>
        {status === 'missing' ? 'Confirm your email' : 'That link has expired'}
      </h1>
      <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6, margin: '0 0 8px' }}>
        {status === 'missing'
          ? 'Open the link in the email we sent you, or request a fresh one below.'
          : message || 'Verification links are valid for 48 hours. Request a new one below.'}
      </p>
      <p style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.6, margin: '0 0 24px' }}>
        This doesn&apos;t hold anything up — you can carry on setting up your account and
        make your payment. Confirming your email is only needed before you start
        contributing.
      </p>

      <button
        type="button"
        onClick={resend}
        disabled={resending}
        style={{ padding: '12px 24px', minHeight: 44, borderRadius: 10, border: 'none', background: resending ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', fontSize: 14, fontWeight: 600, cursor: resending ? 'not-allowed' : 'pointer' }}
      >
        {resending ? 'Sending…' : 'Send me a new link'}
      </button>

      {resendNote ? (
        <p style={{ fontSize: 13, color: TEAL, marginTop: 16, lineHeight: 1.5 }}>{resendNote}</p>
      ) : null}

      <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 24 }}>
        <a href="/dashboard" style={{ color: TEAL, fontWeight: 600, textDecoration: 'none' }}>
          Skip for now
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
