'use client';

// src/app/register/page.tsx — public member self-signup
// Visual language mirrors src/app/login/page.tsx (two-panel, NAVY→TEAL branding).
// Performance: ONE request on load (/api/joining-fee?type=config for the country
// dropdown + live fee preview). Registration auto-logs-in via cookies set by the
// API, then routes straight to the joining fee page.

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const TEAL = '#0F6E56';
const NAVY = '#0D2137';

type FeeConfig = {
  countryCode: string;
  countryName: string;
  currency: string;
  amount: number;
};

// Module-level helpers (never inside render — prevents cursor-focus loss)
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  border: '1.5px solid #E2E8F0',
  borderRadius: 10,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

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

const BRAND_FEATURES = [
  { icon: '👥', text: 'Stokvel & savings groups' },
  { icon: '💰', text: 'Community loans & assets' },
  { icon: '🏠', text: 'Property & investment pools' },
  { icon: '🔒', text: 'Secure & transparent' },
];

export default function RegisterPage() {
  const router = useRouter();

  const [config, setConfig] = useState<FeeConfig[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Single request on load — country list + fee preview
  useEffect(() => {
    let cancelled = false;
    fetch('/api/joining-fee?type=config')
      .then(r => r.json())
      .then(d => {
        if (!cancelled && d.success) setConfig(d.data);
      })
      .catch(() => {
        // Country dropdown degrades gracefully; registration still works without it
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedFee = config.find(c => c.countryCode === country) || null;

  const handleRegister = useCallback(async () => {
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          password,
          country: country || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Registration failed');
        setLoading(false);
        return;
      }
      // Cookies are already set by the API — go straight to the fee gate
      router.push('/dashboard/join-fee');
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }, [fullName, email, phone, country, password, confirm, router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'system-ui, sans-serif', background: '#F8FAFC' }}>

      {/* Left panel — branding (mirrors login page) */}
      <div style={{ flex: 1, background: `linear-gradient(135deg, ${NAVY} 0%, #1A3A5C 100%)`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, minHeight: '100vh' }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, background: TEAL, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 24px' }}>🔄</div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'white', margin: '0 0 12px', lineHeight: 1.2 }}>Windfall<br />Community Deals</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.65)', margin: '0 0 40px', lineHeight: 1.6 }}>Your community. Your savings. Your future.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {BRAND_FEATURES.map(f => (
              <div key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 16px' }}>
                <span style={{ fontSize: 20 }}>{f.icon}</span>
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — registration form */}
      <div style={{ width: 480, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, background: 'white', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: NAVY, margin: '0 0 6px' }}>Create your account</h2>
          <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 28px' }}>Join your community in minutes</p>

          {error ? (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: '#991B1B', fontSize: 13 }}>
              ❌ {error}
            </div>
          ) : null}

          <Field label="Full name">
            <input style={inputStyle} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Thandiwe Moyo" autoComplete="name" autoFocus />
          </Field>

          <Field label="Email address">
            <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </Field>

          <Field label="Phone number">
            <input style={inputStyle} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+263 7X XXX XXXX" autoComplete="tel" />
          </Field>

          <Field label="Country">
            <select style={inputStyle} value={country} onChange={e => setCountry(e.target.value)}>
              <option value="">Choose your country</option>
              {config.map(c => (
                <option key={c.countryCode} value={c.countryCode}>{c.countryName}</option>
              ))}
            </select>
          </Field>

          {selectedFee ? (
            <div style={{ background: '#f0fdf9', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: NAVY, display: 'flex', justifyContent: 'space-between' }}>
              <span>Once-off joining fee</span>
              <strong style={{ color: TEAL }}>{selectedFee.currency} {selectedFee.amount.toFixed(2)}</strong>
            </div>
          ) : null}

          <Field label="Password">
            <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
          </Field>

          <Field label="Confirm password">
            <input style={inputStyle} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" />
          </Field>

          <button
            type="button"
            onClick={handleRegister}
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
              letterSpacing: '0.01em',
              marginTop: 4,
            }}
          >
            {loading ? '⏳ Creating account...' : 'Create account →'}
          </button>

          <p style={{ textAlign: 'center', fontSize: 13, color: '#64748B', marginTop: 20 }}>
            Already have an account?{' '}
            <a href="/login" style={{ color: TEAL, fontWeight: 600, textDecoration: 'none' }}>Sign in</a>
          </p>

          <p style={{ textAlign: 'center', fontSize: 12, color: '#94A3B8', marginTop: 24 }}>
            Windfall Community Deals · Secure Platform
          </p>
        </div>
      </div>
    </div>
  );
}
