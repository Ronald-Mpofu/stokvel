'use client';

// src/app/dashboard/join-fee/page.tsx
// Joining fee payment flow: choose country → see fee + methods → pay.
// Auth: session cookie via /api/auth/me (same pattern as login page).
// Performance: exactly TWO parallel requests on load (auth/me + fee config).
//
// Three top-level render states — they are mutually exclusive and must
// stay at the TOP level, not nested inside the form:
//   paid       → membership active, leaving for dashboard/portal
//   confirming → returned from Stripe, polling for the webhook
//   form       → choose country + method
//
// Why that matters: returning from Stripe is a FRESH page load, so
// countryCode is empty and `selected` is null. Anything rendered inside
// the `selected ? ...` branch is invisible on return — which silently
// dropped the member back onto the empty form while polling ran unseen.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const TEAL = '#0F6E56';
const NAVY = '#0D2137';

// Poll for the webhook for 2 minutes before offering a manual retry.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40;

type FeeConfig = {
  countryCode: string;
  countryName: string;
  currency: string;
  amount: number;
  paymentMethods: string[];
};

type Toast = { type: 'success' | 'error'; text: string } | null;

const METHOD_LABELS: Record<string, string> = {
  ECOCASH: '📱 EcoCash',
  MPESA: '📱 M-Pesa',
  MTN_MOMO: '📱 MTN MoMo',
  BANK_TRANSFER: '🏦 Bank transfer',
  CARD: '💳 Card',
  USSD: '☎️ USSD',
};

const MOBILE_MONEY = ['ECOCASH', 'MPESA', 'MTN_MOMO'];
const ADMIN_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'GROUP_ADMIN', 'TREASURER', 'INVESTMENT_MANAGER', 'AUDITOR'];

// Module-level (never inside render — prevents cursor-focus loss)
// ── Payment destination ───────────────────────────────────────
// The bank account or wallet the member actually sends money to.
// Module level, like every other helper here — defined inside render it
// would remount on each keystroke and lose focus in the reference field.
//
// ── LAYOUT ───────────────────────────────────────────────────
// Label ABOVE value, not beside it. A side-by-side row forces long
// account names and 20-digit numbers to wrap or truncate on a phone,
// which is exactly where most members will be standing when they open
// their banking app.
//
// Values are monospaced and letter-spaced. Digits typed wrong send real
// money to a stranger, and 0/O and 1/l are far harder to distinguish in
// a proportional face.
//
// Amount and Reference are visually separated from the account details:
// they are the two fields a member is most likely to skip, and the
// reference is what links their transfer back to their account.
type Destination = {
  id: string;
  method: string;
  displayName: string;
  currency: string;
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  branchName?: string | null;
  branchCode?: string | null;
  swiftCode?: string | null;
  walletNumber?: string | null;
  walletName?: string | null;
  instructions?: string | null;
};

