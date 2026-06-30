'use client';

// src/app/dashboard/membership/page.tsx
// Membership Pool — Pool Members (joined via website / open invite)
// Countries, currencies and payment methods sourced from /api/reference

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────
type PoolMemberStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'CLOSED';
type JoiningFeeStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'WAIVED';

interface PoolMember {
  id:               string;
  firstName:        string;
  lastName:         string;
  email:            string;
  phone:            string | null;
  country:          string;
  status:           PoolMemberStatus;
  joiningFeeStatus: JoiningFeeStatus;
  joiningFeePaid:   boolean;
  joiningFeeAmount: number | null;
  joiningFeeExpiry: string | null;
  joiningFeePaidAt: string | null;
  paymentMethod:    string;
  notes:            string | null;
  groupInviteCount: number;
  createdAt:        string;
}

interface RefCountry {
  id:        string;
  name:      string;
  dialCode:  string;
  flagEmoji: string;
  region:    string;
  currencies:     RefCurrency[];
  paymentMethods: RefPayment[];
}
interface RefCurrency { id: string; name: string; symbol: string; isDefault: boolean; }
interface RefPayment  { code: string; name: string; category: string; isDefault: boolean; }
interface Group       { id: string; name: string; }
interface Toast       { id: number; message: string; type: 'success' | 'error'; }
interface Pagination  { page: number; limit: number; total: number; pages: number; }

// ── Constants ──────────────────────────────────────────────────
const TEAL   = '#0F6E56';
const NAVY   = '#0D2137';
const BLUE   = '#1A5EA8';
const PURPLE = '#7C3AED';

const STATUS_BADGE: Record<PoolMemberStatus, { bg: string; color: string; label: string }> = {
  ACTIVE:    { bg: '#D1FAE5', color: '#065F46', label: 'Active'    },
  PENDING:   { bg: '#FEF3C7', color: '#92400E', label: 'Pending'   },
  SUSPENDED: { bg: '#FEE2E2', color: '#991B1B', label: 'Suspended' },
  CLOSED:    { bg: '#F3F4F6', color: '#6B7280', label: 'Closed'    },
};

const FEE_BADGE: Record<JoiningFeeStatus, { bg: string; color: string; label: string }> = {
  PAID:    { bg: '#D1FAE5', color: '#065F46', label: 'Paid'    },
  PENDING: { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  EXPIRED: { bg: '#FEE2E2', color: '#991B1B', label: 'Expired' },
  WAIVED:  { bg: '#EDE9FE', color: '#5B21B6', label: 'Waived'  },
};

const EMPTY_FORM = {
  firstName: '', lastName: '', email: '', phone: '',
  country: '', currency: '', paymentMethod: '',
  joiningFeeAmount: '' as string | number, notes: '',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 6,
  fontSize: 14, outline: 'none', background: '#fff', width: '100%', boxSizing: 'border-box',
};

// ── Module-level helper components ────────────────────────────
function StatusBadge({ status }: { status: PoolMemberStatus }) {
  const b = STATUS_BADGE[status];
  return (
    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: b.bg, color: b.color }}>
      {b.label}
    </span>
  );
}

function FeeBadge({ status }: { status: JoiningFeeStatus }) {
  const b = FEE_BADGE[status];
  return (
    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: b.bg, color: b.color }}>
      {b.label}
    </span>
  );
}

function Avatar({ member }: { member: PoolMember }) {
  const initials = `${member.firstName[0]}${member.lastName[0]}`.toUpperCase();
  const colors   = [TEAL, NAVY, BLUE, PURPLE];
  const color    = colors[(member.firstName.charCodeAt(0) + member.lastName.charCodeAt(0)) % colors.length];
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%', background: color,
      color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{initials}</div>
  );
}

function FormField({ label, children, required, hint }: {
  label: string; children: React.ReactNode; required?: boolean; hint?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
        {label}{required && <span style={{ color: '#EF4444' }}> *</span>}
      </label>
      {children}
      {hint && <span style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{hint}</span>}
    </div>
  );
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '12px 16px', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 500,
          background: t.type === 'success' ? '#065F46' : '#991B1B',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {t.type === 'success' ? '✅' : '❌'} {t.message}
        </div>
      ))}
    </div>
  );
}

