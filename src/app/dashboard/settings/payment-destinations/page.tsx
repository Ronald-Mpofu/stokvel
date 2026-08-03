'use client';

// src/app/dashboard/settings/payment-destinations/page.tsx
// Company bank accounts and mobile wallets that members pay into.
// Manages RefPaymentDestination via /api/payment-destinations.
//
// Phase 6b. Sibling of the Charges page; picks up the settings layout
// automatically.
//
// ── WHY THIS SCREEN IS CAREFUL ───────────────────────────────
// These are the digits a member types into their banking app. A wrong
// account number sends real money to a stranger, and a bank transfer is
// not reversible on request. So:
//
//   · the account number is entered TWICE and compared
//   · a live preview shows exactly what the member will see, because
//     most detail errors are caught by reading it back rather than by
//     checking fields one at a time
//   · retiring replaces deleting — a destination referenced by a
//     settled payment is part of the audit trail
//   · every change is audit-logged server-side with old and new values
//
// ── COVERAGE GAPS ────────────────────────────────────────────
// The API reports methods a country offers in its joining-fee config
// with no live destination behind them. That combination is a dead end
// the member only discovers at the moment of paying, so it is surfaced
// at the top of the page rather than left to be found.

import { useCallback, useEffect, useState } from 'react';

const TEAL = '#0F6E56';
const NAVY = '#0D2137';
const RED = '#B42318';
const AMBER = '#B54708';

const METHODS = ['BANK_TRANSFER', 'ECOCASH', 'MPESA', 'MTN_MOMO', 'USSD'] as const;
type Method = (typeof METHODS)[number];

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: '🏦 Bank transfer',
  ECOCASH: '📱 EcoCash',
  MPESA: '📱 M-Pesa',
  MTN_MOMO: '📱 MTN MoMo',
  USSD: '📞 USSD',
};

type Destination = {
  id: string;
  countryCode: string;
  currency: string;
  method: Method;
  displayName: string;
  bankName: string | null;
  accountName: string | null;
  accountNumber: string | null;
  branchName: string | null;
  branchCode: string | null;
  swiftCode: string | null;
  walletNumber: string | null;
  walletName: string | null;
  instructions: string | null;
  isActive: boolean;
  sortOrder: number;
};

type Gap = { countryCode: string; countryName: string; currency: string; method: string };

const EMPTY: Destination = {
  id: '', countryCode: '', currency: '', method: 'BANK_TRANSFER', displayName: '',
  bankName: '', accountName: '', accountNumber: '', branchName: '', branchCode: '', swiftCode: '',
  walletNumber: '', walletName: '', instructions: '', isActive: true, sortOrder: 0,
};

const regionNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

function countryName(code: string): string {
  try { return regionNames?.of(code) || code; } catch { return code; }
}

function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return '🌐';
  const A = 0x1f1e6;
  const base = 'A'.charCodeAt(0);
  return (
    String.fromCodePoint(A + code.toUpperCase().charCodeAt(0) - base) +
    String.fromCodePoint(A + code.toUpperCase().charCodeAt(1) - base)
  );
}

function isBank(m: Method): boolean {
  return m === 'BANK_TRANSFER';
}

// ── Module-level components ──────────────────────────────────

function Field(props: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
        {props.label}
      </label>
      {props.children}
      {props.hint ? (
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>{props.hint}</div>
      ) : null}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  minHeight: 44,
  border: '1.5px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  background: '#fff',
  color: NAVY,
};

/** Renders exactly what the member sees. Reading it back catches the
 *  errors that field-by-field checking misses. */
