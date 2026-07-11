'use client'
// src/components/LogoutButton.tsx
// Reusable logout control for the member portal (and anywhere else).
// Calls POST /api/auth/logout to clear the httpOnly auth cookies server-side,
// then performs a HARD redirect to /login so middleware re-evaluates with the
// cookies gone (a client-side router.push would keep the stale cookie context).

import { useState } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'

interface Props {
  /** 'button' = standalone pill (default) · 'menuItem' = full-width row for a dropdown */
  variant?: 'button' | 'menuItem'
  /** where to send the user after logout (default /login) */
  redirectTo?: string
  /** optional style overrides merged last */
  style?: React.CSSProperties
}

export default function LogoutButton({ variant = 'button', redirectTo = '/login', style }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleLogout() {
    if (loading) return
    setLoading(true)
    try {
      // credentials are same-origin by default, so the auth cookies are sent
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // even if the network call fails, still leave the authenticated area
    } finally {
      // Hard navigation — drops the cleared-cookie context and re-runs middleware
      window.location.href = redirectTo
    }
  }

  if (variant === 'menuItem') {
    return (
      <button onClick={handleLogout} disabled={loading}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
          padding: '11px 14px', background: 'transparent', border: 'none',
          borderRadius: '8px', fontSize: '14px', fontWeight: 500, color: '#B91C1C',
          cursor: loading ? 'wait' : 'pointer', textAlign: 'left',
          opacity: loading ? 0.6 : 1, transition: 'background 0.15s',
          ...style,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#FEF2F2' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
        <span style={{ fontSize: '16px' }}>⎋</span>
        {loading ? 'Logging out…' : 'Log out'}
      </button>
    )
  }

  return (
    <button onClick={handleLogout} disabled={loading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '9px 16px', background: 'white', color: NAVY,
        border: '1.5px solid #E2E8F0', borderRadius: '10px',
        fontSize: '13px', fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.6 : 1, transition: 'all 0.15s',
        ...style,
      }}>
      <span style={{ fontSize: '15px' }}>⎋</span>
      {loading ? 'Logging out…' : 'Log out'}
    </button>
  )
}
