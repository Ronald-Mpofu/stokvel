// src/app/forgot-password/page.tsx — request a password reset link
'use client'
import { useState } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')
  const [devUrl, setDevUrl]   = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setDevUrl('')
    try {
      const res  = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (data.success) {
        setSent(true)
        if (data.devResetUrl) setDevUrl(data.devResetUrl)
      } else {
        setError(data.error || 'Something went wrong. Please try again.')
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
          <div style={{ width:'56px', height:'56px', background:TEAL, borderRadius:'16px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'26px', margin:'0 auto 14px' }}>🔑</div>
          <h1 style={{ fontSize:'22px', fontWeight:'700', color:NAVY, margin:'0 0 6px' }}>Reset your password</h1>
          <p style={{ fontSize:'13px', color:'#64748B', margin:0, lineHeight:1.5 }}>Enter your email and we'll send you a link to set a new password.</p>
        </div>

        {sent ? (
          <div>
            <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:'10px', padding:'14px 16px', color:'#166534', fontSize:'13px', lineHeight:1.5, marginBottom:'16px' }}>
              ✅ If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.
            </div>

            {devUrl && (
              <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:'10px', padding:'12px 14px', marginBottom:'16px' }}>
                <div style={{ fontSize:'11px', fontWeight:'700', color:'#92400E', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.04em' }}>Dev only — reset link</div>
                <a href={devUrl} style={{ fontSize:'12px', color:'#1A5EA8', wordBreak:'break-all' }}>{devUrl}</a>
              </div>
            )}

            <a href="/login" style={{ display:'block', textAlign:'center', fontSize:'13px', color:TEAL, fontWeight:'600', textDecoration:'none' }}>← Back to sign in</a>
          </div>
        ) : (
          <div>
            {error && (
              <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'10px', padding:'12px 16px', marginBottom:'16px', color:'#991B1B', fontSize:'13px' }}>
                ❌ {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom:'20px' }}>
                <label style={{ display:'block', fontSize:'13px', fontWeight:'600', color:'#374151', marginBottom:'6px' }}>Email address</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" required autoComplete="email" autoFocus
                  style={{ width:'100%', padding:'11px 14px', border:'1.5px solid #E2E8F0', borderRadius:'10px', fontSize:'16px', outline:'none', boxSizing:'border-box' as any, transition:'border-color 0.15s' }}
                  onFocus={e => e.target.style.borderColor = TEAL}
                  onBlur={e => e.target.style.borderColor = '#E2E8F0'}
                />
              </div>

              <button type="submit" disabled={loading}
                style={{ width:'100%', padding:'13px', border:'none', borderRadius:'10px', fontSize:'15px', fontWeight:'600', cursor:loading?'not-allowed':'pointer',
                  background: loading ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`,
                  color:'white', transition:'opacity 0.15s' }}>
                {loading ? '⏳ Sending...' : 'Send reset link'}
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
