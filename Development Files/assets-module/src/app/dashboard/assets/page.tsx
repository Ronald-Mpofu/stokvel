'use client'
import { useState, useEffect, useCallback } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const BLUE = '#1A5EA8'

const ASSET_TYPES = [
  { value: 'VEHICLE',                label: '🚗 Vehicle',               desc: 'Cars, trucks, minibuses, motorcycles' },
  { value: 'AGRICULTURAL_MACHINERY', label: '🚜 Agricultural Machinery', desc: 'Tractors, irrigation, farming equipment' },
  { value: 'INDUSTRIAL_MACHINERY',   label: '⚙️  Industrial Machinery',  desc: 'Woodworking, manufacturing, processing' },
  { value: 'COMPUTER_EQUIPMENT',     label: '💻 Computer Equipment',     desc: 'Laptops, servers, office technology' },
  { value: 'HOME',                   label: '🏠 Home / Property',        desc: 'Residential property, bond assistance' },
  { value: 'OTHER',                  label: '📦 Other Asset',            desc: 'Any other high-value asset' },
]

const STATUS_META: Record<string, { bg: string; color: string; icon: string; label: string }> = {
  FUNDING:    { bg: '#DBEAFE', color: '#1E40AF', icon: '📣', label: 'Funding'    },
  ACQUIRED:   { bg: '#DCFCE7', color: '#166534', icon: '✅', label: 'Acquired'   },
  ACTIVE:     { bg: '#F0FDF4', color: '#166534', icon: '🔄', label: 'Active'     },
  DISPOSED:   { bg: '#F1F5F9', color: '#475569', icon: '📦', label: 'Disposed'   },
  WRITTEN_OFF:{ bg: '#FEE2E2', color: '#991B1B', icon: '❌', label: 'Written Off'},
}

