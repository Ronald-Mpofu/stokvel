'use client';

// src/app/setup/[token]/page.tsx — staff account activation
// Reached via the one-time link returned by POST /api/users.
// ONE request on load (token validity check), one on submit.
// Requires: '/setup' in middleware PUBLIC_ROUTES.

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

const TEAL = '#0F6E56';
const NAVY = '#0D2137';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  border: '1.5px solid #E2E8F0',
  borderRadius: 10,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

// Module-level (never inside render — prevents cursor-focus loss)
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const params = useParams();
  const token = typeof params?.token === 'string' ? params.token : '';

  const [checking, setChecking] = useState(true);
  const [invalidReason, setInvalidReason] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // Single request on load — validate the token
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setInvalidReason('Invalid setup link');
      setChecking(false);
      return;
    }
    fetch(`/api/auth/setup-password?token=${token}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.success) setFullName(d.data?.fullName || '');
        else setInvalidReason(d.error || 'Invalid setup link');
      })
      .catch(() => {
        if (!cancelled) setInvalidReason('Could not validate this setup link');
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = useCallback(async () => {
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Could not set password');
        setLoading(false);
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }, [token, password, confirm, router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 400, background: 'white', borderRadius: 16, padding: 32, boxShadow: '0 4px 24px rgba(13,33,55,0.08)' }}>
        <div style={{ width: 56, height: 56, background: TEAL, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 20px' }}>🔄</div>

        {checking ? (
          <p style={{ textAlign: 'center', color: '#64748B', fontSize: 14 }}>⏳ Checking your setup link…</p>
        ) : invalidReason ? (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, margin: '0 0 8px' }}>Link problem</h2>
            <p style={{ fontSize: 14, color: '#991B1B', margin: 0 }}>❌ {invalidReason}</p>
          </div>
        ) : done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36 }}>✅</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: TEAL, margin: '8px 0' }}>Account activated</h2>
            <p style={{ fontSize: 14, color: NAVY, margin: 0 }}>Taking you to sign in…</p>
          </div>
        ) : (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, margin: '0 0 4px', textAlign: 'center' }}>
              Welcome{fullName ? `, ${fullName}` : ''}
            </h2>
            <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 24px', textAlign: 'center' }}>
              Set a password to activate your staff account
            </p>

            {error ? (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, color: '#991B1B', fontSize: 13 }}>
                ❌ {error}
              </div>
            ) : null}

            <Field label="New password">
              <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" autoFocus />
            </Field>

            <Field label="Confirm password">
              <input style={inputStyle} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" />
            </Field>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              style={{
                width: '100%',
                padding: 13,
                border: 'none',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                background: loading ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`,
                color: 'white',
              }}
            >
              {loading ? '⏳ Activating…' : 'Activate account →'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