function MemberPreview(props: { d: Destination }) {
  const d = props.d;
  const rows: [string, string][] = isBank(d.method)
    ? [
        ['Bank', d.bankName || '—'],
        ['Account name', d.accountName || '—'],
        ['Account number', d.accountNumber || '—'],
        ['Branch', d.branchName || '—'],
        ['Branch code', d.branchCode || '—'],
        ['SWIFT', d.swiftCode || '—'],
      ]
    : [
        ['Send to', d.walletNumber || '—'],
        ['Registered name', d.walletName || '—'],
      ];

  return (
    <div style={{ border: '1px solid #A6F4C5', background: '#F6FEF9', borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: TEAL, textTransform: 'uppercase', marginBottom: 10 }}>
        What the member sees
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 10 }}>
        {d.displayName || 'Untitled destination'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 6, fontSize: 13 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <div style={{ color: '#64748b' }}>{k}</div>
            <div style={{ color: NAVY, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{v}</div>
          </div>
        ))}
      </div>
      {d.instructions ? (
        <div style={{ marginTop: 10, fontSize: 12, color: '#475569', lineHeight: 1.55, whiteSpace: 'pre-line' }}>
          {d.instructions}
        </div>
      ) : null}
    </div>
  );
}

function GapWarning(props: { gaps: Gap[] }) {
  if (!props.gaps.length) return null;
  return (
    <div style={{ border: '1px solid #FEC84B', background: '#FFFCF5', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: AMBER, marginBottom: 6 }}>
        ⚠️ {props.gaps.length} payment method{props.gaps.length === 1 ? '' : 's'} with nowhere to pay
      </div>
      <div style={{ fontSize: 12.5, color: '#92400e', lineHeight: 1.6 }}>
        These methods are offered to members at checkout but have no active destination
        configured. A member choosing one is told to pay, and given no account to pay into.
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {props.gaps.map((g, i) => (
          <span key={`${g.countryCode}-${g.method}-${i}`}
            style={{ fontSize: 11, fontWeight: 600, background: '#FEF0C7', color: AMBER, padding: '4px 10px', borderRadius: 999 }}>
            {flagEmoji(g.countryCode)} {g.countryCode} · {METHOD_LABELS[g.method] || g.method}
          </span>
        ))}
      </div>
    </div>
  );
}