const EMPTY_FORM = {
  groupId: '', name: '', description: '', type: 'VEHICLE',
  targetAmount: '', currency: 'USD', fundingDeadline: '',
  make: '', model: '', year: '', serialNumber: '', vin: '', location: '', notes: '',
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || { bg: '#F1F5F9', color: '#475569', icon: '?', label: status }
  return (
    <span style={{ background: m.bg, color: m.color, fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      {m.icon} {m.label}
    </span>
  )
}

function ProgressBar({ pct, color = TEAL, height = 8 }: any) {
  return (
    <div style={{ height, background: '#F1F5F9', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{
        height: '100%', borderRadius: height / 2,
        width: `${Math.min(100, pct)}%`,
        background: pct >= 100 ? '#166534' : pct >= 75 ? TEAL : pct >= 50 ? '#2563EB' : '#F59E0B',
        transition: 'width 0.6s ease',
      }} />
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
      <span>{type === 'success' ? '✅' : '❌'}</span><span>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '18px' }}>×</button>
    </div>
  )
}

// ── Contribute Modal ──────────────────────────────────────────
function ContributeModal({ asset, members, onClose, onSuccess }: any) {
  const [amount, setAmount]   = useState('')
  const [userId, setUserId]   = useState(members[0]?.id || '')
  const [method, setMethod]   = useState('ECOCASH')
  const [ref, setRef]         = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const remaining = asset.targetAmount - asset.raisedAmount

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || parseFloat(amount) <= 0) return setError('Enter a valid amount')
    if (!userId) return setError('Select a member')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/assets/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, userId, amount: parseFloat(amount), paymentMethod: method, paymentRef: ref }),
      })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error || 'Contribution failed')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '460px', boxShadow: '0 25px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: NAVY, margin: '0 0 4px' }}>Contribute to Asset</h3>
            <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>{asset.name}</p>
          </div>
          <button onClick={onClose} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '18px', color: '#64748B' }}>×</button>
        </div>

        {/* Asset funding status */}
        <div style={{ background: '#F0FDF4', borderRadius: '10px', padding: '14px', marginBottom: '20px', border: '1px solid #BBF7D0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#166534', marginBottom: '6px' }}>
            <span>Funding Progress</span>
            <span style={{ fontWeight: '700' }}>{asset.fundingProgress}% · ${asset.raisedAmount.toLocaleString()} of ${asset.targetAmount.toLocaleString()}</span>
          </div>
          <ProgressBar pct={asset.fundingProgress} height={10} />
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#166534' }}>
            Still needed: <strong>${remaining.toLocaleString()}</strong>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Member select */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Contributing Member *</label>
            <select value={userId} onChange={e => setUserId(e.target.value)} required
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: 'white', boxSizing: 'border-box' as any }}>
              <option value="">Select member...</option>
              {members.map((m: any) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
            </select>
          </div>

          {/* Amount */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Amount *</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748B' }}>$</span>
              <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required
                style={{ width: '100%', padding: '9px 12px 9px 26px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', fontWeight: '600', outline: 'none', boxSizing: 'border-box' as any }} />
            </div>
            {remaining > 0 && (
              <button type="button" onClick={() => setAmount(String(remaining))} style={{ marginTop: '4px', fontSize: '11px', color: TEAL, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Fill remaining: ${remaining.toFixed(2)}
              </button>
            )}
          </div>

          {/* Payment method */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Payment Method</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { value: 'ECOCASH',       label: '📱 EcoCash'      },
                { value: 'BANK_TRANSFER', label: '🏦 Bank Transfer' },
                { value: 'CARD',          label: '💳 Card'          },
                { value: 'CASH',          label: '💵 Cash'          },
              ].map(m => (
                <div key={m.value} onClick={() => setMethod(m.value)}
                  style={{ padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', border: `2px solid ${method === m.value ? TEAL : '#E2E8F0'}`, background: method === m.value ? '#F0FDF4' : 'white', fontSize: '12px', fontWeight: '500', color: NAVY }}>
                  {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* Reference */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Payment Reference <span style={{ color: '#94A3B8', fontWeight: '400' }}>(optional)</span></label>
            <input type="text" value={ref} onChange={e => setRef(e.target.value)} placeholder="EcoCash ref, bank ref..."
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any }} />
          </div>

          {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px', color: '#991B1B', fontSize: '12px', marginBottom: '14px' }}>❌ {error}</div>}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#475569' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ flex: 2, padding: '10px', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: saving ? 'not-allowed' : 'pointer', background: saving ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white' }}>
              {saving ? '⏳ Recording...' : `✓ Record Contribution`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Create Asset Form ─────────────────────────────────────────
function CreateAssetForm({ groups, onBack, onSuccess }: any) {
  const [form, setForm]       = useState(EMPTY_FORM)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const f = (k: string) => (v: string) => setForm(prev => ({ ...prev, [k]: v }))
  const selectedType = ASSET_TYPES.find(t => t.value === form.type)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.groupId)       return setError('Please select a group')
    if (!form.name.trim())   return setError('Asset name is required')
    if (!form.targetAmount)  return setError('Target funding amount is required')
    setSaving(true)
    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, targetAmount: parseFloat(form.targetAmount), year: form.year ? parseInt(form.year) : undefined }),
      })
      const data = await res.json()
      if (data.success) onSuccess(data.message)
      else setError(data.error || 'Failed to create asset')
    } catch { setError('Network error. Please try again.') }
    finally { setSaving(false) }
  }

  function Field({ label, k, type = 'text', placeholder = '', hint = '', required = false }: any) {
    return (
      <div style={{ marginBottom: '14px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>
          {label}{required && <span style={{ color: '#DC2626' }}> *</span>}
        </label>
        <input type={type} value={(form as any)[k]} onChange={e => f(k)(e.target.value)} placeholder={placeholder} required={required}
          style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any }} />
        {hint && <p style={{ fontSize: '11px', color: '#94A3B8', margin: '4px 0 0' }}>{hint}</p>}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '740px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <button onClick={onBack} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', color: '#475569' }}>← Back</button>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: NAVY, margin: '0 0 2px' }}>Create Asset Campaign</h2>
          <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>Set up a collective funding campaign for a high-value asset</p>
        </div>
      </div>

      {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', color: '#991B1B', fontSize: '13px' }}>❌ {error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Group selection */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>👥 Group & Campaign Basics</h3>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Group <span style={{ color: '#DC2626' }}>*</span></label>
            <select value={form.groupId} onChange={e => f('groupId')(e.target.value)} required
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: 'white', boxSizing: 'border-box' as any }}>
              <option value="">Select a group...</option>
              {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name} ({g.currency})</option>)}
            </select>
          </div>
          <Field label="Asset / Campaign Name" k="name" placeholder="e.g. Group Delivery Truck 2025" required />
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Description</label>
            <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Describe the asset and its intended use..." rows={3}
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any, resize: 'vertical' as any }} />
          </div>
        </div>

        {/* Asset type */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>🏷️ Asset Type</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {ASSET_TYPES.map(t => (
              <div key={t.value} onClick={() => f('type')(t.value)}
                style={{ padding: '12px 14px', borderRadius: '8px', cursor: 'pointer', border: `2px solid ${form.type === t.value ? TEAL : '#E2E8F0'}`, background: form.type === t.value ? '#F0FDF4' : 'white', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: `2px solid ${form.type === t.value ? TEAL : '#CBD5E1'}`, background: form.type === t.value ? TEAL : 'white', flexShrink: 0, marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {form.type === t.value && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'white' }} />}
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: NAVY }}>{t.label}</div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '1px' }}>{t.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Funding details */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>💰 Funding Target</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Target Amount" k="targetAmount" type="number" placeholder="50000" required hint="Total funding needed in group currency" />
            <Field label="Funding Deadline" k="fundingDeadline" type="date" hint="Optional — leave blank for open-ended" />
          </div>
          {form.targetAmount && (
            <div style={{ background: '#F0FDF4', borderRadius: '8px', padding: '12px 16px', border: '1px solid #BBF7D0' }}>
              <div style={{ fontSize: '12px', color: '#166534', fontWeight: '600', marginBottom: '4px' }}>📊 Campaign Preview</div>
              <div style={{ fontSize: '13px', color: '#166534' }}>
                Target: <strong>${parseFloat(form.targetAmount).toLocaleString()}</strong>
                {form.fundingDeadline && ` · Deadline: ${new Date(form.fundingDeadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </div>
            </div>
          )}
        </div>

        {/* Asset-specific details */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>
            {selectedType?.label} Details
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {['VEHICLE','AGRICULTURAL_MACHINERY','INDUSTRIAL_MACHINERY'].includes(form.type) && (
              <>
                <Field label="Make / Brand" k="make" placeholder="e.g. Toyota, John Deere" />
                <Field label="Model" k="model" placeholder="e.g. Hilux, 5055E" />
                <Field label="Year" k="year" type="number" placeholder="2024" />
                {form.type === 'VEHICLE' && <Field label="VIN Number" k="vin" placeholder="Vehicle Identification Number" />}
                {form.type !== 'VEHICLE' && <Field label="Serial Number" k="serialNumber" placeholder="Manufacturer serial number" />}
              </>
            )}
            {form.type === 'COMPUTER_EQUIPMENT' && (
              <>
                <Field label="Brand" k="make" placeholder="e.g. Dell, HP, Lenovo" />
                <Field label="Model / Spec" k="model" placeholder="e.g. Latitude 5540" />
                <Field label="Serial Number" k="serialNumber" placeholder="Device serial number" />
              </>
            )}
            {form.type === 'HOME' && (
              <>
                <Field label="Property Address" k="location" placeholder="Stand number, suburb, city" />
                <Field label="Municipality / Council" k="make" placeholder="e.g. Harare City Council" />
              </>
            )}
            <Field label="Physical Location" k="location" placeholder="Where will the asset be kept?" />
            <div style={{ gridColumn: '1 / -1', marginBottom: '0' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Notes</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Additional details about the asset..." rows={2}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any, resize: 'vertical' as any }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={onBack} style={{ padding: '11px 24px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', color: '#475569', fontWeight: '500' }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ flex: 1, padding: '11px', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: saving ? 'not-allowed' : 'pointer', background: saving ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white' }}>
            {saving ? '⏳ Creating campaign...' : '✓ Launch Asset Campaign'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Asset Detail View ─────────────────────────────────────────
function AssetDetail({ asset, members, onBack, onContribute, onSuccess }: any) {
  const [showContribute, setShowContribute] = useState(false)
  const typeInfo = ASSET_TYPES.find(t => t.value === asset.type)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {showContribute && (
        <ContributeModal asset={asset} members={members} onClose={() => setShowContribute(false)} onSuccess={(msg: string) => { onSuccess(msg); setShowContribute(false) }} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={onBack} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', color: '#475569' }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>{typeInfo?.label.split(' ')[0]}</span>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: NAVY, margin: 0 }}>{asset.name}</h2>
            <StatusBadge status={asset.status} />
          </div>
          <p style={{ fontSize: '12px', color: '#64748B', margin: '2px 0 0' }}>{asset.groupName} · {asset.type.replace(/_/g,' ')}</p>
        </div>
        {asset.status === 'FUNDING' && (
          <button onClick={() => setShowContribute(true)} style={{ padding: '9px 18px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
            💰 Contribute
          </button>
        )}
      </div>

      {/* Progress card — prominent for FUNDING assets */}
      {asset.status === 'FUNDING' && (
        <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, borderRadius: '16px', padding: '24px', color: 'white' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#9FE1CB', marginBottom: '4px' }}>Funding Progress</div>
              <div style={{ fontSize: '36px', fontWeight: '700' }}>{asset.fundingProgress}%</div>
              <div style={{ fontSize: '13px', color: '#9FE1CB', marginTop: '4px' }}>
                ${asset.raisedAmount.toLocaleString()} raised of ${asset.targetAmount.toLocaleString()}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: '#9FE1CB' }}>Still needed</div>
              <div style={{ fontSize: '24px', fontWeight: '700' }}>${(asset.targetAmount - asset.raisedAmount).toLocaleString()}</div>
              {asset.fundingDeadline && (
                <div style={{ fontSize: '11px', color: '#9FE1CB', marginTop: '4px' }}>
                  Deadline: {new Date(asset.fundingDeadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>
          </div>
          <div style={{ height: '12px', background: 'rgba(255,255,255,0.2)', borderRadius: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '6px', background: '#9FE1CB', width: `${Math.min(100, asset.fundingProgress)}%`, transition: 'width 0.6s' }} />
          </div>
          <div style={{ display: 'flex', gap: '20px', marginTop: '16px', fontSize: '12px', color: '#9FE1CB' }}>
            <span>{asset.ownerCount} contributors</span>
            <span>Target: ${asset.targetAmount.toLocaleString()}</span>
            <span>Currency: {asset.currency}</span>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: asset.status !== 'FUNDING' ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* Asset details */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px' }}>📋 Asset Details</h3>
          {[
            ['Description',   asset.description || 'No description'],
            ['Type',          asset.type.replace(/_/g,' ')],
            ['Make / Brand',  asset.make || '—'],
            ['Model',         asset.model || '—'],
            ['Year',          asset.year || '—'],
            ['Serial / VIN',  asset.vin || asset.serialNumber || '—'],
            ['Location',      asset.location || '—'],
            ['Target Amount', `$${asset.targetAmount.toLocaleString()}`],
            ['Raised Amount', `$${asset.raisedAmount.toLocaleString()}`],
            ['Acquired Date', asset.acquiredAt ? new Date(asset.acquiredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'],
            ['Notes',         asset.notes || '—'],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F8FAFC', fontSize: '13px' }}>
              <span style={{ color: '#64748B' }}>{label}</span>
              <span style={{ color: NAVY, fontWeight: '500', maxWidth: '60%', textAlign: 'right' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Acquired asset extra stats */}
        {asset.status !== 'FUNDING' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {[
                { icon: '💰', label: 'Acquisition Cost', value: `$${asset.acquisitionCost.toLocaleString()}`, color: TEAL  },
                { icon: '📈', label: 'Current Value',    value: asset.currentValue > 0 ? `$${asset.currentValue.toLocaleString()}` : 'Not valued', color: BLUE  },
                { icon: '💵', label: 'Income Generated', value: `$${asset.incomeGenerated.toLocaleString()}`, color: '#166534' },
                { icon: '👥', label: 'Co-owners',        value: asset.ownerCount,                            color: NAVY  },
              ].map(s => (
                <div key={s.label} style={{ background: 'white', borderRadius: '10px', padding: '14px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '18px', marginBottom: '6px' }}>{s.icon}</div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>{s.label}</div>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: s.color, marginTop: '2px' }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Ownership table */}
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: 0 }}>🏦 Ownership Stakes</h3>
          <span style={{ fontSize: '12px', color: '#64748B' }}>{asset.ownerCount} co-owners</span>
        </div>
        {asset.ownerships.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>
            No contributions yet. Be the first to contribute!
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Member','Amount Contributed','Ownership %','Share Value','Since'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#64748B', borderBottom: '1px solid #E2E8F0', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {asset.ownerships.sort((a: any, b: any) => b.ownershipPct - a.ownershipPct).map((o: any, i: number) => (
                <tr key={o.userId} style={{ borderBottom: '1px solid #F8FAFC', background: i % 2 === 0 ? 'white' : '#FAFAFA' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#E1F5EE', color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '700', flexShrink: 0 }}>
                        {o.memberName.split(' ').map((n: string) => n[0]).join('').slice(0,2)}
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: '500', color: NAVY }}>{o.memberName}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: '600', color: TEAL }}>${o.amountContributed.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, height: '6px', background: '#F1F5F9', borderRadius: '3px', overflow: 'hidden', minWidth: '60px' }}>
                        <div style={{ height: '100%', background: TEAL, borderRadius: '3px', width: `${o.ownershipPct}%` }} />
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: NAVY, minWidth: '40px' }}>{o.ownershipPct.toFixed(2)}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '13px', color: '#475569' }}>
                    ${(asset.acquisitionCost > 0 ? asset.acquisitionCost * o.ownershipPct / 100 : asset.raisedAmount * o.ownershipPct / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '12px', color: '#94A3B8' }}>
                    {new Date(o.acquiredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function AssetsPage() {
  const [view, setView]           = useState<'list'|'create'|'detail'>('list')
  const [assets, setAssets]       = useState<any[]>([])
  const [groups, setGroups]       = useState<any[]>([])
  const [members, setMembers]     = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<any>(null)
  const [toast, setToast]         = useState<any>(null)
  const [search, setSearch]       = useState('')
  const [filterType, setFilterType]   = useState('ALL')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [contributeAsset, setContributeAsset] = useState<any>(null)

  function showToast(msg: string, type: 'success'|'error' = 'success') {
    setToast({ msg, type })
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [aRes, gRes] = await Promise.all([
        fetch('/api/assets'),
        fetch('/api/groups'),
      ])
      const [aData, gData] = await Promise.all([aRes.json(), gRes.json()])
      if (aData.success) setAssets(aData.data)
      if (gData.success) setGroups(gData.data)

      // Fetch members from all groups for contribute modal
      if (gData.success && gData.data.length > 0) {
        try {
          const mRes = await fetch('/api/members')
          const mData = await mRes.json()
          if (mData.success) setMembers(mData.data)
        } catch { /* members optional */ }
      }
    } catch { showToast('Failed to load data', 'error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filtered = assets.filter(a => {
    const ms = a.name.toLowerCase().includes(search.toLowerCase()) || a.groupName.toLowerCase().includes(search.toLowerCase())
    const mt = filterType === 'ALL' || a.type === filterType
    const mst = filterStatus === 'ALL' || a.status === filterStatus
    return ms && mt && mst
  })

  // Stats
  const totalTarget  = assets.reduce((s, a) => s + a.targetAmount, 0)
  const totalRaised  = assets.reduce((s, a) => s + a.raisedAmount, 0)
  const funding      = assets.filter(a => a.status === 'FUNDING').length
  const acquired     = assets.filter(a => ['ACQUIRED','ACTIVE'].includes(a.status)).length

  if (view === 'create') return (
    <CreateAssetForm groups={groups} onBack={() => setView('list')}
      onSuccess={(msg: string) => { showToast(msg); setView('list'); fetchAll() }} />
  )

  if (view === 'detail' && selected) return (
    <AssetDetail asset={selected} members={members}
      onBack={() => setView('list')}
      onContribute={() => setContributeAsset(selected)}
      onSuccess={(msg: string) => { showToast(msg); fetchAll()
        // Refresh selected asset
        fetch('/api/assets').then(r=>r.json()).then(d=>{ if(d.success){ const a=d.data.find((x:any)=>x.id===selected.id); if(a) setSelected(a) }})
      }} />
  )

  // ── LIST VIEW ───────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {contributeAsset && (
        <ContributeModal asset={contributeAsset} members={members}
          onClose={() => setContributeAsset(null)}
          onSuccess={(msg: string) => { showToast(msg); fetchAll(); setContributeAsset(null) }} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: NAVY, margin: '0 0 4px' }}>Asset Acquisition</h2>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Collectively fund and track ownership of high-value assets</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={fetchAll} style={{ padding: '8px 14px', background: '#F1F5F9', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: '#475569' }}>↻ Refresh</button>
          <button onClick={() => setView('create')} style={{ padding: '10px 18px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>+ New Campaign</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <StatCard icon="📣" label="Active Campaigns"  value={funding}                               sub="Currently funding"     color={BLUE}     />
        <StatCard icon="✅" label="Assets Acquired"   value={acquired}                              sub="Owned by group"        color={TEAL}     />
        <StatCard icon="🎯" label="Total Target"      value={`$${totalTarget.toLocaleString()}`}    sub="Across all campaigns"  color={NAVY}     />
        <StatCard icon="💰" label="Total Raised"      value={`$${totalRaised.toLocaleString()}`}   sub={`${totalTarget > 0 ? Math.round(totalRaised/totalTarget*100) : 0}% of target`} color="#166534" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 14px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', width: '220px', outline: 'none' }} />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: '8px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: 'white' }}>
          <option value="ALL">All Types</option>
          {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {['ALL','FUNDING','ACQUIRED','ACTIVE','DISPOSED'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{
            padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: '500', cursor: 'pointer',
            background: filterStatus === s ? TEAL : 'white',
            color: filterStatus === s ? 'white' : '#64748B',
            border: filterStatus === s ? 'none' : '1.5px solid #E2E8F0',
          }}>{s}</button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '60px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          <p style={{ color: '#64748B' }}>Loading assets...</p>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '60px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🏗️</div>
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: NAVY, margin: '0 0 8px' }}>
            {search || filterType !== 'ALL' || filterStatus !== 'ALL' ? 'No assets match your filter' : 'No asset campaigns yet'}
          </h3>
          <p style={{ color: '#64748B', fontSize: '13px', marginBottom: '20px' }}>
            {!search && filterType === 'ALL' && filterStatus === 'ALL' && 'Start a campaign to collectively fund a vehicle, machinery, or property.'}
          </p>
          {!search && filterType === 'ALL' && filterStatus === 'ALL' && (
            <button onClick={() => setView('create')} style={{ padding: '10px 20px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
              + Launch First Campaign
            </button>
          )}
        </div>
      )}

      {/* Asset cards */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {filtered.map(a => {
            const typeInfo = ASSET_TYPES.find(t => t.value === a.type)
            return (
              <div key={a.id} style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                {/* Card header */}
                <div style={{ background: a.status === 'FUNDING' ? `linear-gradient(135deg, ${NAVY}, #1A5EA8)` : a.status === 'ACQUIRED' || a.status === 'ACTIVE' ? `linear-gradient(135deg, ${NAVY}, ${TEAL})` : '#F8FAFC', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <span style={{ fontSize: '28px' }}>{typeInfo?.label.split(' ')[0]}</span>
                    <StatusBadge status={a.status} />
                  </div>
                  <h3 style={{ fontSize: '14px', fontWeight: '700', color: ['FUNDING','ACQUIRED','ACTIVE'].includes(a.status) ? 'white' : NAVY, margin: '0 0 2px' }}>{a.name}</h3>
                  <p style={{ fontSize: '11px', color: ['FUNDING','ACQUIRED','ACTIVE'].includes(a.status) ? '#9FE1CB' : '#94A3B8', margin: 0 }}>{a.groupName}</p>
                </div>

                {/* Card body */}
                <div style={{ padding: '14px 16px' }}>
                  {/* Funding progress */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '5px' }}>
                      <span style={{ color: '#64748B' }}>${a.raisedAmount.toLocaleString()} raised</span>
                      <span style={{ fontWeight: '700', color: a.fundingProgress >= 100 ? '#166534' : NAVY }}>{a.fundingProgress}%</span>
                    </div>
                    <ProgressBar pct={a.fundingProgress} />
                    <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '3px' }}>Target: ${a.targetAmount.toLocaleString()}</div>
                  </div>

                  {/* Meta grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '12px' }}>
                    {[
                      { label: 'Type',       value: a.type.replace(/_/g,' ')         },
                      { label: 'Co-owners',  value: `${a.ownerCount} members`        },
                      { label: 'Currency',   value: a.currency                       },
                      { label: 'Income',     value: `$${a.incomeGenerated.toFixed(0)}` },
                    ].map(item => (
                      <div key={item.label} style={{ background: '#F8FAFC', borderRadius: '6px', padding: '6px 8px' }}>
                        <div style={{ fontSize: '9px', color: '#94A3B8', textTransform: 'uppercase' }}>{item.label}</div>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: NAVY }}>{item.value}</div>
                      </div>
                    ))}
                  </div>

                  {a.fundingDeadline && (
                    <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '10px' }}>
                      ⏰ Deadline: {new Date(a.fundingDeadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => { setSelected(a); setView('detail') }}
                      style={{ flex: 1, padding: '8px', background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', color: NAVY }}>
                      View Details →
                    </button>
                    {a.status === 'FUNDING' && (
                      <button onClick={() => setContributeAsset(a)}
                        style={{ padding: '8px 12px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                        💰
                      </button>
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