function KpiCard({ label, value, color, sub }: { label: string; value: number | string; color: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 18px', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Create Pool Member modal ───────────────────────────────────
function CreateMemberModal({
  countries, onClose, onSuccess,
}: {
  countries: RefCountry[]; onClose: () => void; onSuccess: () => void;
}) {
  const [form,      setForm]      = useState({ ...EMPTY_FORM, country: countries[0]?.id ?? '' });
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  // Derived from selected country
  const selectedCountry  = countries.find(c => c.id === form.country);
  const currencies       = selectedCountry?.currencies     ?? [];
  const paymentMethods   = selectedCountry?.paymentMethods ?? [];
  const selectedCurrency = currencies.find(c => c.id === form.currency);

  // When country changes, auto-select defaults
  const handleCountryChange = (countryId: string) => {
    const c    = countries.find(x => x.id === countryId);
    const defC = c?.currencies.find(x => x.isDefault)      ?? c?.currencies[0];
    const defP = c?.paymentMethods.find(x => x.isDefault)  ?? c?.paymentMethods[0];
    setForm(f => ({
      ...f,
      country:       countryId,
      currency:      defC?.id   ?? '',
      paymentMethod: defP?.code ?? '',
      joiningFeeAmount: '',
    }));
  };

  // Set initial defaults when modal opens
  useEffect(() => {
    if (countries.length && !form.country) {
      handleCountryChange(countries[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countries]);

  const patch = (p: Partial<typeof EMPTY_FORM>) => setForm(f => ({ ...f, ...p }));

  const handleSave = async () => {
    if (!form.firstName.trim())  { setError('First name is required');     return; }
    if (!form.lastName.trim())   { setError('Last name is required');      return; }
    if (!form.email.trim())      { setError('Email is required');          return; }
    if (!form.country)           { setError('Country is required');        return; }
    if (!form.paymentMethod)     { setError('Payment method is required'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        firstName:        form.firstName.trim(),
        lastName:         form.lastName.trim(),
        email:            form.email.trim().toLowerCase(),
        phone:            form.phone.trim()        || undefined,
        country:          form.country,
        currency:         form.currency            || undefined,
        paymentMethod:    form.paymentMethod,
        joiningFeeAmount: form.joiningFeeAmount ? Number(form.joiningFeeAmount) : undefined,
        notes:            form.notes.trim()        || undefined,
      };
      const res  = await fetch('/api/pool-members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      onSuccess();
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to add member');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 28, width: 540,
        maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: NAVY }}>Add Pool Member</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* Name */}
          <FormField label="First Name" required>
            <input value={form.firstName} onChange={e => patch({ firstName: e.target.value })} style={inputStyle} placeholder="First name" />
          </FormField>
          <FormField label="Last Name" required>
            <input value={form.lastName} onChange={e => patch({ lastName: e.target.value })} style={inputStyle} placeholder="Last name" />
          </FormField>

          {/* Email */}
          <FormField label="Email Address" required>
            <input value={form.email} onChange={e => patch({ email: e.target.value })} style={inputStyle} placeholder="email@example.com" type="email" />
          </FormField>

          {/* Phone with dial code prefix */}
          <FormField label="Phone Number">
            <div style={{ display: 'flex', gap: 6 }}>
              {selectedCountry && (
                <span style={{
                  padding: '8px 8px', background: '#F3F4F6', border: '1px solid #D1D5DB',
                  borderRadius: 6, fontSize: 12, fontWeight: 600, color: NAVY,
                  whiteSpace: 'nowrap', display: 'flex', alignItems: 'center',
                }}>
                  {selectedCountry.flagEmoji} {selectedCountry.dialCode}
                </span>
              )}
              <input value={form.phone} onChange={e => patch({ phone: e.target.value })} style={inputStyle} placeholder="XX XXX XXXX" />
            </div>
          </FormField>

          {/* Country — full width */}
          <div style={{ gridColumn: '1 / -1' }}>
            <FormField label="Country" required>
              {countries.length === 0 ? (
                <div style={{ ...inputStyle, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #D1D5DB', borderTopColor: TEAL, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Loading countries…
                </div>
              ) : (
                <select value={form.country} onChange={e => handleCountryChange(e.target.value)} style={inputStyle}>
                  <option value="">— Select country —</option>
                  {countries.map(c => (
                    <option key={c.id} value={c.id}>{c.flagEmoji} {c.name} ({c.dialCode})</option>
                  ))}
                </select>
              )}
            </FormField>
          </div>

          {/* Currency */}
          <FormField label="Currency" required>
            {currencies.length === 0 ? (
              <div style={{ ...inputStyle, color: '#9CA3AF' }}>Select a country first</div>
            ) : (
              <select value={form.currency} onChange={e => patch({ currency: e.target.value })} style={inputStyle}>
                {currencies.map(c => (
                  <option key={c.id} value={c.id}>{c.symbol} — {c.name}{c.isDefault ? ' ✓' : ''}</option>
                ))}
              </select>
            )}
          </FormField>

          {/* Payment Method */}
          <FormField label="Payment Method" required>
            {paymentMethods.length === 0 ? (
              <div style={{ ...inputStyle, color: '#9CA3AF' }}>Select a country first</div>
            ) : (
              <select value={form.paymentMethod} onChange={e => patch({ paymentMethod: e.target.value })} style={inputStyle}>
                {paymentMethods.map(p => (
                  <option key={p.code} value={p.code}>{p.name}{p.isDefault ? ' ✓' : ''}</option>
                ))}
              </select>
            )}
          </FormField>

          {/* Joining Fee — full width */}
          <div style={{ gridColumn: '1 / -1' }}>
            <FormField
              label={selectedCurrency ? `Joining Fee (${selectedCurrency.symbol} — ${selectedCurrency.name})` : 'Joining Fee'}
              hint="Fee valid for 12 months from date of payment. Leave blank to waive."
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {selectedCurrency && (
                  <span style={{
                    padding: '8px 12px', background: '#F3F4F6', border: '1px solid #D1D5DB',
                    borderRadius: 6, fontSize: 14, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap',
                  }}>{selectedCurrency.symbol}</span>
                )}
                <input
                  value={form.joiningFeeAmount}
                  onChange={e => patch({ joiningFeeAmount: e.target.value })}
                  type="number" min="0"
                  placeholder="Leave blank to waive"
                  style={inputStyle}
                />
              </div>
            </FormField>
          </div>

          {/* Notes — full width */}
          <div style={{ gridColumn: '1 / -1' }}>
            <FormField label="Notes">
              <textarea value={form.notes} onChange={e => patch({ notes: e.target.value })}
                rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Optional notes…" />
            </FormField>
          </div>
        </div>

        {error && (
          <div style={{ margin: '12px 0 0', fontSize: 13, color: '#DC2626', background: '#FEF2F2', padding: '8px 12px', borderRadius: 6 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '9px 20px', borderRadius: 6, border: 'none',
            background: saving ? '#9CA3AF' : TEAL, color: '#fff',
            fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
          }}>
            {saving ? 'Saving…' : 'Add to Pool'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invite to Group modal ─────────────────────────────────────
function InviteToGroupModal({
  member, groups, onClose, onSuccess,
}: {
  member: PoolMember; groups: Group[]; onClose: () => void; onSuccess: () => void;
}) {
  const [groupId,  setGroupId]  = useState('');
  const [message,  setMessage]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const handleSend = async () => {
    if (!groupId) { setError('Please select a group'); return; }
    setSaving(true); setError('');
    try {
      const res  = await fetch('/api/pool-member-invites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poolMemberId: member.id, groupId, invitedBy: 'admin', message }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      onSuccess();
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to send invite');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: NAVY }}>Invite to Group</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6B7280' }}>×</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#F9FAFB', borderRadius: 8, marginBottom: 16 }}>
          <Avatar member={member} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: NAVY }}>{member.firstName} {member.lastName}</div>
            <div style={{ fontSize: 12, color: '#6B7280' }}>{member.email}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField label="Select Group" required>
            <select value={groupId} onChange={e => setGroupId(e.target.value)} style={inputStyle}>
              <option value="">— Choose a group —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </FormField>
          <FormField label="Personal Message (optional)">
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
              placeholder="We'd love for you to join our savings group…"
              style={{ ...inputStyle, resize: 'vertical' }} />
          </FormField>
          {error && <div style={{ fontSize: 13, color: '#DC2626', background: '#FEF2F2', padding: '8px 12px', borderRadius: 6 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSend} disabled={saving} style={{
              padding: '8px 18px', borderRadius: 6, border: 'none',
              background: saving ? '#9CA3AF' : TEAL, color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
            }}>{saving ? 'Sending…' : 'Send Invite'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mark Fee Paid modal ───────────────────────────────────────
function MarkFeeModal({
  member, currencySymbol, onClose, onSuccess,
}: {
  member: PoolMember; currencySymbol: string; onClose: () => void; onSuccess: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const handleConfirm = async () => {
    setSaving(true); setError('');
    try {
      const res  = await fetch('/api/pool-members', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: member.id, joiningFeeStatus: 'PAID', status: 'ACTIVE' }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      onSuccess();
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: NAVY }}>Confirm Payment Received</h3>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: '#374151', lineHeight: 1.5 }}>
          Confirm that <strong>{member.firstName} {member.lastName}</strong> has paid the joining fee of{' '}
          <strong>{currencySymbol} {Number(member.joiningFeeAmount).toLocaleString()}</strong>?
          Membership will be activated and the fee valid for <strong>12 months</strong>.
        </p>
        {error && <div style={{ fontSize: 13, color: '#DC2626', background: '#FEF2F2', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleConfirm} disabled={saving} style={{
            padding: '8px 18px', borderRadius: 6, border: 'none',
            background: saving ? '#9CA3AF' : TEAL, color: '#fff',
            fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
          }}>{saving ? 'Saving…' : 'Confirm Payment'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Detail side panel ─────────────────────────────────────────
function MemberDetailPanel({
  member, countries, groups, onClose, onMarkFee, onInvite, onCloseAccount,
}: {
  member: PoolMember; countries: RefCountry[]; groups: Group[];
  onClose: () => void; onMarkFee: (m: PoolMember) => void;
  onInvite: (m: PoolMember) => void; onCloseAccount: (m: PoolMember) => void;
}) {
  const country        = countries.find(c => c.id === member.country);
  const countryLabel   = country ? `${country.flagEmoji} ${country.name}` : member.country;
  const defCurrency    = country?.currencies.find(c => c.isDefault) ?? country?.currencies[0];
  const currencySymbol = defCurrency?.symbol ?? '';
  const paymentLabel   = country?.paymentMethods.find(p => p.code === member.paymentMethod)?.name
                       ?? member.paymentMethod.replace(/_/g, ' ');

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 380,
      background: '#fff', boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
      zIndex: 500, display: 'flex', flexDirection: 'column', overflowY: 'auto',
    }}>
      <div style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${TEAL} 100%)`, padding: '20px 20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>POOL MEMBER</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer', borderRadius: 4, padding: '2px 8px' }}>×</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar member={member} />
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>{member.firstName} {member.lastName}</div>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>{member.email}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <StatusBadge status={member.status} />
        </div>
      </div>

      <div style={{ padding: 20, flex: 1 }}>
        <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Joining Fee
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 14, color: '#374151' }}>Status</span>
            <FeeBadge status={member.joiningFeeStatus} />
          </div>
          {member.joiningFeeAmount != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 14, color: '#374151' }}>Amount</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{currencySymbol} {Number(member.joiningFeeAmount).toLocaleString()}</span>
            </div>
          )}
          {member.joiningFeeExpiry && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 14, color: '#374151' }}>Expires</span>
              <span style={{ fontSize: 14, color: '#374151' }}>{new Date(member.joiningFeeExpiry).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            </div>
          )}
          {member.joiningFeeStatus === 'PENDING' && member.joiningFeeAmount != null && (
            <button onClick={() => onMarkFee(member)} style={{
              marginTop: 8, width: '100%', padding: '8px', borderRadius: 6, border: 'none',
              background: TEAL, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>✓ Mark as Paid</button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {([
            ['Phone',   member.phone || '—'],
            ['Country', countryLabel],
            ['Payment', paymentLabel],
            ['Groups',  `${member.groupInviteCount} group(s) joined`],
            ['Joined',  new Date(member.createdAt).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: '#6B7280' }}>{k}</span>
              <span style={{ fontSize: 13, color: NAVY, fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>{v}</span>
            </div>
          ))}
          {member.notes && (
            <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#065F46', marginBottom: 4 }}>NOTES</div>
              <div style={{ fontSize: 13, color: '#374151' }}>{member.notes}</div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.length > 0 && member.status === 'ACTIVE' && (
            <button onClick={() => onInvite(member)} style={{
              width: '100%', padding: '9px', borderRadius: 6, border: `1px solid ${BLUE}`,
              background: '#EFF6FF', color: BLUE, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>📨 Invite to Group</button>
          )}
          {member.status !== 'CLOSED' && (
            <button onClick={() => onCloseAccount(member)} style={{
              width: '100%', padding: '9px', borderRadius: 6, border: '1px solid #FCA5A5',
              background: '#FEF2F2', color: '#DC2626', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>Close Account</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function MembershipPoolPage() {
  const [members,       setMembers]       = useState<PoolMember[]>([]);
  const [countries,     setCountries]     = useState<RefCountry[]>([]);
  const [groups,        setGroups]        = useState<Group[]>([]);
  const [refLoading,    setRefLoading]    = useState(true);
  const [refError,      setRefError]      = useState('');
  const [pagination,    setPagination]    = useState<Pagination>({ page: 1, limit: 20, total: 0, pages: 1 });
  const [loading,       setLoading]       = useState(true);
  const [search,        setSearch]        = useState('');
  const [filterStatus,  setFilterStatus]  = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [selected,      setSelected]      = useState<PoolMember | null>(null);
  const [showCreate,    setShowCreate]    = useState(false);
  const [markFeeFor,    setMarkFeeFor]    = useState<PoolMember | null>(null);
  const [inviteFor,     setInviteFor]     = useState<PoolMember | null>(null);
  const [toasts,        setToasts]        = useState<Toast[]>([]);
  const [summary,       setSummary]       = useState({ active: 0, pending: 0, feeUnpaid: 0 });
  const toastId = useRef(0);

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  };

  // Load ALL reference data in one call (/api/reference?type=full)
  // This gives us countries + nested currencies + payment methods in a single round trip
  useEffect(() => {
    setRefLoading(true);
    setRefError('');
    fetch('/api/reference?type=full')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(json => {
        if (!json.success) throw new Error(json.error ?? 'Reference data failed');
        setCountries(json.data as RefCountry[]);
      })
      .catch(e => {
        console.error('Reference data error:', e.message);
        setRefError('Could not load countries / currencies. Check that /api/reference/route.ts is deployed.');
      })
      .finally(() => setRefLoading(false));
  }, []);

  const fetchMembers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search)        params.set('search',  search);
      if (filterStatus)  params.set('status',  filterStatus);
      if (filterCountry) params.set('country', filterCountry);
      const res  = await fetch(`/api/pool-members?${params}`);
      const json = await res.json();
      if (json.success) {
        setMembers(json.data.items);
        setPagination(json.data.pagination);
        if (json.data.summary) setSummary(json.data.summary);
      }
    } catch (e: unknown) {
      addToast('Failed to load members', 'error');
      console.error('fetchMembers error:', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus, filterCountry]);

  const fetchGroups = useCallback(async () => {
    try {
      const res  = await fetch('/api/groups');
      const json = await res.json();
      if (json.success) setGroups((json.data ?? []).map((g: Group) => ({ id: g.id, name: g.name })));
    } catch (e: unknown) {
      console.error('fetchGroups error:', (e as Error).message);
    }
  }, []);

  useEffect(() => { fetchMembers(); fetchGroups(); }, [fetchMembers, fetchGroups]);

  useEffect(() => {
    const t = setTimeout(() => fetchMembers(1), 350);
    return () => clearTimeout(t);
  }, [search, fetchMembers]);

  const handleCloseAccount = async (member: PoolMember) => {
    if (!confirm(`Close account for ${member.firstName} ${member.lastName}?`)) return;
    try {
      const res  = await fetch(`/api/pool-members?id=${member.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      addToast('Account closed', 'success');
      setSelected(null);
      fetchMembers(pagination.page);
    } catch (e: unknown) {
      addToast((e as Error).message || 'Failed to close account', 'error');
    }
  };

  // Helpers — resolve labels from the nested countries array
  const getCountry      = (id: string) => countries.find(c => c.id === id);
  const getCurrencySymbol = (member: PoolMember) => {
    const c = getCountry(member.country);
    return (c?.currencies.find(x => x.isDefault) ?? c?.currencies[0])?.symbol ?? '';
  };

  const total     = pagination.total;
  const active    = summary.active;
  const pending   = summary.pending;
  const feeUnpaid = summary.feeUnpaid;

  return (
    <div style={{ minHeight: '100vh', background: '#F3F4F6', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${TEAL} 100%)`, padding: '24px 32px', color: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.65, letterSpacing: '0.1em', marginBottom: 4 }}>WINDFALL COMMUNITY DEALS</div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Membership Pool</h1>
            <p style={{ margin: '4px 0 0', opacity: 0.75, fontSize: 14 }}>Platform members — joined via website or open invitation</p>
          </div>
          <button onClick={() => setShowCreate(true)} disabled={refLoading || !!refError} style={{
            padding: '10px 20px', borderRadius: 8, border: 'none',
            background: refLoading || refError ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)',
            color: '#fff', fontSize: 14, fontWeight: 600,
            cursor: refLoading || refError ? 'not-allowed' : 'pointer',
            backdropFilter: 'blur(4px)',
          }}>
            + Add Pool Member
          </button>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <KpiCard label="Total Members" value={total}     color={NAVY} />
          <KpiCard label="Active"        value={active}    color={TEAL} />
          <KpiCard label="Pending"       value={pending}   color="#D97706" sub="awaiting activation" />
          <KpiCard label="Fee Unpaid"    value={feeUnpaid} color="#7C3AED" sub="joining fee outstanding" />
        </div>
      </div>

      {/* Ref data error banner */}
      {refError && (
        <div style={{ margin: '16px 32px 0', padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 13, color: '#991B1B' }}>
          ⚠️ {refError}
        </div>
      )}

      {/* Filters */}
      <div style={{ padding: '16px 32px 0', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          style={{ ...inputStyle, width: 260, maxWidth: '100%' }}
        />
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); fetchMembers(1); }} style={{ ...inputStyle, width: 150 }}>
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING">Pending</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="CLOSED">Closed</option>
        </select>
        <select value={filterCountry} onChange={e => { setFilterCountry(e.target.value); fetchMembers(1); }} style={{ ...inputStyle, width: 220 }}>
          <option value="">All Countries</option>
          {refLoading
            ? <option disabled>Loading…</option>
            : countries.map(c => <option key={c.id} value={c.id}>{c.flagEmoji} {c.name}</option>)
          }
        </select>
        <span style={{ fontSize: 13, color: '#6B7280', marginLeft: 'auto' }}>
          {pagination.total} member{pagination.total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div style={{ padding: '16px 32px', overflowX: 'auto' }}>
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.2fr 1fr 1.1fr 0.7fr 0.9fr',
            padding: '10px 20px', background: '#F9FAFB',
            borderBottom: '1px solid #E5E7EB', fontSize: 11, fontWeight: 700,
            color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <span>Member</span><span>Email</span><span>Country</span>
            <span>Status</span><span>Joining Fee</span><span>Groups</span><span>Actions</span>
          </div>

          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#9CA3AF' }}>Loading members…</div>
          ) : members.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>👥</div>
              <div style={{ fontWeight: 600, color: NAVY, marginBottom: 4 }}>No pool members yet</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>Add members who joined via the website or open invite</div>
            </div>
          ) : members.map((m, i) => {
            const country = getCountry(m.country);
            const symb    = getCurrencySymbol(m);
            return (
              <div key={m.id} style={{
                display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.2fr 1fr 1.1fr 0.7fr 0.9fr',
                padding: '12px 20px', alignItems: 'center',
                borderBottom: i < members.length - 1 ? '1px solid #F3F4F6' : 'none',
                background: selected?.id === m.id ? '#F0FDF4' : 'transparent',
                cursor: 'pointer', transition: 'background 0.15s',
              }} onClick={() => setSelected(s => s?.id === m.id ? null : m)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar member={m} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: NAVY }}>{m.firstName} {m.lastName}</div>
                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>Added {new Date(m.createdAt).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}</div>
                  </div>
                </div>
                <span style={{ fontSize: 13, color: '#374151' }}>{m.email}</span>
                <span style={{ fontSize: 13, color: '#374151' }}>{country ? `${country.flagEmoji} ${country.name}` : m.country}</span>
                <StatusBadge status={m.status} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <FeeBadge status={m.joiningFeeStatus} />
                  {m.joiningFeeAmount != null && (
                    <span style={{ fontSize: 11, color: '#6B7280' }}>{symb} {Number(m.joiningFeeAmount).toLocaleString()}</span>
                  )}
                </div>
                <span style={{ fontSize: 13, color: '#374151' }}>{m.groupInviteCount}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {m.joiningFeeStatus === 'PENDING' && m.joiningFeeAmount != null && (
                    <button onClick={e => { e.stopPropagation(); setMarkFeeFor(m); }}
                      style={{ padding: '4px 8px', fontSize: 11, borderRadius: 4, border: `1px solid ${TEAL}`, background: '#F0FDF4', color: TEAL, cursor: 'pointer', fontWeight: 600 }}>
                      Pay
                    </button>
                  )}
                  {m.status === 'ACTIVE' && groups.length > 0 && (
                    <button onClick={e => { e.stopPropagation(); setInviteFor(m); }}
                      style={{ padding: '4px 8px', fontSize: 11, borderRadius: 4, border: `1px solid ${BLUE}`, background: '#EFF6FF', color: BLUE, cursor: 'pointer', fontWeight: 600 }}>
                      Invite
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {pagination.pages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            {Array.from({ length: pagination.pages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => fetchMembers(p)} style={{
                width: 36, height: 36, borderRadius: 6, border: '1px solid #D1D5DB',
                background: p === pagination.page ? TEAL : '#fff',
                color: p === pagination.page ? '#fff' : '#374151',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>{p}</button>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <MemberDetailPanel
          member={selected} countries={countries} groups={groups}
          onClose={() => setSelected(null)}
          onMarkFee={m => setMarkFeeFor(m)}
          onInvite={m => setInviteFor(m)}
          onCloseAccount={m => handleCloseAccount(m)}
        />
      )}

      {/* Modals */}
      {showCreate && (
        <CreateMemberModal
          countries={countries}
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); addToast('Pool member added successfully', 'success'); fetchMembers(1); }}
        />
      )}
      {markFeeFor && (
        <MarkFeeModal
          member={markFeeFor}
          currencySymbol={getCurrencySymbol(markFeeFor)}
          onClose={() => setMarkFeeFor(null)}
          onSuccess={() => {
            setMarkFeeFor(null);
            addToast('Joining fee marked as paid — membership activated', 'success');
            if (selected?.id === markFeeFor.id) setSelected(null);
            fetchMembers(pagination.page);
          }}
        />
      )}
      {inviteFor && (
        <InviteToGroupModal
          member={inviteFor} groups={groups}
          onClose={() => setInviteFor(null)}
          onSuccess={() => { setInviteFor(null); addToast(`Invite sent to ${inviteFor.firstName}`, 'success'); }}
        />
      )}
    </div>
  );
}
