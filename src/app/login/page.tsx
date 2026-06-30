'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (data.success) {
        router.push('/dashboard')
      } else {
        setError(data.error || 'Login failed')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0D2137 0%, #0F6E56 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '48px 40px',
        width: '100%',
        maxWidth: '420px',
        boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '64px', height: '64px',
            background: 'linear-gradient(135deg, #0F6E56, #1D9E75)',
            borderRadius: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: '28px',
          }}>🔄</div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0D2137', margin: '0 0 4px' }}>
            Windfall Community Centre
          </h1>
          <p style={{ color: '#64748B', fontSize: '14px', margin: 0 }}>
            Community Wealth Building
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={{
                width: '100%', padding: '10px 14px',
                border: '1.5px solid #E2E8F0', borderRadius: '8px',
                fontSize: '14px', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%', padding: '10px 14px',
                border: '1.5px solid #E2E8F0', borderRadius: '8px',
                fontSize: '14px', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: '8px', padding: '10px 14px',
              color: '#991B1B', fontSize: '13px', marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px',
              background: loading ? '#94A3B8' : 'linear-gradient(135deg, #0F6E56, #1D9E75)',
              color: 'white', border: 'none', borderRadius: '8px',
              fontSize: '15px', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {/* Demo credentials */}
        <div style={{
          marginTop: '24px', padding: '16px',
          background: '#F0FDF4', borderRadius: '8px',
          border: '1px solid #BBF7D0',
        }}>
          <p style={{ fontSize: '12px', fontWeight: '600', color: '#166534', margin: '0 0 8px' }}>
            Demo credentials:
          </p>
          {[
            ['Admin', 'admin@stokvel.com', 'Admin@12345'],
            ['Group Admin', 'groupadmin@stokvel.com', 'Admin@12345'],
            ['Member', 'tariro@example.com', 'Member@12345'],
          ].map(([role, em, pw]) => (
            <div
              key={role}
              onClick={() => { setEmail(em); setPassword(pw) }}
              style={{
                fontSize: '12px', color: '#166534', cursor: 'pointer',
                padding: '3px 0', borderBottom: '1px solid #BBF7D0',
              }}
            >
              <strong>{role}:</strong> {em}
              <span style={{ color: '#059669', marginLeft: '6px' }}>(click to fill)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