function DestinationCard(props: {
  d: Destination;
  onEdit: () => void;
  onRetire: () => void;
  busy: boolean;
}) {
  const { d } = props;
  return (
    <div style={{
      border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, background: '#fff',
      opacity: d.isActive ? 1 : 0.6,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{flagEmoji(d.countryCode)}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{d.displayName}</span>
        <span style={{ fontSize: 11, fontWeight: 600, background: '#F1F5F9', color: '#475569', padding: '3px 9px', borderRadius: 999 }}>
          {METHOD_LABELS[d.method] || d.method}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, background: '#EDE9FE', color: '#5B21B6', padding: '3px 9px', borderRadius: 999 }}>
          {d.currency}
        </span>
        {!d.isActive ? (
          <span style={{ fontSize: 11, fontWeight: 600, background: '#FEE4E2', color: RED, padding: '3px 9px', borderRadius: 999 }}>
            Retired
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6, fontFamily: 'ui-monospace, monospace' }}>
        {isBank(d.method)
          ? `${d.bankName || '—'} · ${d.accountName || '—'} · ${d.accountNumber || '—'}`
          : `${d.walletNumber || '—'} · ${d.walletName || '—'}`}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={props.onEdit}
          style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: NAVY, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          Edit
        </button>
        {d.isActive ? (
          <button type="button" onClick={props.onRetire} disabled={props.busy}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #FDA29B', background: '#fff', color: RED, fontSize: 12, fontWeight: 600, cursor: props.busy ? 'not-allowed' : 'pointer' }}>
            Retire
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function PaymentDestinationsPage() {
  const [items, setItems] = useState<Destination[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [editing, setEditing] = useState<Destination | null>(null);
  const [confirmNumber, setConfirmNumber] = useState('');
  const [retiring, setRetiring] = useState<string>('');

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/payment-destinations');
      const json = await res.json();
      if (json.success) {
        setItems(json.data || []);
        setGaps(json.gaps || []);
      } else {
        showToast('error', json.error || 'Could not load destinations');
      }
    } catch {
      showToast('error', 'Could not load destinations');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  function startNew() {
    setEditing({ ...EMPTY });
    setConfirmNumber('');
  }

  function startEdit(d: Destination) {
    setEditing({ ...d });
    // Pre-filled on edit: the admin is not re-keying an existing number,
    // so demanding it again would be friction without benefit. Changing
    // the number clears the match and forces a fresh confirmation.
    setConfirmNumber(isBank(d.method) ? d.accountNumber || '' : d.walletNumber || '');
  }

  const primaryNumber = editing
    ? (isBank(editing.method) ? editing.accountNumber || '' : editing.walletNumber || '')
    : '';
  const numberMismatch = !!editing && primaryNumber.trim() !== confirmNumber.trim();

  async function save() {
    if (!editing) return;
    if (numberMismatch) {
      return showToast('error', 'The two account numbers do not match');
    }
    setBusy(true);
    try {
      const isNew = !editing.id;
      const res = await fetch(
        isNew ? '/api/payment-destinations' : `/api/payment-destinations?id=${editing.id}`,
        {
          method: isNew ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            countryCode: editing.countryCode.toUpperCase(),
            currency: editing.currency.toUpperCase(),
            method: editing.method,
            displayName: editing.displayName,
            bankName: editing.bankName, accountName: editing.accountName,
            accountNumber: editing.accountNumber, branchName: editing.branchName,
            branchCode: editing.branchCode, swiftCode: editing.swiftCode,
            walletNumber: editing.walletNumber, walletName: editing.walletName,
            instructions: editing.instructions,
            isActive: editing.isActive, sortOrder: Number(editing.sortOrder) || 0,
          }),
        }
      );
      const json = await res.json();
      if (json.success) {
        showToast('success', json.message || 'Saved');
        setEditing(null);
        setConfirmNumber('');
        setLoading(true);
        await load();
      } else {
        showToast('error', json.error || 'Could not save');
      }
    } catch {
      showToast('error', 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function retire(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/payment-destinations?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      showToast(json.success ? 'success' : 'error', json.message || json.error || 'Done');
      if (json.success) { setRetiring(''); setLoading(true); await load(); }
    } catch {
      showToast('error', 'Could not retire destination');
    } finally {
      setBusy(false);
    }
  }

  function set<K extends keyof Destination>(key: K, value: Destination[K]) {
    setEditing(prev => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ color: NAVY, fontSize: 24, margin: 0 }}>Payment Destinations</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 6, lineHeight: 1.6 }}>
          The bank accounts and mobile wallets members pay into. These details are shown
          at checkout and typed into banking apps — check them carefully before saving.
        </p>
      </div>

      <GapWarning gaps={gaps} />

      {!editing ? (
        <button type="button" onClick={startNew}
          style={{ padding: '11px 20px', minHeight: 44, borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 20 }}>
          + Add destination
        </button>
      ) : null}

      {editing ? (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, background: '#fff', marginBottom: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>
            {editing.id ? 'Edit destination' : 'New destination'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <Field label="Country code" hint="Two letters, e.g. ZW. Must match the joining-fee country.">
              <input style={inputStyle} value={editing.countryCode} maxLength={2}
                onChange={e => set('countryCode', e.target.value.toUpperCase())} placeholder="ZW" />
            </Field>
            <Field label="Currency" hint="Three letters, e.g. USD.">
              <input style={inputStyle} value={editing.currency} maxLength={3}
                onChange={e => set('currency', e.target.value.toUpperCase())} placeholder="USD" />
            </Field>
            <Field label="Method">
              <select style={inputStyle} value={editing.method}
                onChange={e => set('method', e.target.value as Method)}>
                {METHODS.map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Display name" hint="What the member sees, e.g. “CBZ Bank — USD”.">
            <input style={inputStyle} value={editing.displayName}
              onChange={e => set('displayName', e.target.value)} placeholder="CBZ Bank — USD" />
          </Field>

          {isBank(editing.method) ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                <Field label="Bank name">
                  <input style={inputStyle} value={editing.bankName || ''}
                    onChange={e => set('bankName', e.target.value)} placeholder="CBZ Bank Limited" />
                </Field>
                <Field label="Account name">
                  <input style={inputStyle} value={editing.accountName || ''}
                    onChange={e => set('accountName', e.target.value)} placeholder="Windfall Community Deals" />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                <Field label="Account number">
                  <input style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }}
                    value={editing.accountNumber || ''}
                    onChange={e => set('accountNumber', e.target.value)} placeholder="0123456789" />
                </Field>
                <Field label="Confirm account number"
                  hint={numberMismatch ? '⚠️ The two numbers do not match' : 'Retype it — this is where the money goes.'}>
                  <input
                    style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace',
                      borderColor: numberMismatch ? '#FDA29B' : '#e2e8f0' }}
                    value={confirmNumber}
                    onChange={e => setConfirmNumber(e.target.value)} placeholder="0123456789" />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                <Field label="Branch name"><input style={inputStyle} value={editing.branchName || ''} onChange={e => set('branchName', e.target.value)} /></Field>
                <Field label="Branch code"><input style={inputStyle} value={editing.branchCode || ''} onChange={e => set('branchCode', e.target.value)} /></Field>
                <Field label="SWIFT code"><input style={inputStyle} value={editing.swiftCode || ''} onChange={e => set('swiftCode', e.target.value)} /></Field>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <Field label="Wallet number">
                <input style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }}
                  value={editing.walletNumber || ''}
                  onChange={e => set('walletNumber', e.target.value)} placeholder="0771234567" />
              </Field>
              <Field label="Confirm wallet number"
                hint={numberMismatch ? '⚠️ The two numbers do not match' : 'Retype it — this is where the money goes.'}>
                <input
                  style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace',
                    borderColor: numberMismatch ? '#FDA29B' : '#e2e8f0' }}
                  value={confirmNumber}
                  onChange={e => setConfirmNumber(e.target.value)} placeholder="0771234567" />
              </Field>
              <Field label="Registered name">
                <input style={inputStyle} value={editing.walletName || ''}
                  onChange={e => set('walletName', e.target.value)} placeholder="Windfall Community Deals" />
              </Field>
            </div>
          )}

          <Field label="Instructions" hint="Shown beneath the details. Cut-off times, narration rules, fee warnings.">
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} rows={3}
              value={editing.instructions || ''}
              onChange={e => set('instructions', e.target.value)}
              placeholder="Use your invoice reference as the payment narration. Allow 1–2 working days." />
          </Field>

          <div style={{ marginBottom: 16 }}>
            <MemberPreview d={editing} />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => { setEditing(null); setConfirmNumber(''); }}
              style={{ flex: 1, padding: 12, minHeight: 44, borderRadius: 9, border: 'none', background: '#F1F5F9', color: '#475569', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={busy || numberMismatch}
              style={{ flex: 2, padding: 12, minHeight: 44, borderRadius: 9, border: 'none',
                background: busy || numberMismatch ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`,
                color: '#fff', fontSize: 14, fontWeight: 600, cursor: busy || numberMismatch ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Saving…' : editing.id ? 'Save changes' : 'Add destination'}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div style={{ fontSize: 14, color: '#64748b' }}>Loading…</div>
      ) : !items.length ? (
        <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 32, textAlign: 'center', color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
          No payment destinations yet.<br />
          Until one exists, members choosing bank transfer or mobile money are told to pay
          but given no account to pay into.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map(d => (
            <div key={d.id}>
              <DestinationCard
                d={d}
                busy={busy}
                onEdit={() => startEdit(d)}
                onRetire={() => setRetiring(d.id)}
              />
              {retiring === d.id ? (
                <div style={{ marginTop: 8, padding: '12px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 9, fontSize: 13, color: '#92400e', lineHeight: 1.55 }}>
                  Retire <strong>{d.displayName}</strong>? Members will no longer be offered it.
                  Past payments keep referencing it, so nothing is lost.
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button type="button" onClick={() => setRetiring('')}
                      style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: '#F1F5F9', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Keep it
                    </button>
                    <button type="button" onClick={() => retire(d.id)} disabled={busy}
                      style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: RED, color: '#fff', fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
                      {busy ? 'Working…' : 'Yes, retire'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {toast ? (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, background: toast.type === 'success' ? '#065f46' : '#7f1d1d', color: '#fff', padding: '12px 18px', borderRadius: 8, fontSize: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
          {toast.type === 'success' ? '✅ ' : '❌ '}{toast.text}
        </div>
      ) : null}
    </div>
  );
}
