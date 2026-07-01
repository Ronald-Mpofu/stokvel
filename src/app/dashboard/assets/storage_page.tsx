'use client'
import { useState, useEffect, useCallback } from 'react'
import CostingSheet from './CostingPanel'
import RoundRobinQueue from './QueuePanel'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const BLUE = '#1A5EA8'

// ── Campaign Types ────────────────────────────────────────────
const CAMPAIGN_TYPES = [
  {
    value: 'SHARED_OWNERSHIP',
    icon: '🤝',
    label: 'Shared Ownership',
    subtitle: 'Group buys one asset — all co-own it proportionally',
    description: 'Pool money together to buy a single high-value asset. Each member owns a percentage stake proportional to their contribution. Income, usage, and eventual sale proceeds are shared. Best for: community equipment, vehicles used by the group, property.',
    examples: ['Community tractor', 'Minibus for hire', 'Workshop equipment', 'Rental property'],
    color: TEAL, bg: '#E1F5EE', border: '#9FE1CB',
  },
  {
    value: 'ROUND_ROBIN',
    icon: '🔄',
    label: 'Round Robin Assets',
    subtitle: 'Each member gets their own asset — in turn',
    description: 'Like a cash round robin but instead of money, each member receives their own unit of the asset when their turn comes. Contributions accumulate until there is enough for one unit, then that unit goes to the next member in the queue. Repeat until everyone has received. Best for: individual machines, vehicles, boreholes, starter kits.',
    examples: ['Each member gets a tractor', 'Borehole drilled per member', 'Woodworking machine set per member', 'Laptop per member'],
    color: '#7C3AED', bg: '#F3E8FF', border: '#C4B5FD',
  },
]

const ASSET_TYPES = [
  { value: 'VEHICLE',                label: '🚗 Vehicle',               desc: 'Cars, trucks, minibuses' },
  { value: 'AGRICULTURAL_MACHINERY', label: '🚜 Agricultural Machinery', desc: 'Tractors, irrigation' },
  { value: 'INDUSTRIAL_MACHINERY',   label: '⚙️ Industrial Machinery',   desc: 'Woodworking, manufacturing' },
  { value: 'COMPUTER_EQUIPMENT',     label: '💻 Computer Equipment',     desc: 'Laptops, servers' },
  { value: 'HOME',                   label: '🏠 Home / Property',        desc: 'Residential, bond assist' },
  { value: 'OTHER',                  label: '📦 Other',                  desc: 'Any high-value asset' },
]

const POSITION_STRATEGIES = [
  { value: 'SENIORITY',  label: 'Seniority',   desc: 'Longer-standing members receive first' },
  { value: 'RANDOM',     label: 'Random Draw', desc: 'Cryptographically random shuffle' },
  { value: 'GROUP_VOTE', label: 'Group Vote',  desc: 'Members vote on the order' },
]

const STATUS_META: Record<string, { bg: string; color: string; icon: string }> = {
  FUNDING:     { bg: '#DBEAFE', color: '#1E40AF', icon: '📣' },
  ACQUIRED:    { bg: '#DCFCE7', color: '#166534', icon: '✅' },
  ACTIVE:      { bg: '#F0FDF4', color: '#166534', icon: '🔄' },
  DISPOSED:    { bg: '#F1F5F9', color: '#475569', icon: '📦' },
  WRITTEN_OFF: { bg: '#FEE2E2', color: '#991B1B', icon: '❌' },
}

const QUEUE_STATUS_META: Record<string, { bg: string; color: string; label: string }> = {
  WAITING:   { bg: '#F1F5F9', color: '#475569', label: 'Waiting' },
  FUNDING:   { bg: '#DBEAFE', color: '#1E40AF', label: 'Funding' },
  SOURCING:  { bg: '#FEF9C3', color: '#854D0E', label: 'Sourcing' },
  ORDERED:   { bg: '#F3E8FF', color: '#6B21A8', label: 'Ordered' },
  DELIVERED: { bg: '#DCFCE7', color: '#166534', label: 'Delivered' },
  SKIPPED:   { bg: '#FEE2E2', color: '#991B1B', label: 'Skipped' },
}

const EMPTY_FORM = {
  groupId: '', name: '', description: '',
  campaignType: 'SHARED_OWNERSHIP',
  type: 'VEHICLE',
  targetAmount: '', fundingDeadline: '',
  make: '', model: '', year: '', serialNumber: '', vin: '', location: '', notes: '',
  // Round robin specific
  unitsTotal: '10', unitCost: '', contributionPerMember: '',
  positionStrategy: 'SENIORITY', allowOutsiders: false,
}

