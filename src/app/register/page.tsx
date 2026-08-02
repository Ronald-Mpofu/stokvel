'use client';

// src/app/register/page.tsx — public member self-signup
// Visual language mirrors src/app/login/page.tsx (two-panel, NAVY→TEAL branding).
// Performance: ONE request on load (/api/joining-fee?type=config for the country
// dropdown + live fee preview). Registration auto-logs-in via cookies set by the
// API, then routes straight to the joining fee page.
//
// RESPONSIVE PASS
//
//   The desktop layout is unchanged. Below 640px it becomes a single column:
//
//   1. The branding panel is hidden and replaced by a compact header. It was
//      flex:1 beside a FIXED width:480 form panel, so the two together
//      demanded 480px minimum — at 360px that is a sideways-scrolling form.
//
//   2. Inputs are 16px on mobile. Below 16px, iOS Safari zooms the page on
//      focus and the member must pinch back out. This screen has seven
//      fields, so that is seven zooms between arriving and having an account.
//
//   3. The account-type cards stack. Side by side at 360px they are ~165px
//      wide holding a title and two lines of 11px description.
//
//   4. Inputs, cards and buttons are at least 44px tall.
//
//   5. The account-type cards became buttons rather than clickable divs, so
//      they are reachable by keyboard and announced to a screen reader.

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const TEAL = '#0F6E56';
const NAVY = '#0D2137';

// 640px matches the breakpoint already used across the mobile screens.
const MOBILE_BREAKPOINT = 640;

type FeeConfig = {
  countryCode: string;
  countryName: string;
  currency: string;
  amount: number;
};

// Module-level helpers (never inside render — prevents cursor-focus loss)
function useIsMobile() {
  // Starts false so the server render and the first client render agree;
  // useEffect corrects it before paint on the client.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

// fontSize is the load-bearing part: 16 on mobile stops iOS Safari zooming
// on focus. minHeight keeps the tap target at 44px.
function inputStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: isMobile ? '13px 14px' : '11px 14px',
    border: '1.5px solid #E2E8F0',
    borderRadius: 10,
    fontSize: isMobile ? 16 : 14,
    minHeight: 44,
    outline: 'none',
    boxSizing: 'border-box',
    background: 'white',
    color: NAVY,
  };
}

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

const ACCOUNT_TYPES: ['MEMBER' | 'GROUP_ADMIN', string, string][] = [
  ['MEMBER', '👤 Join the Members Pool', 'Discover Public groups advertised to you and request to join them'],
  ['GROUP_ADMIN', '👥 Create my own Group', 'Start and administer your own group'],
];

