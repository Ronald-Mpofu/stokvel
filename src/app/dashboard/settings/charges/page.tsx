'use client';

// src/app/dashboard/settings/charges/page.tsx
// SYSTEM ADMIN — Group Monthly Subscription Charges per country.
// Manages RefChargeSheet + RefChargeTier via /api/charge-sheets.
//
// NOTE: Member ANNUAL joining fees are configured in RefJoiningFee
// (existing joining-fee flow) — deliberately not editable here.
//
// Tier editing model: admin edits each tier's MAX and FEE only.
// Mins are derived (prev max + 1) and the last tier is locked
// open-ended, so gaps/overlaps are impossible by construction.

import { useCallback, useEffect, useState } from 'react';

// ── Palette ───────────────────────────────────────────────────
const TEAL = '#0F6E56';
const NAVY = '#0D2137';

// ── Types ─────────────────────────────────────────────────────
interface TierDraft {
  maxMembers: string;  // '' = open-ended (last tier only)
  monthlyFee: string;
}

interface SheetDraft {
  currency: string;
  isActive: boolean;
  tiers: TierDraft[];
}

interface Sheet {
  id: string;
  countryCode: string;
  currency: string;
  isActive: boolean;
  tiers: Array<{ minMembers: number; maxMembers: number | null; monthlyFee: number }>;
}

interface CountryOption {
  countryCode: string;
  countryName: string;
  currency: string;
}

interface ToastState {
  kind: 'success' | 'error';
  text: string;
}

// ── Derived mins: [ '' , max1+1, max2+1, ... ] ────────────────
function derivedMins(tiers: TierDraft[]): number[] {
  const mins: number[] = [];
  let next = 1;
  for (const t of tiers) {
    mins.push(next);
    const max = parseInt(t.maxMembers, 10);
    next = Number.isFinite(max) ? max + 1 : next + 1;
  }
  return mins;
}

function sheetToDraft(s: Sheet): SheetDraft {
  return {
    currency: s.currency,
    isActive: s.isActive,
    tiers: s.tiers.map((t) => ({
      maxMembers: t.maxMembers === null ? '' : String(t.maxMembers),
      monthlyFee: String(t.monthlyFee),
    })),
  };
}

// ── Shared styles ─────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 14,
  width: '100%',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  background: TEAL,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '9px 18px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: NAVY,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  background: 'transparent',
  color: '#b91c1c',
  border: '1px solid #fca5a5',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
};

// ── Module-level components (never inside render — cursor focus) ──
function Field(props: { label: string; children: React.ReactNode; width?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: props.width }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>{props.label}</label>
      {props.children}
    </div>
  );
}