// ── Primitive components — all at module level ─────────────────
function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || { bg: '#F1F5F9', color: '#475569', icon: '?' }
  return <span style={{ background: m.bg, color: m.color, fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px' }}>{m.icon} {status}</span>
}

function CampaignTypeBadge({ type }: { type: string }) {
  const ct = CAMPAIGN_TYPES.find(c => c.value === type)
  if (!ct) return null
  return (
    <span style={{ background: ct.bg, color: ct.color, fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      {ct.icon} {ct.label}
    </span>
  )
}

function ProgressBar({ pct, height = 8 }: { pct: number; height?: number }) {
  const bg = pct >= 100 ? '#166534' : pct >= 75 ? TEAL : pct >= 50 ? '#2563EB' : '#F59E0B'
  return (
    <div style={{ height, background: '#F1F5F9', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', borderRadius: height / 2, width: `${Math.min(100, pct)}%`, background: bg, transition: 'width 0.5s' }} />
    </div>
  )
}

function StatCard({ icon, label, value, sub, color }: any) {
  return (
    <div style={{ background: 'white', borderRadius: '10px', padding: '16px', border: '1px solid #E2E8F0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '18px' }}>{icon}</span>
        <span style={{ fontSize: '11px', color: '#64748B', fontWeight: '500' }}>{label}</span>
      </div>
      <div style={{ fontSize: '24px', fontWeight: '700', color }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '3px' }}>{sub}</div>}
    </div>
  )
}

function Toast({ msg, type, onClose }: any) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 9999, padding: '12px 20px', borderRadius: '10px', fontWeight: '500', fontSize: '13px', boxShadow: '0 8px 25px rgba(0,0,0,0.15)', background: type === 'success' ? '#166534' : '#991B1B', color: 'white', display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span>{type === 'success' ? '✅' : '❌'}</span>
      <span>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '18px' }}>×</button>
    </div>
  )
}

// ── Field components — stable ──────────────────────────────────
function Field({ label, value, onChange, type = 'text', placeholder = '', hint = '', required = false, disabled = false }: any) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>
        {label}{required && <span style={{ color: '#DC2626' }}> *</span>}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} disabled={disabled}
        style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any, background: disabled ? '#F8FAFC' : 'white', color: disabled ? '#94A3B8' : '#1E293B' }} />
      {hint && <p style={{ fontSize: '11px', color: '#94A3B8', margin: '4px 0 0' }}>{hint}</p>}
    </div>
  )
}

function TextArea({ label, value, onChange, placeholder = '', rows = 3 }: any) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any, resize: 'vertical' as any }} />
    </div>
  )
}

function SelectField({ label, value, onChange, options, required = false }: any) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>
        {label}{required && <span style={{ color: '#DC2626' }}> *</span>}
      </label>
      <select value={value} onChange={e => onChange(e.target.value)} required={required}
        style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: 'white', boxSizing: 'border-box' as any }}>
        {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ── Campaign Type Selector ─────────────────────────────────────
function CampaignTypeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {CAMPAIGN_TYPES.map(ct => (
        <div key={ct.value} onClick={() => onChange(ct.value)}
          style={{
            border: `2px solid ${value === ct.value ? ct.color : '#E2E8F0'}`,
            borderRadius: '12px', padding: '16px 18px', cursor: 'pointer',
            background: value === ct.value ? ct.bg : 'white',
            transition: 'all 0.15s',
          }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
            {/* Radio */}
            <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: `2px solid ${value === ct.value ? ct.color : '#CBD5E1'}`, background: value === ct.value ? ct.color : 'white', flexShrink: 0, marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {value === ct.value && <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'white' }} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '22px' }}>{ct.icon}</span>
                <span style={{ fontSize: '15px', fontWeight: '700', color: value === ct.value ? ct.color : NAVY }}>{ct.label}</span>
              </div>
              <p style={{ fontSize: '13px', fontWeight: '500', color: value === ct.value ? ct.color : '#475569', margin: '0 0 8px' }}>{ct.subtitle}</p>
              <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 10px', lineHeight: '1.5' }}>{ct.description}</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {ct.examples.map(ex => (
                  <span key={ex} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: ct.bg, color: ct.color, fontWeight: '500', border: `1px solid ${ct.border}` }}>{ex}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Contribute Modal ───────────────────────────────────────────