export default function RegisterPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  const [config, setConfig] = useState<FeeConfig[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accountType, setAccountType] = useState<'MEMBER' | 'GROUP_ADMIN'>('MEMBER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Country removed from this form ──────────────────────────
  // Country is captured at the joining-fee step, where it actually
  // matters: it selects the fee and the currency. Asking twice invited
  // a mismatch between the country on the profile and the country the
  // member was billed under.
  //
  // Consequence: the /api/joining-fee?type=config request that powered
  // the dropdown and the live fee preview is gone, so this page now
  // makes ZERO requests on load. The fee is shown at the payment step
  // instead, once the country is known.
  //
  // `config` is retained (empty) so the FeeConfig type and any future
  // preview can be reinstated without reshaping the component.
  void config;
  void setConfig;

  const inp = inputStyle(isMobile);

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
          city: city.trim() || undefined,
          accountType,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Registration failed');
        setLoading(false);
        return;
      }
      // Cookies are already set by the API. Verification comes BEFORE
      // payment: the email address is the sign-in ID, so a typo would
      // leave a paying member unable to reach their own account.
      router.push('/verify-email?pending=1');
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }, [fullName, email, phone, city, password, confirm, accountType, router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'system-ui, sans-serif', background: '#F8FAFC' }}>

      {/* Left panel — branding (mirrors login page). Hidden on mobile: it and
          the fixed-width form panel together demand more than a 360px screen. */}
      {!isMobile ? (
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
      ) : null}

      {/* Right panel — registration form. Full width on mobile, and aligned to
          the top rather than centred: a seven-field form is taller than the
          viewport, and centring pushes the first field off-screen. */}
      <div style={{
        width: isMobile ? '100%' : 480,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: isMobile ? 'flex-start' : 'center',
        padding: isMobile ? '20px 18px 40px' : 48,
        background: 'white',
        overflowY: 'auto',
        boxSizing: 'border-box',
      }}>
        <div style={{ width: '100%', maxWidth: 360 }}>

          {/* Compact brand header — mobile only, standing in for the panel */}
          {isMobile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
              <div style={{ width: 44, height: 44, background: TEAL, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🔄</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: NAVY, lineHeight: 1.2 }}>Windfall</div>
                <div style={{ fontSize: 12, color: '#64748B' }}>Community Deals</div>
              </div>
            </div>
          ) : null}

          <h2 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 700, color: NAVY, margin: '0 0 6px' }}>Create your account</h2>
          <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 28px' }}>Join your community in minutes</p>

          {error ? (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: '#991B1B', fontSize: 13 }}>
              ❌ {error}
            </div>
          ) : null}

          <Field label="Full name">
            <input style={inp} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Thandiwe Moyo" autoComplete="name" autoFocus={!isMobile} />
          </Field>

          <Field label="Email address">
            <input style={inp} type="email" inputMode="email" autoCapitalize="none" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </Field>

          <Field label="Phone number">
            <input style={inp} type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+263 7X XXX XXXX" autoComplete="tel" />
          </Field>

          <Field label="City">
            <input
              style={inp}
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="Harare"
              autoComplete="address-level2"
            />
          </Field>

          <Field label="How do you want to join?">
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
              {ACCOUNT_TYPES.map(([v, title, desc]) => (
                <button key={v} type="button" onClick={() => setAccountType(v)}
                  aria-pressed={accountType === v}
                  style={{
                    padding: '12px 12px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    minHeight: 44,
                    width: '100%',
                    textAlign: 'left',
                    font: 'inherit',
                    border: `2px solid ${accountType === v ? TEAL : '#E2E8F0'}`,
                    background: accountType === v ? '#F0FDF4' : 'white',
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 3 }}>{title}</div>
                  <div style={{ fontSize: 11, color: '#64748B', lineHeight: 1.4 }}>{desc}</div>
                </button>
              ))}
            </div>
          </Field>

          {accountType === 'MEMBER' ? (
            <div style={{ background: '#f0fdf9', border: '1px solid #A6F4C5', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: NAVY, lineHeight: 1.5 }}>
              👤 An <strong>annual membership fee</strong> applies — the amount for your
              country is shown at the payment step. If a group admin invites you instead,
              you pay nothing while you belong to an active group.
            </div>
          ) : null}

          {accountType === 'GROUP_ADMIN' ? (
            <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#3730A3', lineHeight: 1.5 }}>
              👥 A once-off <strong>Group joining fee</strong> applies to group creators — the amount for your country is shown at the payment step. Members you invite into your group pay no joining fee.
            </div>
          ) : null}

          <Field label="Password">
            <input style={inp} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
          </Field>

          <Field label="Confirm password">
            <input style={inp} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" />
          </Field>

          <button
            type="button"
            onClick={handleRegister}
            disabled={loading}
            style={{
              width: '100%',
              padding: 13,
              minHeight: 48,
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
            {loading ? '⏳ Creating account...' : 'Register →'}
          </button>

          <p style={{ textAlign: 'center', fontSize: 13, color: '#64748B', marginTop: 20 }}>
            Already have an account?{' '}
            <a href="/login" style={{ color: TEAL, fontWeight: 600, textDecoration: 'none', display: 'inline-block', minHeight: 44, lineHeight: '44px' }}>Sign in</a>
          </p>

          <p style={{ textAlign: 'center', fontSize: 12, color: '#94A3B8', marginTop: 24 }}>
            Windfall Community Deals · Secure Platform
          </p>
        </div>
      </div>
    </div>
  );
}