function CopyField(props: { label: string; value: string; mono?: boolean; emphasis?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!props.value) return null;

  return (
    <div
      style={{
        border: `1px solid ${props.emphasis ? '#A6F4C5' : '#e2e8f0'}`,
        background: props.emphasis ? '#F0FDF9' : '#fff',
        borderRadius: 9,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>
          {props.label}
        </div>
        <div
          style={{
            fontSize: props.mono ? 16 : 14,
            fontWeight: props.mono ? 700 : 600,
            color: NAVY,
            lineHeight: 1.35,
            wordBreak: 'break-word',
            fontFamily: props.mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
            letterSpacing: props.mono ? 0.6 : 0,
          }}
        >
          {props.value}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(props.value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        aria-label={`Copy ${props.label}`}
        style={{
          flexShrink: 0,
          width: 44,
          height: 44,
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          background: copied ? '#D1FADF' : '#f8fafc',
          color: copied ? TEAL : '#64748b',
          fontSize: 15,
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </div>
  );
}

function SectionLabel(props: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, margin: '16px 0 8px' }}>
      {props.children}
    </div>
  );
}

function PaymentDetails(props: { destination: Destination; reference: string; amount: string }) {
  const d = props.destination;
  const isBank = d.method === 'BANK_TRANSFER';

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <span style={{ fontSize: 20 }}>{isBank ? '🏦' : '📱'}</span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, lineHeight: 1.3 }}>
            {isBank ? 'Transfer to this account' : 'Send to this number'}
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>{d.displayName}</div>
        </div>
      </div>

      {/* Send exactly this, quoting exactly this. Placed first because
          they are the two fields members most often get wrong. */}
      <SectionLabel>Send</SectionLabel>
      <div style={{ display: 'grid', gap: 8 }}>
        <CopyField label="Amount" value={props.amount} mono emphasis />
        <CopyField label="Payment reference" value={props.reference} mono emphasis />
      </div>

      <div style={{ marginTop: 10, padding: '11px 13px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 9, fontSize: 12.5, color: '#92400e', lineHeight: 1.6 }}>
        Put <strong>{props.reference}</strong> in the reference or narration field. Without
        it we may not be able to match your payment to your account.
      </div>

      <SectionLabel>{isBank ? 'Account details' : 'Wallet details'}</SectionLabel>
      <div style={{ display: 'grid', gap: 8 }}>
        {isBank ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <CopyField label="Account number" value={d.accountNumber || ''} mono emphasis />
            <CopyField label="Account name" value={d.accountName || ''} />
            <CopyField label="Bank" value={d.bankName || ''} />
            <CopyField label="Branch" value={d.branchName || ''} />
            <CopyField label="Branch code" value={d.branchCode || ''} mono />
            <CopyField label="SWIFT / BIC" value={d.swiftCode || ''} mono />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <CopyField label="Send to" value={d.walletNumber || ''} mono emphasis />
            <CopyField label="Registered name" value={d.walletName || ''} />
          </div>
        )}
      </div>

      {d.instructions ? (
        <div style={{ marginTop: 12, padding: '11px 13px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 12.5, color: '#475569', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
          {d.instructions}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  boxSizing: 'border-box',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 24,
};

const primaryBtn: React.CSSProperties = {
  padding: '12px 28px',
  background: TEAL,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
};

export default function JoinFeePage() {
  const router = useRouter();

  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('');
  const [config, setConfig] = useState<FeeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [countryCode, setCountryCode] = useState('');
  const [provider, setProvider] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [instructions, setInstructions] = useState<string | null>(null);
  // Manual rails: where to send the money, and the invoice reference
  // that ties the transfer back to this member.
  const [destination, setDestination] = useState<Destination | null>(null);
  const [attemptId, setAttemptId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [memberRef, setMemberRef] = useState('');
  const [memberPaidAt, setMemberPaidAt] = useState('');
  const [declaring, setDeclaring] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [paid, setPaid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);
  const roleRef = useRef('');

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Success path shared by polling and the manual check.
  const onConfirmed = useCallback(async () => {
    stopPolling();
    // CRITICAL: re-issue the JWT before the member navigates.
    // The webhook flipped joiningFeePaid in the DB, but the token in
    // this browser still says false — without this refresh the
    // middleware gate bounces them straight back here.
    try {
      await fetch('/api/auth/refresh', { method: 'POST' });
    } catch {
      // The Continue button retries the refresh.
    }
    setConfirming(false);
    setPaid(true);
    showToast('success', 'Payment confirmed — welcome to Community Deals!');
    // Send them onward automatically; the button is the fallback.
    setTimeout(() => {
      router.push(ADMIN_ROLES.includes(roleRef.current) ? '/dashboard' : '/portal');
    }, 1500);
  }, [router, showToast, stopPolling]);

  const checkOnce = useCallback(async (uid: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/joining-fee?userId=${uid}`);
      const json = await res.json();
      return json.success && json.data?.status === 'PAID';
    } catch {
      return false;
    }
  }, []);

  // Defined before the mount effect so the Stripe return path can use it.
  const startPolling = useCallback((uid: string) => {
    stopPolling();
    attemptsRef.current = 0;
    setPollTimedOut(false);
    pollRef.current = setInterval(async () => {
      attemptsRef.current += 1;
      if (attemptsRef.current > POLL_MAX_ATTEMPTS) {
        stopPolling();
        setPollTimedOut(true);
        return;
      }
      const ok = await checkOnce(uid);
      if (ok) await onConfirmed();
    }, POLL_INTERVAL_MS);
  }, [checkOnce, onConfirmed, stopPolling]);

  // Exactly two parallel requests on load: session + fee config
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, configRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/joining-fee?type=config'),
        ]);
        const [me, cfg] = await Promise.all([meRes.json(), configRes.json()]);
        if (cancelled) return;

        if (!me.success || !me.data?.id) {
          router.replace('/login?redirect=/dashboard/join-fee');
          return;
        }
        setUserId(me.data.id);
        setRole(me.data.role || '');
        roleRef.current = me.data.role || '';
        if (me.data.joiningFeePaid === true) setPaid(true);
        if (cfg.success) setConfig(cfg.data);
        else showToast('error', 'Could not load joining fee options');

        // ── Returning from Stripe ────────────────────────────
        // Read the query string directly rather than useSearchParams,
        // which would force this page behind a Suspense boundary.
        const params = new URLSearchParams(window.location.search);

        if (params.get('cancelled') === '1') {
          showToast('error', 'Payment cancelled — you can try again');
          window.history.replaceState({}, '', '/dashboard/join-fee');
        }

        if (params.get('paid') === '1' && me.data.joiningFeePaid !== true) {
          // Do NOT trust this redirect as proof of payment — anyone can
          // type ?paid=1. It only says Stripe sent them back; the webhook
          // is the source of truth. Poll until it settles, which also
          // covers the race where the redirect beats the webhook.
          setConfirming(true);
          window.history.replaceState({}, '', '/dashboard/join-fee');
          // Check immediately — the webhook has usually already landed.
          const already = await checkOnce(me.data.id);
          if (cancelled) return;
          if (already) {
            await onConfirmed();
          } else {
            startPolling(me.data.id);
          }
        }
      } catch {
        if (!cancelled) showToast('error', 'Could not load joining fee options');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [router, showToast, startPolling, checkOnce, onConfirmed]);

  const selected = config.find(c => c.countryCode === countryCode) || null;
  const needsPhone = MOBILE_MONEY.includes(provider);
  const isCard = provider === 'CARD';

  const handlePay = useCallback(async () => {
    if (!userId) return showToast('error', 'Session expired — please sign in again');
    if (!countryCode) return showToast('error', 'Choose your country first');
    if (!provider) return showToast('error', 'Choose a payment method');
    if (needsPhone && phone.trim().length < 6) return showToast('error', 'Enter the mobile number to bill');

    setSubmitting(true);
    try {
      const res = await fetch('/api/joining-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, countryCode, provider, phone: needsPhone ? phone.trim() : undefined }),
      });
      const json = await res.json();

      if (!json.success) {
        showToast('error', json.error || 'Payment could not be started');
        setSubmitting(false);
        return;
      }

      // ── Card: leave for Stripe's hosted checkout ───────────
      // Must return BEFORE startPolling: nothing can be polled for
      // while the member is still on this page — the payment happens
      // on Stripe's domain.
      if (json.data?.checkoutUrl) {
        setRedirecting(true);
        window.location.href = json.data.checkoutUrl;
        return;
      }

      // ── Mobile money / bank transfer: stay and poll ────────
      showToast('success', json.message || 'Payment started');
      setInstructions(json.data?.instructions || json.message || null);
      setDestination(json.data?.destination || null);
      setAttemptId(json.data?.attemptId || '');
      setInvoiceNo(json.data?.invoiceNo || '');
      setPayAmount(
        json.data?.currency && json.data?.amount != null
          ? `${json.data.currency} ${Number(json.data.amount).toFixed(2)}`
          : ''
      );
      startPolling(userId);
      setSubmitting(false);
    } catch {
      showToast('error', 'Network error — please try again');
      setSubmitting(false);
    }
  }, [userId, countryCode, provider, phone, needsPhone, showToast, startPolling]);

  // Clean exit once the member has done their part. Without it they
  // reach for the browser Back button, land on a half-finished payment
  // screen, and reasonably assume something went wrong.
  //
  // location.replace rather than push: Back must not return to a
  // logged-out payment page.
  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Cookies are cleared server-side; if the call fails the member
      // still leaves the page and the session expires on its own.
    }
    window.location.replace('/login');
  }, []);

  const handleDeclarePaid = useCallback(async () => {
    if (!attemptId) return;
    if (memberRef.trim().length < 2) {
      return showToast('error', 'Enter the reference shown on your bank or wallet');
    }
    setDeclaring(true);
    try {
      const res = await fetch('/api/joining-fee', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId,
          memberReference: memberRef.trim(),
          memberPaidAt: memberPaidAt || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setDeclared(true);
        showToast('success', json.message || 'Thank you — we\u2019ll check for your payment.');
      } else {
        showToast('error', json.error || 'Could not record your payment');
      }
    } catch {
      showToast('error', 'Network error — please try again');
    } finally {
      setDeclaring(false);
    }
  }, [attemptId, memberRef, memberPaidAt, showToast]);

  const handleManualCheck = useCallback(async () => {
    const ok = await checkOnce(userId);
    if (ok) {
      await onConfirmed();
    } else {
      showToast('error', 'Still not confirmed. Your bank may take a moment.');
      startPolling(userId);
    }
  }, [checkOnce, onConfirmed, showToast, startPolling, userId]);

  const payButtonLabel = () => {
    if (redirecting) return 'Redirecting to secure checkout…';
    if (submitting) return 'Starting payment…';
    if (!selected) return 'Pay';
    return `Pay ${selected.currency} ${selected.amount.toFixed(2)}`;
  };

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, borderRadius: 12, padding: 24, color: '#fff', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>🌀 Join Community Deals</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, opacity: 0.9 }}>
          An annual membership fee, set at an affordable level for your country.
        </p>
      </div>

      {loading ? (
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <span style={{ fontSize: 24 }}>⏳</span>
        </div>
      ) : paid ? (
        <div style={{ background: '#ecfdf5', border: `1px solid ${TEAL}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <h2 style={{ color: TEAL, margin: '8px 0' }}>Membership active</h2>
          <p style={{ color: NAVY, fontSize: 14, margin: '0 0 20px' }}>
            Your joining fee is paid. Taking you through now…
          </p>
          <button
            type="button"
            onClick={async () => {
              // Belt-and-braces: ensure the token carries the paid claim
              // before crossing the middleware gate.
              try {
                await fetch('/api/auth/refresh', { method: 'POST' });
              } catch {
                // Middleware fails open on missing claim; proceed anyway.
              }
              router.push(ADMIN_ROLES.includes(role) ? '/dashboard' : '/portal');
            }}
            style={primaryBtn}
          >
            Continue →
          </button>
        </div>
      ) : confirming ? (
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>{pollTimedOut ? '⏳' : '🔄'}</div>
          <h2 style={{ color: NAVY, margin: '8px 0', fontSize: 18 }}>
            {pollTimedOut ? 'Still confirming' : 'Confirming your payment…'}
          </h2>
          <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 20px', lineHeight: 1.6 }}>
            {pollTimedOut
              ? 'Your payment may still be processing. If your card was charged, your membership will activate shortly — check again below or reload this page in a minute.'
              : 'Your card has been submitted. We are waiting for confirmation — this usually takes a few seconds.'}
          </p>
          <button type="button" onClick={handleManualCheck} style={primaryBtn}>
            Check again
          </button>
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={() => {
                stopPolling();
                setConfirming(false);
                setPollTimedOut(false);
              }}
              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Back to payment options
            </button>
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <Field label="Your country">
            <select
              style={inputStyle}
              value={countryCode}
              onChange={e => {
                setCountryCode(e.target.value);
                setProvider('');
                setInstructions(null);
              }}
            >
              <option value="">Choose a country</option>
              {config.map(c => (
                <option key={c.countryCode} value={c.countryCode}>{c.countryName}</option>
              ))}
            </select>
          </Field>

          {selected ? (
            <div>
              <div style={{ background: '#f0fdf9', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: NAVY }}>Membership fee</span>
                <span style={{ textAlign: 'right' }}>
                  <strong style={{ fontSize: 18, color: TEAL }}>{selected.currency} {selected.amount.toFixed(2)}</strong>
                  <span style={{ fontSize: 12, color: '#64748b', marginLeft: 4 }}>/ year</span>
                </span>
              </div>

              <Field label="Payment method">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {selected.paymentMethods.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setProvider(m)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: provider === m ? `2px solid ${TEAL}` : '1px solid #d1d5db',
                        background: provider === m ? '#f0fdf9' : '#fff',
                        fontSize: 14,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {METHOD_LABELS[m] || m}
                    </button>
                  ))}
                </div>
              </Field>

              {needsPhone ? (
                <Field label="Mobile number to bill">
                  <input
                    style={inputStyle}
                    type="tel"
                    placeholder="+263 7X XXX XXXX"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                  />
                </Field>
              ) : null}

              {isCard ? (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
                  🔒 You will be taken to Stripe to enter your card details securely — we never see or store your card number.
                  Your membership renews automatically each year at {selected.currency} {selected.amount.toFixed(2)}, and you can cancel at any time.
                </div>
              ) : null}

              <button
                type="button"
                onClick={handlePay}
                disabled={submitting || redirecting}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: submitting || redirecting ? '#9ca3af' : TEAL,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: submitting || redirecting ? 'not-allowed' : 'pointer',
                }}
              >
                {payButtonLabel()}
              </button>

              {destination ? (
                <div>
                  <PaymentDetails
                    destination={destination}
                    reference={invoiceNo}
                    amount={payAmount}
                  />

                  {declared ? (
                    <div style={{ marginTop: 16, background: '#F6FEF9', border: '1px solid #A6F4C5', borderRadius: 10, padding: '18px 18px 16px', textAlign: 'center' }}>
                      <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 8 }}>✅</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 6 }}>
                        That&apos;s everything from you
                      </div>
                      <div style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.65, marginBottom: 16 }}>
                        We have your payment details and will confirm your membership once
                        the money reaches us — usually within one to two working days.
                        We&apos;ll email you as soon as it&apos;s done.
                      </div>
                      {/* An explicit way out. Without one the member reaches
                          for Back, lands on a half-finished payment screen,
                          and assumes something failed. */}
                      <button
                        type="button"
                        onClick={handleLogout}
                        style={{ width: '100%', padding: 13, minHeight: 48, borderRadius: 9, border: 'none',
                          background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: '#fff',
                          fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Sign out
                      </button>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 10, lineHeight: 1.55 }}>
                        You can close this page safely — nothing further is needed.
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 14, border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px', background: '#f8fafc' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
                        Already sent the money?
                      </div>
                      {/* Their reference is what an admin matches against
                          the statement. Amount alone is not enough — two
                          members paying the same fee the same day are
                          indistinguishable without it. */}
                      <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.55, marginBottom: 10 }}>
                        Tell us the reference your bank or wallet gave you. It helps us find
                        your payment and activate your membership faster.
                      </div>
                      <input
                        value={memberRef}
                        onChange={(e) => setMemberRef(e.target.value)}
                        placeholder="Your transfer or confirmation reference"
                        style={{ width: '100%', padding: '11px 13px', minHeight: 44, border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 15, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
                      />
                      <input
                        type="date"
                        value={memberPaidAt}
                        onChange={(e) => setMemberPaidAt(e.target.value)}
                        style={{ width: '100%', padding: '11px 13px', minHeight: 44, border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 15, outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
                      />
                      <button
                        type="button"
                        onClick={handleDeclarePaid}
                        disabled={declaring || memberRef.trim().length < 2}
                        style={{ width: '100%', padding: 12, minHeight: 44, borderRadius: 8, border: 'none',
                          background: declaring || memberRef.trim().length < 2 ? '#94a3b8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`,
                          color: '#fff', fontSize: 14, fontWeight: 600,
                          cursor: declaring || memberRef.trim().length < 2 ? 'not-allowed' : 'pointer' }}
                      >
                        {declaring ? 'Sending…' : 'I\u2019ve sent the payment'}
                      </button>
                    </div>
                  )}
                </div>
              ) : instructions ? (
                <div style={{ marginTop: 16, background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: NAVY }}>
                  {instructions}
                  <div style={{ marginTop: 6, color: '#92400e' }}>Waiting for payment confirmation…</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {toast ? (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 9999,
            background: toast.type === 'success' ? '#065f46' : '#7f1d1d',
            color: '#fff',
            padding: '12px 18px',
            borderRadius: 8,
            fontSize: 14,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}
        >
          {toast.type === 'success' ? '✅ ' : '❌ '}{toast.text}
        </div>
      ) : null}
    </div>
  );
}