function ContributeModal({ asset, members, onClose, onSuccess }: any) {
  const [amount, setAmount] = useState('')
  const [userId, setUserId] = useState(members[0]?.id || '')
  const [method, setMethod] = useState('ECOCASH')
  const [ref, setRef] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const remaining = asset.targetAmount - asset.raisedAmount

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || parseFloat(amount) <= 0) return setError('Enter a valid amount')
    if (!userId) return setError('Select a member')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/assets/contribute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, userId, amount: parseFloat(amount), paymentMethod: method, paymentRef: ref }),
      })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error || 'Failed')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '440px', boxShadow: '0 25px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: NAVY, margin: '0 0 4px' }}>Contribute to Asset</h3>
            <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>{asset.name}</p>
          </div>
          <button onClick={onClose} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '18px', color: '#64748B' }}>×</button>
        </div>
        <div style={{ background: '#F0FDF4', borderRadius: '10px', padding: '12px', marginBottom: '18px', border: '1px solid #BBF7D0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#166534', marginBottom: '5px' }}>
            <span>Progress</span>
            <span style={{ fontWeight: '700' }}>{asset.fundingProgress}%</span>
          </div>
          <ProgressBar pct={asset.fundingProgress} height={8} />
          <div style={{ fontSize: '12px', color: '#166534', marginTop: '6px' }}>Remaining: <strong>${(remaining).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></div>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Member *</label>
            <select value={userId} onChange={e => setUserId(e.target.value)} required style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: 'white' }}>
              <option value="">Select member...</option>
              {members.map((m: any) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Amount *</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748B' }}>$</span>
              <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required
                style={{ width: '100%', padding: '9px 12px 9px 26px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', fontWeight: '600', outline: 'none', boxSizing: 'border-box' as any }} />
            </div>
            {remaining > 0 && <button type="button" onClick={() => setAmount(remaining.toFixed(2))} style={{ marginTop: '4px', fontSize: '11px', color: TEAL, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Fill remaining: ${remaining.toFixed(2)}</button>}
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Payment Method</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[['ECOCASH','📱 EcoCash'],['BANK_TRANSFER','🏦 Bank'],['CARD','💳 Card'],['CASH','💵 Cash']].map(([v, l]) => (
                <div key={v} onClick={() => setMethod(v)} style={{ padding: '8px', borderRadius: '8px', cursor: 'pointer', border: `2px solid ${method === v ? TEAL : '#E2E8F0'}`, background: method === v ? '#F0FDF4' : 'white', fontSize: '12px', fontWeight: '500', color: NAVY }}>{l}</div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Reference <span style={{ color: '#94A3B8', fontWeight: '400' }}>(optional)</span></label>
            <input type="text" value={ref} onChange={e => setRef(e.target.value)} placeholder="EcoCash ref, bank ref..."
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any }} />
          </div>
          {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px', color: '#991B1B', fontSize: '12px', marginBottom: '12px' }}>❌ {error}</div>}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#475569' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ flex: 2, padding: '10px', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: saving ? 'not-allowed' : 'pointer', background: saving ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white' }}>
              {saving ? '⏳ Recording...' : '✓ Record Contribution'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Create Campaign Form ───────────────────────────────────────
function CreateCampaignForm({ groups, members, onBack, onSuccess }: any) {
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [step, setStep] = useState(1)  // 1=type, 2=details, 3=settings
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = useCallback((k: string) => (v: any) => setForm(p => ({ ...p, [k]: v })), [])
  const ct = CAMPAIGN_TYPES.find(c => c.value === form.campaignType)!
  const isRR = form.campaignType === 'ROUND_ROBIN'
  const selectedType = ASSET_TYPES.find(t => t.value === form.type)

  // Auto-calculate target amount for Round Robin
  useEffect(() => {
    if (isRR && form.unitCost && form.unitsTotal) {
      const total = parseFloat(form.unitCost) * parseInt(form.unitsTotal)
      setForm(p => ({ ...p, targetAmount: String(total) }))
    }
  }, [form.unitCost, form.unitsTotal, isRR])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.groupId) return setError('Please select a group')
    if (!form.name.trim()) return setError('Campaign name is required')
    if (!form.targetAmount) return setError('Target amount is required')
    setSaving(true)
    try {
      const res = await fetch('/api/assets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          targetAmount: parseFloat(form.targetAmount),
          year: form.year ? parseInt(form.year) : undefined,
          unitsTotal: parseInt(form.unitsTotal) || 1,
          unitCost: form.unitCost ? parseFloat(form.unitCost) : undefined,
          contributionPerMember: form.contributionPerMember ? parseFloat(form.contributionPerMember) : undefined,
        }),
      })
      const data = await res.json()
      if (data.success) onSuccess(data.message)
      else setError(data.error || 'Failed to create campaign')
    } catch { setError('Network error. Please try again.') }
    finally { setSaving(false) }
  }

  const STEPS = ['Campaign Type', 'Asset Details', 'Settings & Launch']

  return (
    <div style={{ maxWidth: '760px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <button onClick={onBack} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', color: '#475569' }}>← Back</button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: NAVY, margin: '0 0 2px' }}>New Asset Campaign</h2>
          <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>Step {step} of 3 — {STEPS[step - 1]}</p>
        </div>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '24px' }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: i + 1 < step ? 'pointer' : 'default' }}
              onClick={() => { if (i + 1 < step) setStep(i + 1) }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', flexShrink: 0, background: i + 1 < step ? TEAL : i + 1 === step ? ct.color : '#E2E8F0', color: i + 1 <= step ? 'white' : '#94A3B8' }}>
                {i + 1 < step ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: '12px', fontWeight: i + 1 === step ? '600' : '400', color: i + 1 === step ? ct.color : i + 1 < step ? TEAL : '#94A3B8', whiteSpace: 'nowrap' }}>{s}</span>
            </div>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: '1px', background: i + 1 < step ? TEAL : '#E2E8F0', margin: '0 12px' }} />}
          </div>
        ))}
      </div>

      {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', color: '#991B1B', fontSize: '13px' }}>❌ {error}</div>}

      <form onSubmit={handleSubmit}>

        {/* ── STEP 1: Campaign Type ── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 6px' }}>What type of asset campaign is this?</h3>
              <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 16px' }}>This determines how contributions are collected and how members receive the asset.</p>
              <CampaignTypeSelector value={form.campaignType} onChange={set('campaignType')} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setStep(2)}
                style={{ padding: '11px 28px', background: ct.color, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                Continue → Asset Details
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Asset Details ── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Campaign type reminder banner */}
            <div style={{ background: ct.bg, border: `1px solid ${ct.border}`, borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '22px' }}>{ct.icon}</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: ct.color }}>{ct.label}</div>
                <div style={{ fontSize: '12px', color: ct.color, opacity: 0.8 }}>{ct.subtitle}</div>
              </div>
              <button type="button" onClick={() => setStep(1)} style={{ marginLeft: 'auto', fontSize: '11px', color: ct.color, background: 'none', border: `1px solid ${ct.border}`, borderRadius: '6px', padding: '4px 8px', cursor: 'pointer' }}>Change</button>
            </div>

            {/* Group */}
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>👥 Group & Campaign Name</h3>
              <SelectField label="Group" value={form.groupId} onChange={set('groupId')} required
                options={[{ value: '', label: 'Select a group...' }, ...groups.map((g: any) => ({ value: g.id, label: `${g.name} (${g.currency})` }))]} />
              <Field label="Campaign Name" value={form.name} onChange={set('name')} placeholder={isRR ? 'e.g. Member Tractors 2025' : 'e.g. Community Tractor Fund'} required />
              <TextArea label="Description" value={form.description} onChange={set('description')} placeholder="What is this campaign for? How will the asset be used?" />
            </div>

            {/* Asset type */}
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>🏷️ Asset Type</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {ASSET_TYPES.map(t => (
                  <div key={t.value} onClick={() => set('type')(t.value)}
                    style={{ padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', border: `2px solid ${form.type === t.value ? ct.color : '#E2E8F0'}`, background: form.type === t.value ? ct.bg : 'white', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '50%', border: `2px solid ${form.type === t.value ? ct.color : '#CBD5E1'}`, background: form.type === t.value ? ct.color : 'white', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {form.type === t.value && <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'white' }} />}
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: NAVY }}>{t.label}</div>
                      <div style={{ fontSize: '11px', color: '#64748B' }}>{t.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Funding — differs by campaign type */}
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>
                💰 {isRR ? 'Funding per Member' : 'Funding Target'}
              </h3>

              {isRR ? (
                // Round Robin specific funding
                <div>
                  <div style={{ background: '#F3E8FF', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px', border: '1px solid #C4B5FD', fontSize: '12px', color: '#6B21A8' }}>
                    💡 For Round Robin: each member contributes monthly until there's enough for one unit. That unit is delivered to the next member in the queue. The cycle repeats.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <Field label="Number of Members in Queue" value={form.unitsTotal} onChange={set('unitsTotal')} type="number" placeholder="10" hint="One unit per member" required />
                    <Field label="Cost per Unit ($)" value={form.unitCost} onChange={set('unitCost')} type="number" placeholder="5000" hint="Landed cost for one unit" required />
                    <Field label="Monthly Contribution per Member ($)" value={form.contributionPerMember} onChange={set('contributionPerMember')} type="number" placeholder="500" hint="How much each member contributes monthly" />
                    <Field label="Total Campaign Target ($)" value={form.targetAmount} onChange={set('targetAmount')} type="number"
                      hint={form.unitCost && form.unitsTotal ? `Auto-calculated: $${(parseFloat(form.unitCost||'0') * parseInt(form.unitsTotal||'1')).toLocaleString()} total` : 'Auto-fills when unit cost × members entered'}
                      disabled={!!(form.unitCost && form.unitsTotal)} />
                  </div>
                  {form.unitCost && form.unitsTotal && form.contributionPerMember && (
                    <div style={{ background: '#F3E8FF', borderRadius: '8px', padding: '12px 14px', border: '1px solid #C4B5FD', marginTop: '4px' }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#6B21A8', marginBottom: '6px' }}>📊 Queue Preview</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '12px', color: '#6B21A8' }}>
                        <div><div style={{ opacity: 0.7 }}>Months to fund 1 unit</div><div style={{ fontSize: '16px', fontWeight: '700' }}>~{Math.ceil(parseFloat(form.unitCost) / (parseFloat(form.contributionPerMember) * parseInt(form.unitsTotal)))} months</div></div>
                        <div><div style={{ opacity: 0.7 }}>Total cycle duration</div><div style={{ fontSize: '16px', fontWeight: '700' }}>~{Math.ceil(parseFloat(form.unitCost) / (parseFloat(form.contributionPerMember) * parseInt(form.unitsTotal))) * parseInt(form.unitsTotal)} months</div></div>
                        <div><div style={{ opacity: 0.7 }}>Total raised per member</div><div style={{ fontSize: '16px', fontWeight: '700' }}>${(parseFloat(form.unitCost) || 0).toLocaleString()}</div></div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // Shared ownership funding
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <Field label="Target Amount ($)" value={form.targetAmount} onChange={set('targetAmount')} type="number" placeholder="50000" required hint="Total cost including all expenses" />
                  <Field label="Funding Deadline" value={form.fundingDeadline} onChange={set('fundingDeadline')} type="date" hint="Leave blank for open-ended campaign" />
                </div>
              )}
            </div>

            {/* Asset spec */}
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>{selectedType?.label} Details</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {['VEHICLE','AGRICULTURAL_MACHINERY','INDUSTRIAL_MACHINERY'].includes(form.type) && (
                  <>
                    <Field label="Make / Brand" value={form.make} onChange={set('make')} placeholder="e.g. Toyota, John Deere" />
                    <Field label="Model" value={form.model} onChange={set('model')} placeholder="e.g. Hilux, 5055E" />
                    <Field label="Year" value={form.year} onChange={set('year')} type="number" placeholder="2025" />
                    {form.type === 'VEHICLE'
                      ? <Field label="VIN" value={form.vin} onChange={set('vin')} placeholder="Vehicle Identification Number" />
                      : <Field label="Serial Number" value={form.serialNumber} onChange={set('serialNumber')} placeholder="Manufacturer serial" />}
                  </>
                )}
                {form.type === 'COMPUTER_EQUIPMENT' && (
                  <>
                    <Field label="Brand" value={form.make} onChange={set('make')} placeholder="e.g. Dell, HP" />
                    <Field label="Model" value={form.model} onChange={set('model')} placeholder="e.g. Latitude 5540" />
                    <Field label="Serial Number" value={form.serialNumber} onChange={set('serialNumber')} placeholder="Device serial" />
                  </>
                )}
                <Field label="Location / Site" value={form.location} onChange={set('location')} placeholder="Where will the asset be based?" />
              </div>
              <TextArea label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any additional details..." rows={2} />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" onClick={() => setStep(1)} style={{ padding: '11px 20px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', color: '#475569' }}>← Back</button>
              <button type="button" onClick={() => { if (!form.groupId || !form.name) return setError('Fill in group and name first'); setError(''); setStep(3) }}
                style={{ flex: 1, padding: '11px', background: ct.color, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                Continue → Settings & Launch
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Settings & Launch ── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Summary card */}
            <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${ct.color})`, borderRadius: '12px', padding: '20px', color: 'white' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>Campaign summary</div>
              <div style={{ fontSize: '20px', fontWeight: '700', marginBottom: '4px' }}>{form.name || 'Unnamed Campaign'}</div>
              <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'rgba(255,255,255,0.85)', flexWrap: 'wrap' }}>
                <span>{ct.icon} {ct.label}</span>
                <span>{selectedType?.label}</span>
                {isRR ? (
                  <><span>{form.unitsTotal} members</span><span>${parseFloat(form.unitCost||'0').toLocaleString()} / unit</span></>
                ) : (
                  <span>Target: ${parseFloat(form.targetAmount||'0').toLocaleString()}</span>
                )}
                <span>{groups.find((g: any) => g.id === form.groupId)?.name || 'No group selected'}</span>
              </div>
            </div>

            {/* Round Robin specific settings */}
            {isRR && (
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>🔄 Queue Settings</h3>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Position Assignment Strategy</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {POSITION_STRATEGIES.map(s => (
                      <div key={s.value} onClick={() => set('positionStrategy')(s.value)}
                        style={{ padding: '12px 14px', borderRadius: '8px', cursor: 'pointer', border: `2px solid ${form.positionStrategy === s.value ? '#7C3AED' : '#E2E8F0'}`, background: form.positionStrategy === s.value ? '#F3E8FF' : 'white', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: `2px solid ${form.positionStrategy === s.value ? '#7C3AED' : '#CBD5E1'}`, background: form.positionStrategy === s.value ? '#7C3AED' : 'white', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {form.positionStrategy === s.value && <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'white' }} />}
                        </div>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '600', color: NAVY }}>{s.label}</div>
                          <div style={{ fontSize: '11px', color: '#64748B' }}>{s.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Outside contributors */}
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>🌐 Outside Contributors</h3>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px', borderRadius: '10px', border: `2px solid ${form.allowOutsiders ? '#0F6E56' : '#E2E8F0'}`, background: form.allowOutsiders ? '#F0FDF4' : 'white', cursor: 'pointer' }}
                onClick={() => set('allowOutsiders')(!form.allowOutsiders)}>
                <div style={{ width: '22px', height: '22px', borderRadius: '4px', border: `2px solid ${form.allowOutsiders ? TEAL : '#CBD5E1'}`, background: form.allowOutsiders ? TEAL : 'white', flexShrink: 0, marginTop: '1px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {form.allowOutsiders && <span style={{ color: 'white', fontSize: '14px', fontWeight: '700' }}>✓</span>}
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: NAVY, marginBottom: '4px' }}>Allow outside contributors (non-members)</div>
                  <div style={{ fontSize: '12px', color: '#64748B', lineHeight: '1.5' }}>
                    People outside the group can contribute to this campaign and receive a proportional ownership stake. They cannot vote on group decisions or access other group modules. Full KYC verification still required.
                  </div>
                </div>
              </div>
            </div>

            {/* Costing sheet prompt */}
            <div style={{ background: '#EEF2FF', borderRadius: '10px', padding: '14px 18px', border: '1px solid #C7D2FE', fontSize: '13px', color: '#3730A3', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '24px' }}>📊</span>
              <div>
                <div style={{ fontWeight: '600', marginBottom: '2px' }}>Add a Costing Sheet after launch</div>
                <div style={{ fontSize: '12px', opacity: 0.85 }}>Once the campaign is created, open it and click "📊 Costing Sheet" to build a transparent breakdown of purchase price, freight, customs, and all other costs — so members know exactly what they're funding.</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" onClick={() => setStep(2)} style={{ padding: '11px 20px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', color: '#475569' }}>← Back</button>
              <button type="submit" disabled={saving} style={{ flex: 1, padding: '11px', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: saving ? 'not-allowed' : 'pointer', background: saving ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${ct.color})`, color: 'white' }}>
                {saving ? '⏳ Launching campaign...' : `🚀 Launch ${ct.label} Campaign`}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}

// ── Asset Detail ───────────────────────────────────────────────
function AssetDetail({ asset, members, onBack, onSuccess, onCosting, onQueue }: any) {
  const [showContribute, setShowContribute] = useState(false)
  const typeInfo  = ASSET_TYPES.find(t => t.value === asset.type)
  const ct        = CAMPAIGN_TYPES.find(c => c.value === (asset.campaignType || 'SHARED_OWNERSHIP'))!
  const isRR      = asset.campaignType === 'ROUND_ROBIN'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {showContribute && (
        <ContributeModal asset={asset} members={members} onClose={() => setShowContribute(false)}
          onSuccess={(msg: string) => { onSuccess(msg); setShowContribute(false) }} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={onBack} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', color: '#475569' }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '22px' }}>{typeInfo?.label.split(' ')[0]}</span>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: NAVY, margin: 0 }}>{asset.name}</h2>
            <StatusBadge status={asset.status} />
            <CampaignTypeBadge type={asset.campaignType || 'SHARED_OWNERSHIP'} />
          </div>
          <p style={{ fontSize: '12px', color: '#64748B', margin: '3px 0 0' }}>{asset.groupName} · {asset.type.replace(/_/g,' ')} · {asset.currency}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {asset.status === 'FUNDING' && (
            <button onClick={() => setShowContribute(true)} style={{ padding: '8px 14px', background: ct.color, color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>💰 Contribute</button>
          )}
          <button onClick={onCosting} style={{ padding: '8px 14px', background: '#EEF2FF', color: '#3730A3', border: '1px solid #C7D2FE', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>📊 Costing Sheet</button>
          {(asset.campaignType === 'ROUND_ROBIN') && (
            <button onClick={onQueue} style={{ padding: '8px 14px', background: '#F3E8FF', color: '#6B21A8', border: '1px solid #C4B5FD', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>🔄 Queue Manager</button>
          )}
        </div>
      </div>

      {/* Progress hero */}
      {asset.status === 'FUNDING' && (
        <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${ct.color})`, borderRadius: '16px', padding: '24px', color: 'white' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
            <div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>
                {isRR ? 'Funding for current member in queue' : 'Campaign progress'}
              </div>
              <div style={{ fontSize: '36px', fontWeight: '700' }}>{asset.fundingProgress}%</div>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', marginTop: '4px' }}>
                ${asset.raisedAmount.toLocaleString()} of ${asset.targetAmount.toLocaleString()}
              </div>
            </div>
            {isRR && (
              <div style={{ textAlign: 'right', background: 'rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 14px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>Queue</div>
                <div style={{ fontSize: '22px', fontWeight: '700' }}>{asset.unitsTotal || '—'} members</div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', marginTop: '2px' }}>Strategy: {asset.positionStrategy || 'Seniority'}</div>
              </div>
            )}
          </div>
          <div style={{ height: '10px', background: 'rgba(255,255,255,0.2)', borderRadius: '5px', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '5px', background: 'rgba(255,255,255,0.9)', width: `${Math.min(100, asset.fundingProgress)}%` }} />
          </div>
          <div style={{ display: 'flex', gap: '20px', marginTop: '12px', fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
            <span>{asset.ownerCount} contributors</span>
            <span>Target: ${asset.targetAmount.toLocaleString()}</span>
            {asset.fundingDeadline && <span>Deadline: {new Date(asset.fundingDeadline).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>}
          </div>
        </div>
      )}

      {/* Details + stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px' }}>📋 Asset Details</h3>
          {([
            ['Campaign type', ct.label],
            ['Asset type',    asset.type.replace(/_/g,' ')],
            ['Description',   asset.description || '—'],
            ['Make',          asset.make || '—'],
            ['Model',         asset.model || '—'],
            ['Year',          asset.year || '—'],
            ['Location',      asset.location || '—'],
            ['Target',        `$${asset.targetAmount.toLocaleString()}`],
            ['Raised',        `$${asset.raisedAmount.toLocaleString()}`],
            ['Group',         asset.groupName],
            ...(isRR ? [
              ['Members in queue', asset.unitsTotal || '—'],
              ['Cost per unit',    asset.unitCost ? `$${Number(asset.unitCost).toLocaleString()}` : '—'],
              ['Monthly contrib.', asset.contributionPerMember ? `$${Number(asset.contributionPerMember).toLocaleString()}/mo` : '—'],
              ['Position method',  asset.positionStrategy || 'Seniority'],
            ] : []),
          ] as [string,string][]).map(([l,v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F8FAFC', fontSize: '13px' }}>
              <span style={{ color: '#64748B' }}>{l}</span>
              <span style={{ color: NAVY, fontWeight: '500', maxWidth: '60%', textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[
            { icon: '💰', label: 'Raised',       value: `$${asset.raisedAmount.toLocaleString()}`,    color: TEAL },
            { icon: '🎯', label: 'Target',        value: `$${asset.targetAmount.toLocaleString()}`,   color: NAVY },
            { icon: '👥', label: 'Contributors',  value: `${asset.ownerCount}`,                       color: BLUE },
            { icon: '💵', label: 'Income earned', value: `$${asset.incomeGenerated.toLocaleString()}`,color: '#166534' },
          ].map(s => (
            <div key={s.label} style={{ background: 'white', borderRadius: '10px', padding: '14px 16px', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '20px' }}>{s.icon}</span>
              <div style={{ flex: 1 }}><div style={{ fontSize: '11px', color: '#64748B' }}>{s.label}</div></div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Ownership / Queue table */}
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: 0 }}>
            {isRR ? '🔄 Member Queue' : '🏦 Ownership Stakes'}
          </h3>
          <span style={{ fontSize: '12px', color: '#64748B' }}>{asset.ownerCount} {isRR ? 'in queue' : 'co-owners'}</span>
        </div>
        {asset.ownerships.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>No contributions yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {isRR
                  ? ['Position','Member','Contributed','Status','Unit Cost','Action'].map(h => <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:'11px', fontWeight:'600', color:'#64748B', borderBottom:'1px solid #E2E8F0', textTransform:'uppercase' }}>{h}</th>)
                  : ['Member','Contributed','Stake %','Share Value','Since'].map(h => <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:'11px', fontWeight:'600', color:'#64748B', borderBottom:'1px solid #E2E8F0', textTransform:'uppercase' }}>{h}</th>)
                }
              </tr>
            </thead>
            <tbody>
              {[...asset.ownerships].sort((a: any, b: any) => isRR ? (a.position||99)-(b.position||99) : b.ownershipPct-a.ownershipPct).map((o: any, i: number) => (
                <tr key={o.userId} style={{ borderBottom: '1px solid #F8FAFC', background: i % 2 === 0 ? 'white' : '#FAFAFA' }}>
                  {isRR ? (
                    <>
                      <td style={{ padding:'10px 16px', fontSize:'13px', fontWeight:'700', color: ct.color }}>#{i+1}</td>
                      <td style={{ padding:'10px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                          <div style={{ width:'28px', height:'28px', borderRadius:'50%', background: ct.bg, color: ct.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'700' }}>
                            {o.memberName.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                          </div>
                          <span style={{ fontSize:'13px', fontWeight:'500', color:NAVY }}>{o.memberName}</span>
                        </div>
                      </td>
                      <td style={{ padding:'10px 16px', fontSize:'13px', fontWeight:'600', color:TEAL }}>${o.amountContributed.toLocaleString()}</td>
                      <td style={{ padding:'10px 16px' }}>
                        <span style={{ background: QUEUE_STATUS_META['WAITING'].bg, color: QUEUE_STATUS_META['WAITING'].color, fontSize:'10px', fontWeight:'600', padding:'2px 7px', borderRadius:'999px' }}>
                          {QUEUE_STATUS_META['WAITING'].label}
                        </span>
                      </td>
                      <td style={{ padding:'10px 16px', fontSize:'12px', color:'#475569' }}>${(asset.unitCost||asset.targetAmount/Math.max(1,asset.unitsTotal||1)).toLocaleString()}</td>
                      <td style={{ padding:'10px 16px' }}><button style={{ padding:'3px 8px', background:'#F1F5F9', border:'none', borderRadius:'4px', fontSize:'11px', cursor:'pointer', color:'#475569' }}>Details</button></td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding:'10px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                          <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:'#E1F5EE', color:TEAL, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'700' }}>
                            {o.memberName.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                          </div>
                          <span style={{ fontSize:'13px', fontWeight:'500', color:NAVY }}>{o.memberName}</span>
                        </div>
                      </td>
                      <td style={{ padding:'10px 16px', fontSize:'13px', fontWeight:'600', color:TEAL }}>${o.amountContributed.toLocaleString()}</td>
                      <td style={{ padding:'10px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                          <div style={{ flex:1, height:'5px', background:'#F1F5F9', borderRadius:'3px', overflow:'hidden', minWidth:'50px' }}>
                            <div style={{ height:'100%', background:TEAL, borderRadius:'3px', width:`${o.ownershipPct}%` }} />
                          </div>
                          <span style={{ fontSize:'12px', fontWeight:'700', color:NAVY }}>{o.ownershipPct.toFixed(2)}%</span>
                        </div>
                      </td>
                      <td style={{ padding:'10px 16px', fontSize:'12px', color:'#475569' }}>${(asset.raisedAmount * o.ownershipPct/100).toFixed(2)}</td>
                      <td style={{ padding:'10px 16px', fontSize:'11px', color:'#94A3B8' }}>{new Date(o.acquiredAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'})}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────
export default function AssetsPage() {
  const [view, setView]         = useState<'list'|'create'|'detail'|'costing'|'queue'>('list')
  const [assets, setAssets]     = useState<any[]>([])
  const [groups, setGroups]     = useState<any[]>([])
  const [members, setMembers]   = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<any>(null)
  const [toast, setToast]       = useState<any>(null)
  const [search, setSearch]     = useState('')
  const [filterType, setFilterType]       = useState('ALL')
  const [filterStatus, setFilterStatus]   = useState('ALL')
  const [filterCampaign, setFilterCampaign] = useState('ALL')
  const [contributeAsset, setContributeAsset] = useState<any>(null)

  function showToast(msg: string, type: 'success'|'error' = 'success') { setToast({ msg, type }) }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [aRes, gRes, mRes] = await Promise.all([fetch('/api/assets'), fetch('/api/groups'), fetch('/api/members')])
      const [aData, gData, mData] = await Promise.all([aRes.json(), gRes.json(), mRes.json()])
      if (aData.success) setAssets(aData.data)
      if (gData.success) setGroups(gData.data)
      if (mData.success) setMembers(mData.data)
    } catch { showToast('Failed to load data', 'error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const refreshSelected = useCallback(async (id: string) => {
    const res  = await fetch('/api/assets')
    const data = await res.json()
    if (data.success) {
      setAssets(data.data)
      const updated = data.data.find((a: any) => a.id === id)
      if (updated) setSelected(updated)
    }
  }, [])

  const filtered = assets.filter(a => {
    const ms  = a.name.toLowerCase().includes(search.toLowerCase()) || a.groupName.toLowerCase().includes(search.toLowerCase())
    const mt  = filterType === 'ALL' || a.type === filterType
    const mst = filterStatus === 'ALL' || a.status === filterStatus
    const mc  = filterCampaign === 'ALL' || (a.campaignType || 'SHARED_OWNERSHIP') === filterCampaign
    return ms && mt && mst && mc
  })

  const totalTarget = assets.reduce((s, a) => s + a.targetAmount, 0)
  const totalRaised = assets.reduce((s, a) => s + a.raisedAmount, 0)
  const rrAssets    = assets.filter(a => a.campaignType === 'ROUND_ROBIN')
  const sharedAssets= assets.filter(a => (a.campaignType || 'SHARED_OWNERSHIP') === 'SHARED_OWNERSHIP')

  if (view === 'queue' && selected) return (
    <>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <RoundRobinQueue
        assetId={selected.id}
        assetName={selected.name}
        members={members}
        onBack={() => setView('detail')}
      />
    </>
  )

  if (view === 'costing' && selected) return (
    <>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <CostingSheet assetId={selected.id} assetName={selected.name} currency={selected.currency}
        onClose={() => setView('detail')}
        onSaved={(msg: string) => { showToast(msg); refreshSelected(selected.id) }} />
    </>
  )

  if (view === 'create') return (
    <CreateCampaignForm groups={groups} members={members} onBack={() => setView('list')}
      onSuccess={(msg: string) => { showToast(msg); setView('list'); fetchAll() }} />
  )

  if (view === 'detail' && selected) return (
    <>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <AssetDetail asset={selected} members={members} onBack={() => setView('list')}
        onCosting={() => setView('costing')}
        onQueue={() => setView('queue')}
        onSuccess={(msg: string) => { showToast(msg); refreshSelected(selected.id) }} />
    </>
  )

  // ── LIST ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {contributeAsset && (
        <ContributeModal asset={contributeAsset} members={members}
          onClose={() => setContributeAsset(null)}
          onSuccess={(msg: string) => { showToast(msg); fetchAll(); setContributeAsset(null) }} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: NAVY, margin: '0 0 4px' }}>Asset Campaigns</h2>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Shared ownership and round robin asset acquisition</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={fetchAll} style={{ padding: '8px 14px', background: '#F1F5F9', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: '#475569' }}>↻ Refresh</button>
          <button onClick={() => setView('create')} style={{ padding: '10px 18px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>+ New Campaign</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <StatCard icon="🤝" label="Shared Ownership"  value={sharedAssets.length} sub="Co-owned by group"   color={TEAL}      />
        <StatCard icon="🔄" label="Round Robin"        value={rrAssets.length}     sub="Each member's turn"  color="#7C3AED"   />
        <StatCard icon="🎯" label="Total Target"       value={`$${totalTarget.toLocaleString()}`} sub="All campaigns" color={NAVY} />
        <StatCard icon="💰" label="Total Raised"       value={`$${totalRaised.toLocaleString()}`} sub={`${totalTarget > 0 ? Math.round(totalRaised/totalTarget*100) : 0}% funded`} color="#166534" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search campaigns..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 14px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', width: '200px', outline: 'none' }} />
        <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)}
          style={{ padding: '8px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: 'white' }}>
          <option value="ALL">All Types</option>
          <option value="SHARED_OWNERSHIP">🤝 Shared Ownership</option>
          <option value="ROUND_ROBIN">🔄 Round Robin</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: '8px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: 'white' }}>
          <option value="ALL">All Asset Types</option>
          {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {['ALL','FUNDING','ACQUIRED','ACTIVE'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{
            padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: '500', cursor: 'pointer',
            background: filterStatus === s ? TEAL : 'white', color: filterStatus === s ? 'white' : '#64748B',
            border: filterStatus === s ? 'none' : '1.5px solid #E2E8F0',
          }}>{s}</button>
        ))}
      </div>

      {loading && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '60px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          <p style={{ color: '#64748B' }}>Loading campaigns...</p>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '60px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🏗️</div>
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: NAVY, margin: '0 0 8px' }}>
            {search || filterType !== 'ALL' || filterStatus !== 'ALL' || filterCampaign !== 'ALL' ? 'No campaigns match your filter' : 'No asset campaigns yet'}
          </h3>
          <p style={{ color: '#64748B', fontSize: '13px', marginBottom: '20px' }}>
            {!search && filterType === 'ALL' && filterStatus === 'ALL' && filterCampaign === 'ALL' && 'Create a Shared Ownership or Round Robin campaign to get started.'}
          </p>
          {!search && filterType === 'ALL' && filterStatus === 'ALL' && filterCampaign === 'ALL' && (
            <button onClick={() => setView('create')} style={{ padding: '10px 20px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              + Launch First Campaign
            </button>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {filtered.map(a => {
            const typeInfo = ASSET_TYPES.find(t => t.value === a.type)
            const ct = CAMPAIGN_TYPES.find(c => c.value === (a.campaignType || 'SHARED_OWNERSHIP'))!
            const isRR = a.campaignType === 'ROUND_ROBIN'
            const isActive = ['FUNDING','ACQUIRED','ACTIVE'].includes(a.status)
            return (
              <div key={a.id} style={{ background: 'white', borderRadius: '12px', border: `1px solid ${isRR ? '#C4B5FD' : '#E2E8F0'}`, overflow: 'hidden' }}>
                <div style={{ background: isActive ? `linear-gradient(135deg, ${NAVY}, ${ct.color})` : '#F8FAFC', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '26px' }}>{typeInfo?.label.split(' ')[0]}</span>
                      <div style={{ background: 'rgba(255,255,255,0.15)', padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '600', color: isActive ? 'white' : ct.color }}>{ct.icon} {ct.label}</div>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                  <h3 style={{ fontSize: '14px', fontWeight: '700', color: isActive ? 'white' : NAVY, margin: '0 0 2px' }}>{a.name}</h3>
                  <p style={{ fontSize: '11px', color: isActive ? 'rgba(255,255,255,0.7)' : '#94A3B8', margin: 0 }}>{a.groupName}</p>
                </div>

                <div style={{ padding: '14px 16px' }}>
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span style={{ color: '#64748B' }}>{isRR ? 'Current unit funded' : 'Progress'}</span>
                      <span style={{ fontWeight: '700', color: a.fundingProgress >= 100 ? '#166534' : NAVY }}>{a.fundingProgress}%</span>
                    </div>
                    <ProgressBar pct={a.fundingProgress} />
                    <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '3px' }}>
                      ${a.raisedAmount.toLocaleString()} of ${a.targetAmount.toLocaleString()}
                      {isRR && a.unitsTotal && ` · ${a.unitsTotal} in queue`}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
                    {[
                      { label: isRR ? 'Queue size' : 'Co-owners', value: isRR ? `${a.unitsTotal||'—'} members` : `${a.ownerCount}` },
                      { label: 'Currency', value: a.currency },
                      { label: isRR ? 'Unit cost' : 'Target', value: isRR && a.unitCost ? `$${Number(a.unitCost).toLocaleString()}` : `$${a.targetAmount.toLocaleString()}` },
                      { label: 'Income', value: `$${a.incomeGenerated.toFixed(0)}` },
                    ].map(item => (
                      <div key={item.label} style={{ background: '#F8FAFC', borderRadius: '6px', padding: '5px 8px' }}>
                        <div style={{ fontSize: '9px', color: '#94A3B8', textTransform: 'uppercase' }}>{item.label}</div>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: NAVY }}>{item.value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => { setSelected(a); setView('detail') }}
                      style={{ flex: 1, padding: '8px', background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', color: NAVY }}>
                      View Details →
                    </button>
                    <button onClick={() => { setSelected(a); setView('costing') }} title="Costing Sheet"
                      style={{ padding: '8px 10px', background: '#EEF2FF', color: '#3730A3', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>📊</button>
                    {a.campaignType === 'ROUND_ROBIN' && (
                      <button onClick={() => { setSelected(a); setView('queue') }} title="Queue Manager"
                        style={{ padding: '8px 10px', background: '#F3E8FF', color: '#6B21A8', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>🔄</button>
                    )}
                    {a.status === 'FUNDING' && a.campaignType !== 'ROUND_ROBIN' && (
                      <button onClick={() => setContributeAsset(a)}
                        style={{ padding: '8px 10px', background: ct.color, color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>💰</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
