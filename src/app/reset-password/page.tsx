// src/app/reset-password/page.tsx — set a new password from a reset link
'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'

function ResetForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const token        = searchParams.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [done, setDone]         = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!token) { setError('This reset link is missing its token. Please request a new one.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setLoading(true)
    try {
      const res  = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (data.success) {
        setDone(true)
        setTimeout(() => router.push('/login'), 2500)
      } else {
        setError(data.error || 'Could not reset password. Please try again.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'system-ui, sans-serif', background:'#F8FAFC', padding:'24px 20px', boxSizing:'border-box' as any, width:'100%', overflowX:'hidden' }}>
      <div style={{ width:'100%', maxWidth:'380px', background:'white', borderRadius:'16px', border:'1px solid #E2E8F0', padding:'32px 24px', boxSizing:'border-box' as any }}>

        <div style={{ textAlign:'center', marginBottom:'24px' }}>
          <div style={{ width:'56px', height:'56px', background:TEAL, borderRadius:'16px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'26px', margin:'0 auto 14px' }}>🔐</div>
          <h1 style={{ fontSize:'22px', fontWeight:'700', color:NAVY, margin:'0 0 6px' }}>Set a new password</h1>
          <p style={{ fontSize:'13px', color:'#64748B', margin:0, lineHeight:1.5 }}>Choose a strong password you don't use elsewhere.</p>
        </div>

        {done ? (
          <div>
            <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:'10px', padding:'14px 16px', color:'#166534', fontSize:'13px', lineHeight:1.5, marginBottom:'16px' }}>
              ✅ Your password has been reset. Redirecting you to sign in…
            </div>
            <a href="/login" style={{ display:'block', textAlign:'center', fontSize:'13px', color:TEAL, fontWeight:'600', textDecoration:'none' }}>Go to sign in now →</a>
          </div>
        ) : (
          <div>
            {error && (
              <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'10px', padding:'12px 16px', marginBottom:'16px', color:'#991B1B', fontSize:'13px' }}>
                ❌ {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom:'16px' }}>
                <label style={{ display:'block', fontSize:'13px', fontWeight:'600', color:'#374151', marginBottom:'6px' }}>New password</label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required autoComplete="new-password" autoFocus
                  style={{ width:'100%', padding:'11px 14px', border:'1.5px solid #E2E8F0', borderRadius:'10px', fontSize:'16px', outline:'none', boxSizing:'border-box' as any, transition:'border-color 0.15s' }}
                  onFocus={e => e.target.style.borderColor = TEAL}
                  onBlur={e => e.target.style.borderColor = '#E2E8F0'}
                />
              </div>

              <div style={{ marginBottom:'24px' }}>
                <label style={{ display:'block', fontSize:'13px', fontWeight:'600', color:'#374151', marginBottom:'6px' }}>Confirm new password</label>
                <input
                  type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  placeholder="••••••••" required autoComplete="new-password"
                  style={{ width:'100%', padding:'11px 14px', border:'1.5px solid #E2E8F0', borderRadius:'10px', fontSize:'16px', outline:'none', boxSizing:'border-box' as any, transition:'border-color 0.15s' }}
                  onFocus={e => e.target.style.borderColor = TEAL}
                  onBlur={e => e.target.style.borderColor = '#E2E8F0'}
                />
              </div>

              <button type="submit" disabled={loading}
                style={{ width:'100%', padding:'13px', border:'none', borderRadius:'10px', fontSize:'15px', fontWeight:'600', cursor:loading?'not-allowed':'pointer',
                  background: loading ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`,
                  color:'white', transition:'opacity 0.15s' }}>
                {loading ? '⏳ Saving...' : 'Reset password'}
              </button>
            </form>

            <p style={{ textAlign:'center', fontSize:'13px', margin:'20px 0 0' }}>
              <a href="/login" style={{ color:'#64748B', fontWeight:'600', textDecoration:'none' }}>← Back to sign in</a>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// useSearchParams() must be wrapped in a Suspense boundary in Next.js 14
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F8FAFC' }}>
        <div style={{ fontSize:'24px' }}>⏳</div>
      </div>
    }>
      <ResetForm />
    </Suspense>
  )
}