function TierRow(props: {
  index: number;
  min: number;
  tier: TierDraft;
  isLast: boolean;
  canRemove: boolean;
  currency: string;
  onMaxChange: (v: string) => void;
  onFeeChange: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 110px 140px 90px',
        gap: 10,
        alignItems: 'center',
        padding: '8px 0',
        borderBottom: '1px solid #f1f5f9',
      }}
    >
      <div style={{ fontSize: 14, color: NAVY, fontWeight: 600 }}>{props.min}</div>
      <div>
        {props.isLast ? (
          <div style={{ fontSize: 14, color: '#64748b', padding: '8px 0' }}>∞ (no limit)</div>
        ) : (
          <input
            type="number"
            min={props.min}
            value={props.tier.maxMembers}
            onChange={(e) => props.onMaxChange(e.target.value)}
            style={inputStyle}
            placeholder="max"
          />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, color: '#64748b' }}>{props.currency}</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={props.tier.monthlyFee}
          onChange={(e) => props.onFeeChange(e.target.value)}
          style={inputStyle}
          placeholder="0.00"
        />
      </div>
      <div>
        {props.canRemove ? (
          <button type="button" onClick={props.onRemove} style={{ ...btnDanger, padding: '6px 10px' }}>
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function ChargesSettingsPage() {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [availableCountries, setAvailableCountries] = useState<CountryOption[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SheetDraft>>({});
  const [openAccordion, setOpenAccordion] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addCountry, setAddCountry] = useState('');
  const [addCurrency, setAddCurrency] = useState('');
  const [addTiers, setAddTiers] = useState<TierDraft[]>([
    { maxMembers: '10', monthlyFee: '' },
    { maxMembers: '20', monthlyFee: '' },
    { maxMembers: '', monthlyFee: '' },
  ]);
  const [addSaving, setAddSaving] = useState(false);

  const showToast = useCallback((kind: 'success' | 'error', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/charge-sheets');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Load failed');
      const loaded: Sheet[] = json.data.sheets;
      setSheets(loaded);
      setAvailableCountries(json.data.availableCountries);
      const d: Record<string, SheetDraft> = {};
      for (const s of loaded) d[s.id] = sheetToDraft(s);
      setDrafts(d);
    } catch (e: any) {
      showToast('error', e?.message || 'Failed to load charge sheets');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const toggleAccordion = (id: string) => {
    setOpenAccordion((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const updateDraft = (sheetId: string, fn: (d: SheetDraft) => SheetDraft) => {
    setDrafts((prev) => ({ ...prev, [sheetId]: fn(prev[sheetId]) }));
  };

  const draftToPayloadTiers = (tiers: TierDraft[]) => {
    const mins = derivedMins(tiers);
    return tiers.map((t, i) => ({
      minMembers: mins[i],
      maxMembers: i === tiers.length - 1 ? null : parseInt(t.maxMembers, 10),
      monthlyFee: parseFloat(t.monthlyFee),
    }));
  };

  const validateTiers = (tiers: TierDraft[]): string | null => {
    const mins = derivedMins(tiers);
    for (let i = 0; i < tiers.length; i++) {
      const isLast = i === tiers.length - 1;
      if (!isLast) {
        const max = parseInt(tiers[i].maxMembers, 10);
        if (!Number.isFinite(max)) return `Tier ${i + 1}: max members is required`;
        if (max < mins[i]) return `Tier ${i + 1}: max (${max}) is below min (${mins[i]})`;
      }
      const fee = parseFloat(tiers[i].monthlyFee);
      if (!Number.isFinite(fee) || fee < 0) return `Tier ${i + 1}: enter a valid fee`;
    }
    return null;
  };

  const saveSheet = async (sheet: Sheet) => {
    const draft = drafts[sheet.id];
    if (!draft) return;
    const problem = validateTiers(draft.tiers);
    if (problem) {
      showToast('error', problem);
      return;
    }
    setSavingId(sheet.id);
    try {
      const res = await fetch(`/api/charge-sheets?id=${sheet.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: draft.currency,
          isActive: draft.isActive,
          tiers: draftToPayloadTiers(draft.tiers),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Save failed');
      showToast('success', `${sheet.countryCode} charges saved`);
      await fetchAll();
    } catch (e: any) {
      showToast('error', e?.message || 'Failed to save');
    } finally {
      setSavingId(null);
    }
  };

  const deleteSheet = async (sheet: Sheet) => {
    if (!window.confirm(`Delete the charge sheet for ${sheet.countryCode}? Groups there will fall back to DEFAULT pricing.`)) {
      return;
    }
    setSavingId(sheet.id);
    try {
      const res = await fetch(`/api/charge-sheets?id=${sheet.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Delete failed');
      showToast('success', json.message);
      await fetchAll();
    } catch (e: any) {
      showToast('error', e?.message || 'Failed to delete');
    } finally {
      setSavingId(null);
    }
  };

  const openAdd = () => {
    const first = availableCountries[0];
    setAddCountry(first ? first.countryCode : '');
    setAddCurrency(first ? first.currency : 'USD');
    setAddTiers([
      { maxMembers: '10', monthlyFee: '' },
      { maxMembers: '20', monthlyFee: '' },
      { maxMembers: '', monthlyFee: '' },
    ]);
    setShowAddModal(true);
  };

  const submitAdd = async () => {
    if (!addCountry) {
      showToast('error', 'Select a country');
      return;
    }
    const problem = validateTiers(addTiers);
    if (problem) {
      showToast('error', problem);
      return;
    }
    setAddSaving(true);
    try {
      const res = await fetch('/api/charge-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryCode: addCountry,
          currency: addCurrency,
          tiers: draftToPayloadTiers(addTiers),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Create failed');
      showToast('success', json.message);
      setShowAddModal(false);
      await fetchAll();
    } catch (e: any) {
      showToast('error', e?.message || 'Failed to create charge sheet');
    } finally {
      setAddSaving(false);
    }
  };

  // Tier list mutations (shared by sheet drafts and the add modal)
  const changeTierMax = (tiers: TierDraft[], index: number, value: string): TierDraft[] =>
    tiers.map((t, i) => (i === index ? { ...t, maxMembers: value } : t));

  const changeTierFee = (tiers: TierDraft[], index: number, value: string): TierDraft[] =>
    tiers.map((t, i) => (i === index ? { ...t, monthlyFee: value } : t));

  const addTierRow = (tiers: TierDraft[]): TierDraft[] => {
    // New row is inserted before the open-ended last tier; the previous
    // last tier gains an editable max.
    const copy = [...tiers];
    const last = copy[copy.length - 1];
    copy[copy.length - 1] = { ...last, maxMembers: '' };
    copy.splice(copy.length - 1, 0, { maxMembers: '', monthlyFee: '' });
    return copy;
  };

  const removeTierRow = (tiers: TierDraft[], index: number): TierDraft[] => {
    if (tiers.length <= 1) return tiers;
    const copy = tiers.filter((_, i) => i !== index);
    copy[copy.length - 1] = { ...copy[copy.length - 1], maxMembers: '' };
    return copy;
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ color: NAVY, fontSize: 24, margin: 0 }}>Membership Charges</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 6 }}>
          Group monthly subscription pricing per country, tiered by member count.
          Member annual joining fees are configured separately under Joining Fees.
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button
          type="button"
          style={{ ...btnPrimary, opacity: availableCountries.length === 0 ? 0.5 : 1 }}
          disabled={availableCountries.length === 0}
          onClick={openAdd}
        >
          + Add Country
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading charge sheets…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sheets.map((sheet) => {
            const draft = drafts[sheet.id];
            const isOpen = openAccordion.includes(sheet.id);
            const mins = draft ? derivedMins(draft.tiers) : [];
            return (
              <div
                key={sheet.id}
                style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'hidden' }}
              >
                <button
                  type="button"
                  onClick={() => toggleAccordion(sheet.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 18px',
                    background: isOpen ? '#f8fafc' : '#fff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 700, color: NAVY, fontSize: 15 }}>
                      {sheet.countryCode === 'DEFAULT' ? 'DEFAULT (fallback)' : sheet.countryCode}
                    </span>
                    <span style={{ fontSize: 13, color: '#64748b' }}>{sheet.currency}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: sheet.isActive ? '#dcfce7' : '#fee2e2',
                        color: sheet.isActive ? '#166534' : '#991b1b',
                      }}
                    >
                      {sheet.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </span>
                  <span style={{ color: '#64748b' }}>{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && draft ? (
                  <div style={{ padding: '4px 18px 18px 18px' }}>
                    <div style={{ display: 'flex', gap: 16, marginBottom: 14, alignItems: 'flex-end' }}>
                      <Field label="Currency" width={120}>
                        <input
                          value={draft.currency}
                          maxLength={3}
                          onChange={(e) =>
                            updateDraft(sheet.id, (d) => ({ ...d, currency: e.target.value.toUpperCase() }))
                          }
                          style={inputStyle}
                        />
                      </Field>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: NAVY, paddingBottom: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={draft.isActive}
                          onChange={(e) =>
                            updateDraft(sheet.id, (d) => ({ ...d, isActive: e.target.checked }))
                          }
                        />
                        Active
                      </label>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '90px 110px 140px 90px',
                        gap: 10,
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#64748b',
                        borderBottom: '2px solid #e2e8f0',
                        paddingBottom: 6,
                      }}
                    >
                      <div>FROM</div>
                      <div>TO</div>
                      <div>MONTHLY FEE</div>
                      <div></div>
                    </div>

                    {draft.tiers.map((tier, i) => (
                      <TierRow
                        key={i}
                        index={i}
                        min={mins[i]}
                        tier={tier}
                        isLast={i === draft.tiers.length - 1}
                        canRemove={draft.tiers.length > 1}
                        currency={draft.currency}
                        onMaxChange={(v) =>
                          updateDraft(sheet.id, (d) => ({ ...d, tiers: changeTierMax(d.tiers, i, v) }))
                        }
                        onFeeChange={(v) =>
                          updateDraft(sheet.id, (d) => ({ ...d, tiers: changeTierFee(d.tiers, i, v) }))
                        }
                        onRemove={() =>
                          updateDraft(sheet.id, (d) => ({ ...d, tiers: removeTierRow(d.tiers, i) }))
                        }
                      />
                    ))}

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
                      <button
                        type="button"
                        style={btnGhost}
                        onClick={() =>
                          updateDraft(sheet.id, (d) => ({ ...d, tiers: addTierRow(d.tiers) }))
                        }
                      >
                        + Add Tier
                      </button>
                      <div style={{ display: 'flex', gap: 10 }}>
                        {sheet.countryCode !== 'DEFAULT' ? (
                          <button
                            type="button"
                            style={btnDanger}
                            disabled={savingId === sheet.id}
                            onClick={() => deleteSheet(sheet)}
                          >
                            Delete
                          </button>
                        ) : null}
                        <button
                          type="button"
                          style={{ ...btnPrimary, opacity: savingId === sheet.id ? 0.6 : 1 }}
                          disabled={savingId === sheet.id}
                          onClick={() => saveSheet(sheet)}
                        >
                          {savingId === sheet.id ? 'Saving…' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {showAddModal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(13,33,55,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: 520, maxHeight: '85vh', overflowY: 'auto' }}>
            <h2 style={{ color: NAVY, fontSize: 18, marginTop: 0, marginBottom: 16 }}>Add Country Charges</h2>

            <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
              <Field label="Country" width={260}>
                <select
                  value={addCountry}
                  onChange={(e) => {
                    const code = e.target.value;
                    setAddCountry(code);
                    const c = availableCountries.find((x) => x.countryCode === code);
                    if (c) setAddCurrency(c.currency);
                  }}
                  style={inputStyle}
                >
                  {availableCountries.map((c) => (
                    <option key={c.countryCode} value={c.countryCode}>
                      {c.countryName} ({c.countryCode})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Currency" width={110}>
                <input
                  value={addCurrency}
                  maxLength={3}
                  onChange={(e) => setAddCurrency(e.target.value.toUpperCase())}
                  style={inputStyle}
                />
              </Field>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 110px 140px 90px',
                gap: 10,
                fontSize: 12,
                fontWeight: 700,
                color: '#64748b',
                borderBottom: '2px solid #e2e8f0',
                paddingBottom: 6,
              }}
            >
              <div>FROM</div>
              <div>TO</div>
              <div>MONTHLY FEE</div>
              <div></div>
            </div>

            {addTiers.map((tier, i) => (
              <TierRow
                key={i}
                index={i}
                min={derivedMins(addTiers)[i]}
                tier={tier}
                isLast={i === addTiers.length - 1}
                canRemove={addTiers.length > 1}
                currency={addCurrency}
                onMaxChange={(v) => setAddTiers((prev) => changeTierMax(prev, i, v))}
                onFeeChange={(v) => setAddTiers((prev) => changeTierFee(prev, i, v))}
                onRemove={() => setAddTiers((prev) => removeTierRow(prev, i))}
              />
            ))}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <button type="button" style={btnGhost} onClick={() => setAddTiers((prev) => addTierRow(prev))}>
                + Add Tier
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" style={btnGhost} onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  style={{ ...btnPrimary, opacity: addSaving ? 0.6 : 1 }}
                  disabled={addSaving}
                  onClick={submitAdd}
                >
                  {addSaving ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 9999,
            background: toast.kind === 'success' ? '#14532d' : '#7f1d1d',
            color: '#fff',
            padding: '12px 18px',
            borderRadius: 8,
            fontSize: 14,
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          }}
        >
          {toast.kind === 'success' ? '✅ ' : '❌ '}
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}
