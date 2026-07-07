// src/app/login/page.tsx — role-aware redirect after login
'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'

const ADMIN_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'GROUP_ADMIN', 'TREASURER', 'INVESTMENT_MANAGER', 'AUDITOR']

function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const redirectTo   = searchParams.get('redirect')

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [checking, setChecking] = useState(true)

  // If already logged in redirect immediately
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.success && d.data && !d.dev) {
        const role = d.data.role
        if (redirectTo && !redirectTo.startsWith('/login')) {
          router.replace(redirectTo)
        } else if (ADMIN_ROLES.includes(role)) {
          router.replace('/dashboard')
        } else {
          router.replace('/portal')
        }
      }
    }).catch(() => {}).finally(() => setChecking(false))
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')

    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = await res.json()

      if (!data.success) {
        setError(data.error || 'Login failed')
        setLoading(false)
        return
      }

      // ── Role-based redirect ───────────────────────────────
      const role = data.data?.user?.role
      if (redirectTo && !redirectTo.startsWith('/login')) {
        router.push(redirectTo)
      } else if (ADMIN_ROLES.includes(role)) {
        router.push('/dashboard')
      } else {
        // MEMBER → portal
        router.push('/portal')
      }

    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F8FAFC' }}>
        <div style={{ fontSize:'24px' }}>⏳</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', fontFamily:'system-ui, sans-serif', background:'#F8FAFC' }}>

      {/* Left panel — branding */}
      <div style={{ flex:1, background:`linear-gradient(135deg, ${NAVY} 0%, #1A3A5C 100%)`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'48px', minHeight:'100vh' }}>
        <div style={{ maxWidth:'400px', textAlign:'center' }}>
          <div style={{ width:'72px', height:'72px', background:TEAL, borderRadius:'20px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'36px', margin:'0 auto 24px' }}>🔄</div>
          <h1 style={{ fontSize:'32px', fontWeight:'800', color:'white', margin:'0 0 12px', lineHeight:1.2 }}>Windfall<br/>Community Deals</h1>
          <p style={{ fontSize:'16px', color:'rgba(255,255,255,0.65)', margin:'0 0 40px', lineHeight:1.6 }}>Your community. Your savings. Your future.</p>
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            {[
              { icon:'👥', text:'Stokvel & savings groups' },
              { icon:'💰', text:'Community loans & assets' },
              { icon:'🏠', text:'Property & investment pools' },
              { icon:'🔒', text:'Secure & transparent' },
            ].map(f => (
              <div key={f.text} style={{ display:'flex', alignItems:'center', gap:'12px', background:'rgba(255,255,255,0.08)', borderRadius:'10px', padding:'12px 16px' }}>
                <span style={{ fontSize:'20px' }}>{f.icon}</span>
                <span style={{ fontSize:'14px', color:'rgba(255,255,255,0.8)', fontWeight:'500' }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div style={{ width:'480px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'48px', background:'white' }}>
        <div style={{ width:'100%', maxWidth:'360px' }}>
          <h2 style={{ fontSize:'26px', fontWeight:'700', color:NAVY, margin:'0 0 6px' }}>Welcome back</h2>
          <p style={{ fontSize:'14px', color:'#64748B', margin:'0 0 32px' }}>Sign in to your account</p>

          {error && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'10px', padding:'12px 16px', marginBottom:'20px', color:'#991B1B', fontSize:'13px', display:'flex', alignItems:'center', gap:'8px' }}>
              ❌ {error}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom:'16px' }}>
              <label style={{ display:'block', fontSize:'13px', fontWeight:'600', color:'#374151', marginBottom:'6px' }}>Email address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoComplete="email" autoFocus
                style={{ width:'100%', padding:'11px 14px', border:'1.5px solid #E2E8F0', borderRadius:'10px', fontSize:'14px', outline:'none', boxSizing:'border-box' as any, transition:'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = TEAL}
                onBlur={e => e.target.style.borderColor = '#E2E8F0'}
              />
            </div>

            <div style={{ marginBottom:'24px' }}>
              <label style={{ display:'block', fontSize:'13px', fontWeight:'600', color:'#374151', marginBottom:'6px' }}>Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required autoComplete="current-password"
                style={{ width:'100%', padding:'11px 14px', border:'1.5px solid #E2E8F0', borderRadius:'10px', fontSize:'14px', outline:'none', boxSizing:'border-box' as any, transition:'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = TEAL}
                onBlur={e => e.target.style.borderColor = '#E2E8F0'}
              />
            </div>

            <button type="submit" disabled={loading}
              style={{ width:'100%', padding:'13px', border:'none', borderRadius:'10px', fontSize:'15px', fontWeight:'600', cursor:loading?'not-allowed':'pointer',
                background: loading ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`,
                color:'white', transition:'opacity 0.15s', letterSpacing:'0.01em' }}>
              {loading ? '⏳ Signing in...' : 'Sign in →'}
            </button>
          </form>

          <p style={{ textAlign:'center', fontSize:'13px', color:'#64748B', margin:'20px 0 0' }}>
            New to Community Deals?{' '}
            <a href="/register" style={{ color:TEAL, fontWeight:'600', textDecoration:'none' }}>Create account</a>
          </p>

          {/* Role guide */}
          <div style={{ marginTop:'32px', padding:'16px', background:'#F8FAFC', borderRadius:'10px', border:'1px solid #E2E8F0' }}>
            <div style={{ fontSize:'11px', fontWeight:'600', color:'#64748B', marginBottom:'10px', textTransform:'uppercase', letterSpacing:'0.05em' }}>After login you will be directed to</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {[
                { role:'System Admin',  icon:'🔑', dest:'Full Dashboard',   color:'#5B21B6' },
                { role:'Group Admin',   icon:'👥', dest:'Group Dashboard',  color:TEAL },
                { role:'Member',        icon:'👤', dest:'Member Portal',    color:'#1E40AF' },
              ].map(r => (
                <div key={r.role} style={{ display:'flex', alignItems:'center', gap:'10px', fontSize:'12px' }}>
                  <span style={{ fontSize:'16px' }}>{r.icon}</span>
                  <span style={{ color:'#374151', fontWeight:'500', minWidth:'100px' }}>{r.role}</span>
                  <span style={{ color:r.color, fontWeight:'600' }}>→ {r.dest}</span>
                </div>
              ))}
            </div>
          </div>

          <p style={{ textAlign:'center', fontSize:'12px', color:'#94A3B8', marginTop:'24px' }}>
            Windfall Community Deals · Secure Platform
          </p>
        </div>
      </div>
    </div>
  )
}

// Next.js 14 requires useSearchParams() to be wrapped in a Suspense boundary
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F8FAFC' }}>
        <div style={{ fontSize:'24px' }}>⏳</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
