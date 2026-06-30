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
  groupId: '', name: '', description: '', type: 'VEHICLE', memberIds: [] as string[],
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
// Field is defined OUTSIDE CreateAssetForm to prevent remount on every keystroke
function Field({ label, k, type, placeholder, hint, required, form, setField }: any) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
        {label}{required && <span style={{ color:'#DC2626' }}> *</span>}
      </label>
      <input type={type||'text'} value={form[k]||''} onChange={e => setField(k, e.target.value)}
        placeholder={placeholder||''} required={!!required}
        style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }}/>
      {hint && <p style={{ fontSize:'11px', color:'#94A3B8', margin:'4px 0 0' }}>{hint}</p>}
    </div>
  )
}

function CreateAssetForm({ groups, groupMembers, onBack, onSuccess, defaultGroupId, fetchMembers }: any) {
  const [form, setForm]       = useState({ ...EMPTY_FORM, groupId: defaultGroupId || '' })
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const f = (k: string) => (v: string) => setForm(prev => ({ ...prev, [k]: v }))
  const setField = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))
  const selectedType = ASSET_TYPES.find(t => t.value === form.type)

  // Fetch members as soon as the form opens (guard inside fetchMembers — runs once per session)
  useEffect(() => { if (fetchMembers) fetchMembers() }, [])

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
        body: JSON.stringify({ ...form, targetAmount: parseFloat(form.targetAmount), year: form.year ? parseInt(form.year) : undefined, memberIds: form.memberIds }),
      })
      const data = await res.json()
      if (data.success) onSuccess(data.message)
      else setError(data.error || 'Failed to create asset')
    } catch { setError('Network error. Please try again.') }
    finally { setSaving(false) }
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
          {!defaultGroupId && (
            <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Group <span style={{ color: '#DC2626' }}>*</span></label>
            <select value={form.groupId} onChange={e => f('groupId')(e.target.value)} required
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: 'white', boxSizing: 'border-box' as any }}>
              <option value="">Select a group...</option>
              {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name} ({g.currency})</option>)}
            </select>
          </div>
            )}
          <Field label="Asset / Campaign Name" k="name" placeholder="e.g. Group Delivery Truck 2025" required form={form} setField={setField} />
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
            <Field label="Target Amount" k="targetAmount" type="number" placeholder="50000" required hint="Total funding needed in group currency" form={form} setField={setField} />
            <Field label="Funding Deadline" k="fundingDeadline" type="date" hint="Optional — leave blank for open-ended" form={form} setField={setField} />
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
                <Field label="Make / Brand" k="make" placeholder="e.g. Toyota, John Deere" form={form} setField={setField} />
                <Field label="Model" k="model" placeholder="e.g. Hilux, 5055E" form={form} setField={setField} />
                <Field label="Year" k="year" type="number" placeholder="2024" form={form} setField={setField} />
                {form.type === 'VEHICLE' && <Field label="VIN Number" k="vin" placeholder="Vehicle Identification Number" form={form} setField={setField} />}
                {form.type !== 'VEHICLE' && <Field label="Serial Number" k="serialNumber" placeholder="Manufacturer serial number" form={form} setField={setField} />}
              </>
            )}
            {form.type === 'COMPUTER_EQUIPMENT' && (
              <>
                <Field label="Brand" k="make" placeholder="e.g. Dell, HP, Lenovo" form={form} setField={setField} />
                <Field label="Model / Spec" k="model" placeholder="e.g. Latitude 5540" form={form} setField={setField} />
                <Field label="Serial Number" k="serialNumber" placeholder="Device serial number" form={form} setField={setField} />
              </>
            )}
            {form.type === 'HOME' && (
              <>
                <Field label="Property Address" k="location" placeholder="Stand number, suburb, city" form={form} setField={setField} />
                <Field label="Municipality / Council" k="make" placeholder="e.g. Harare City Council" form={form} setField={setField} />
              </>
            )}
            <Field label="Physical Location" k="location" placeholder="Where will the asset be kept?" form={form} setField={setField} />
            <div style={{ gridColumn: '1 / -1', marginBottom: '0' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Notes</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Additional details about the asset..." rows={2}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any, resize: 'vertical' as any }} />
            </div>
          </div>
        </div>

        {/* ── Member selection ── */}
        {groupMembers && groupMembers.length > 0 && (
          <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px', marginBottom:'16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px', paddingBottom:'10px', borderBottom:'1px solid #F1F5F9' }}>
              <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:0 }}>👥 Participating Members</h3>
              <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                <span style={{ fontSize:'12px', color:'#64748B' }}>{form.memberIds.length} selected</span>
                <button type="button"
                  onClick={() => setForm(p => ({ ...p, memberIds:
                    p.memberIds.length === groupMembers.length ? [] : groupMembers.map((m:any) => m.userId||m.id)
                  }))}
                  style={{ fontSize:'11px', color:TEAL, background:'none', border:'none', cursor:'pointer', fontWeight:'600', padding:'2px 8px', borderRadius:'4px', background:'#F0FDF4' }}>
                  {form.memberIds.length === groupMembers.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            </div>
            <p style={{ fontSize:'12px', color:'#64748B', margin:'0 0 10px' }}>
              Choose which group members will participate in this asset campaign. Selected members can contribute and share ownership.
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px', maxHeight:'160px', overflowY:'auto', border:'1.5px solid #E2E8F0', borderRadius:'8px', padding:'8px' }}>
              {groupMembers.map((m: any) => {
                const uid = m.userId||m.id
                const sel = form.memberIds.includes(uid)
                return (
                  <div key={uid}
                    onClick={() => setForm(p => ({ ...p, memberIds: sel ? p.memberIds.filter((id:string)=>id!==uid) : [...p.memberIds, uid] }))}
                    style={{ display:'flex', alignItems:'center', gap:'10px', padding:'7px 10px', borderRadius:'6px', cursor:'pointer',
                      background: sel ? '#F0FDF4' : 'white', border:`1px solid ${sel ? TEAL : 'transparent'}`, transition:'all 0.1s' }}>
                    <div style={{ width:'18px', height:'18px', borderRadius:'4px', border:`2px solid ${sel?TEAL:'#CBD5E1'}`, background:sel?TEAL:'white',
                      display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all 0.1s' }}>
                      {sel && <span style={{ color:'white', fontSize:'11px', fontWeight:'700', lineHeight:1 }}>✓</span>}
                    </div>
                    <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:'#E1F5EE', color:TEAL,
                      display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'700', flexShrink:0 }}>
                      {(m.fullName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:'13px', fontWeight:'500', color:NAVY }}>{m.fullName}</div>
                      <div style={{ fontSize:'11px', color:'#94A3B8' }}>{m.email}</div>
                    </div>
                    {sel && <span style={{ fontSize:'11px', color:TEAL, fontWeight:'600' }}>✓ Participating</span>}
                  </div>
                )
              })}
            </div>
            {form.memberIds.length === 0 && (
              <div style={{ marginTop:'8px', padding:'8px 12px', background:'#FEF9C3', borderRadius:'6px', fontSize:'12px', color:'#854D0E', border:'1px solid #FCD34D' }}>
                ⚠️ No members selected — all group members will be eligible to contribute by default.
              </div>
            )}
          </div>
        )}

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
const PURPLE = '#7C3AED'
const fmt = (n: number) => new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0)

function AssetDetail({ asset, members, groupMembers, onBack, onSuccess, fetchMembers }: any) {
  const [tab, setTab]                     = useState<'dashboard'|'contributions'|'members'|'settings'>('dashboard')
  const [showContribute, setShowContribute] = useState(false)
  const typeInfo  = ASSET_TYPES.find(t => t.value === asset.type)
  const fundPct   = Math.min(100, Number(asset.fundingProgress)||0)
  const ownerships  = asset.ownerships || []
  const enrolledIds = ownerships.map((o:any) => o.userId)
  const nonPartic   = (groupMembers||[]).filter((m:any) => !enrolledIds.includes(m.userId||m.id))

  // Fetch members when detail opens so Members tab is populated
  useEffect(() => { if (fetchMembers) fetchMembers() }, [])

  const TABS = [
    { id:'dashboard',     label:'📊 Dashboard'    },
    { id:'contributions', label:'💰 Contributions' },
    { id:'members',       label:'👥 Members'       },
    { id:'settings',      label:'⚙️ Settings'      },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0', borderRadius:'16px', overflow:'hidden', boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>
      {showContribute && (
        <ContributeModal asset={asset} members={members}
          onClose={() => setShowContribute(false)}
          onSuccess={(msg:string) => { onSuccess(msg); setShowContribute(false) }}/>
      )}

      {/* ── Header ── */}
      <div style={{ background:`linear-gradient(135deg,${NAVY} 0%,#1E3A5F 100%)`, padding:'22px 24px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:'12px' }}>
          <div style={{ width:'48px', height:'48px', borderRadius:'12px', background:'rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'24px', flexShrink:0 }}>
            🏗️
          </div>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'4px' }}>
              <span style={{ fontSize:'17px', fontWeight:'700', color:'white' }}>{asset.name}</span>
              <StatusBadge status={asset.status}/>
            </div>
            <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.6)' }}>
              {asset.groupName} · {(asset.type||'').replace(/_/g,' ')} · {asset.ownerCount} co-owner{asset.ownerCount!==1?'s':''}
            </div>
          </div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center', flexShrink:0 }}>
            {asset.status === 'FUNDING' && (
              <button onClick={() => setShowContribute(true)}
                style={{ padding:'8px 16px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
                💰 Contribute
              </button>
            )}
            <button onClick={onBack}
              style={{ padding:'8px 14px', background:'rgba(255,255,255,0.15)', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer' }}>
              ← Back
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px', marginTop:'16px', paddingTop:'14px', borderTop:'1px solid rgba(255,255,255,0.1)' }}>
          {[
            { l:'Target',       v:`$${fmt(asset.targetAmount)}` },
            { l:'Raised',       v:`$${fmt(asset.raisedAmount)}` },
            { l:'Still Needed', v:`$${fmt(Math.max(0,asset.targetAmount-asset.raisedAmount))}` },
            { l:'Co-owners',    v: String(asset.ownerCount) },
            { l:'Progress',     v:`${fundPct.toFixed(0)}%` },
          ].map(s => (
            <div key={s.l}>
              <div style={{ fontSize:'9px', color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'2px' }}>{s.l}</div>
              <div style={{ fontSize:'16px', fontWeight:'700', color:'white' }}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        {asset.status === 'FUNDING' && (
          <div style={{ marginTop:'12px' }}>
            <div style={{ height:'8px', background:'rgba(255,255,255,0.15)', borderRadius:'4px', overflow:'hidden' }}>
              <div style={{ height:'100%', borderRadius:'4px', background:'#9FE1CB', width:`${fundPct}%`, transition:'width 0.6s' }}/>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'rgba(255,255,255,0.5)', marginTop:'4px' }}>
              <span>${fmt(asset.raisedAmount)} raised</span>
              <span>Target: ${fmt(asset.targetAmount)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Tab nav ── */}
      <div style={{ display:'flex', background:'white', borderBottom:'1px solid #E2E8F0' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{ padding:'11px 18px', background:'none', border:'none',
              borderBottom: tab===t.id ? `2px solid ${TEAL}` : '2px solid transparent',
              color: tab===t.id ? TEAL : '#64748B',
              fontWeight: tab===t.id ? '600' : '400',
              fontSize:'13px', cursor:'pointer', marginBottom:'-1px', whiteSpace:'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div style={{ background:'#F8FAFC', padding:'16px', minHeight:'320px' }}>

        {/* DASHBOARD */}
        {tab === 'dashboard' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>

            {/* Checklist */}
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'12px' }}>
                <span style={{ fontSize:'16px' }}>📋</span>
                <span style={{ fontSize:'13px', fontWeight:'600', color:NAVY }}>
                  {asset.status === 'FUNDING' ? 'Funding Progress' : 'Asset Summary'}
                </span>
              </div>
              {[
                [true,                 'Asset campaign created'],
                [asset.ownerCount > 0, `${asset.ownerCount} member${asset.ownerCount!==1?'s':''} contributed`],
                [fundPct >= 100,       'Funding target reached'],
                [asset.status === 'ACQUIRED' || asset.status === 'IN_USE', 'Asset acquired'],
              ].map(([done, label], i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px', fontSize:'13px', color:done?'#166534':'#94A3B8', marginBottom:'6px' }}>
                  <span style={{ fontSize:'16px' }}>{done ? '✅' : '⬜'}</span>
                  <span>{label as string}</span>
                </div>
              ))}
              {fundPct >= 100 && asset.status === 'FUNDING' && (
                <div style={{ marginTop:'10px', padding:'10px 14px', background:'#DCFCE7', borderRadius:'8px', fontSize:'12px', color:'#166534', fontWeight:'500' }}>
                  🎉 Fully funded! Update status to Acquired in Settings once the asset is purchased.
                </div>
              )}
            </div>

            {/* Stats */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
              {[
                { icon:'💰', label:'Amount Raised',    value:`$${fmt(asset.raisedAmount)}`,                                             color:'#166534', bg:'#F0FDF4' },
                { icon:'🎯', label:'Funding Target',   value:`$${fmt(asset.targetAmount)}`,                                             color:TEAL,      bg:'#ECFDF5' },
                { icon:'📈', label:'Current Value',    value: asset.currentValue > 0 ? `$${fmt(asset.currentValue)}` : 'Not valued',    color:PURPLE,    bg:'#F5F3FF' },
                { icon:'💵', label:'Income Generated', value:`$${fmt(asset.incomeGenerated)}`,                                          color:'#854D0E', bg:'#FEF9C3' },
              ].map(c => (
                <div key={c.label} style={{ background:c.bg, borderRadius:'12px', padding:'16px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px' }}>
                    <span style={{ fontSize:'20px' }}>{c.icon}</span>
                    <span style={{ fontSize:'12px', color:'#64748B' }}>{c.label}</span>
                  </div>
                  <div style={{ fontSize:'22px', fontWeight:'800', color:c.color }}>{c.value}</div>
                </div>
              ))}
            </div>

            {/* Detail rows */}
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'16px' }}>
              <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY, marginBottom:'12px' }}>📋 Asset Details</div>
              {[
                ['Type',          (asset.type||'').replace(/_/g,' ')],
                ['Make / Brand',  asset.make   || '—'],
                ['Model',         asset.model  || '—'],
                ['Year',          asset.year   || '—'],
                ['Serial / VIN',  asset.vin || asset.serialNumber || '—'],
                ['Location',      asset.location || '—'],
                ['Deadline',      asset.fundingDeadline ? new Date(asset.fundingDeadline).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'],
                ['Description',   asset.description || '—'],
                ['Notes',         asset.notes  || '—'],
              ].map(([l,v]) => (
                <div key={l} style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:'8px', padding:'7px 0', borderBottom:'1px solid #F8FAFC', fontSize:'13px' }}>
                  <span style={{ color:'#64748B', fontSize:'12px' }}>{l}</span>
                  <span style={{ color:NAVY, fontWeight:'500' }}>: &nbsp;{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONTRIBUTIONS */}
        {tab === 'contributions' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'13px', fontWeight:'600', color:NAVY }}>
                {ownerships.length} contribution{ownerships.length!==1?'s':''}
              </span>
              {asset.status === 'FUNDING' && (
                <button onClick={() => setShowContribute(true)}
                  style={{ padding:'7px 14px', background:TEAL, color:'white', border:'none', borderRadius:'7px', fontSize:'12px', fontWeight:'600', cursor:'pointer' }}>
                  + Add Contribution
                </button>
              )}
            </div>
            {ownerships.length === 0 ? (
              <div style={{ background:'white', borderRadius:'12px', border:'1.5px dashed #E2E8F0', padding:'48px', textAlign:'center' }}>
                <div style={{ fontSize:'40px', marginBottom:'10px' }}>💰</div>
                <h4 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 6px' }}>No contributions yet</h4>
                <p style={{ fontSize:'13px', color:'#64748B', margin:'0 0 14px' }}>Be the first to contribute to this asset campaign.</p>
                {asset.status === 'FUNDING' && (
                  <button onClick={() => setShowContribute(true)}
                    style={{ padding:'9px 20px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
                    💰 Contribute Now
                  </button>
                )}
              </div>
            ) : (
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ background:'#F8FAFC' }}>
                      {['Member','Amount','Ownership %','Share Value','Since'].map(h => (
                        <th key={h} style={{ padding:'9px 14px', textAlign:'left', fontSize:'10px', fontWeight:'600', color:'#64748B', borderBottom:'1px solid #E2E8F0', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...ownerships].sort((a:any,b:any) => b.ownershipPct-a.ownershipPct).map((o:any,i:number) => (
                      <tr key={o.userId} style={{ borderBottom:'1px solid #F8FAFC', background:i%2===0?'white':'#FAFAFA' }}>
                        <td style={{ padding:'10px 14px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                            <div style={{ width:'30px', height:'30px', borderRadius:'50%', background:'#E1F5EE', color:TEAL, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'700', flexShrink:0 }}>
                              {(o.memberName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                            </div>
                            <span style={{ fontSize:'13px', fontWeight:'500', color:NAVY }}>{o.memberName}</span>
                          </div>
                        </td>
                        <td style={{ padding:'10px 14px', fontSize:'13px', fontWeight:'600', color:TEAL }}>${fmt(o.amountContributed)}</td>
                        <td style={{ padding:'10px 14px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                            <div style={{ width:'50px', height:'5px', background:'#F1F5F9', borderRadius:'3px', overflow:'hidden' }}>
                              <div style={{ height:'100%', background:TEAL, borderRadius:'3px', width:`${Number(o.ownershipPct)}%` }}/>
                            </div>
                            <span style={{ fontSize:'13px', fontWeight:'700', color:NAVY }}>{Number(o.ownershipPct).toFixed(2)}%</span>
                          </div>
                        </td>
                        <td style={{ padding:'10px 14px', fontSize:'13px', color:'#475569' }}>
                          ${fmt((asset.acquisitionCost>0?asset.acquisitionCost:asset.raisedAmount)*Number(o.ownershipPct)/100)}
                        </td>
                        <td style={{ padding:'10px 14px', fontSize:'12px', color:'#94A3B8' }}>
                          {new Date(o.acquiredAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'})}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'#F8FAFC', borderTop:'2px solid #E2E8F0' }}>
                      <td style={{ padding:'10px 14px', fontSize:'12px', color:'#64748B', fontWeight:'600' }}>Total</td>
                      <td style={{ padding:'10px 14px', fontSize:'13px', fontWeight:'700', color:TEAL }}>${fmt(asset.raisedAmount)}</td>
                      <td style={{ padding:'10px 14px', fontSize:'13px', fontWeight:'700', color:NAVY }}>100%</td>
                      <td colSpan={2}/>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* MEMBERS */}
        {tab === 'members' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <span style={{ fontSize:'14px', fontWeight:'700', color:NAVY }}>{enrolledIds.length} participating</span>
                {nonPartic.length > 0 && (
                  <span style={{ marginLeft:'10px', fontSize:'12px', color:'#64748B' }}>{nonPartic.length} not yet involved</span>
                )}
              </div>
              {asset.status === 'FUNDING' && (
                <button onClick={() => setShowContribute(true)}
                  style={{ padding:'7px 14px', background:TEAL, color:'white', border:'none', borderRadius:'7px', fontSize:'12px', fontWeight:'600', cursor:'pointer' }}>
                  + Contribute
                </button>
              )}
            </div>

            {/* Participating */}
            {enrolledIds.length === 0 ? (
              <div style={{ background:'white', borderRadius:'12px', border:'1.5px dashed #E2E8F0', padding:'40px', textAlign:'center' }}>
                <div style={{ fontSize:'36px', marginBottom:'10px' }}>👥</div>
                <h4 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 6px' }}>No members participating yet</h4>
                <p style={{ fontSize:'13px', color:'#64748B', margin:0 }}>Members join by making a contribution to the asset campaign.</p>
              </div>
            ) : (
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1px solid #F1F5F9', fontSize:'12px', fontWeight:'600', color:'#166534' }}>
                  ✅ Participating ({enrolledIds.length})
                </div>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ background:'#F8FAFC' }}>
                      {['Member','Contributed','Ownership %','Share Value'].map(h => (
                        <th key={h} style={{ padding:'8px 14px', textAlign:'left', fontSize:'10px', fontWeight:'600', color:'#64748B', borderBottom:'1px solid #E2E8F0', textTransform:'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...ownerships].sort((a:any,b:any) => b.amountContributed-a.amountContributed).map((o:any,i:number) => (
                      <tr key={o.userId} style={{ borderBottom:'1px solid #F8FAFC', background:i%2===0?'white':'#FAFAFA' }}>
                        <td style={{ padding:'10px 14px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                            <div style={{ width:'30px', height:'30px', borderRadius:'50%', background:'#E1F5EE', color:TEAL, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'700' }}>
                              {(o.memberName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                            </div>
                            <span style={{ fontSize:'13px', fontWeight:'500', color:NAVY }}>{o.memberName}</span>
                          </div>
                        </td>
                        <td style={{ padding:'10px 14px', fontSize:'13px', fontWeight:'600', color:TEAL }}>${fmt(o.amountContributed)}</td>
                        <td style={{ padding:'10px 14px', fontSize:'13px', fontWeight:'700', color:NAVY }}>{Number(o.ownershipPct).toFixed(2)}%</td>
                        <td style={{ padding:'10px 14px', fontSize:'13px', color:'#475569' }}>
                          ${fmt((asset.acquisitionCost>0?asset.acquisitionCost:asset.raisedAmount)*Number(o.ownershipPct)/100)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Not yet participating */}
            {nonPartic.length > 0 && (
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1px solid #F1F5F9', fontSize:'12px', fontWeight:'600', color:'#64748B' }}>
                  ⏳ Not yet participating ({nonPartic.length})
                </div>
                <div style={{ padding:'8px' }}>
                  {nonPartic.map((m:any) => (
                    <div key={m.userId||m.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 10px', borderRadius:'6px' }}>
                      <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:'#F1F5F9', color:'#94A3B8', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'700' }}>
                        {(m.fullName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:'13px', color:NAVY }}>{m.fullName}</div>
                        <div style={{ fontSize:'11px', color:'#94A3B8' }}>{m.email}</div>
                      </div>
                      {asset.status === 'FUNDING' && (
                        <span style={{ fontSize:'11px', color:'#94A3B8', fontStyle:'italic' }}>Can contribute →</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SETTINGS */}
        {tab === 'settings' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'16px' }}>
              <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY, marginBottom:'12px' }}>📋 Asset Information</div>
              {[
                ['Asset Name',   asset.name],
                ['Type',         (asset.type||'').replace(/_/g,' ')],
                ['Group',        asset.groupName],
                ['Target',       `$${fmt(asset.targetAmount)}`],
                ['Status',       asset.status],
              ].map(([l,v]) => (
                <div key={l} style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:'8px', padding:'7px 0', borderBottom:'1px solid #F8FAFC', fontSize:'13px' }}>
                  <span style={{ color:'#64748B', fontSize:'12px' }}>{l}</span>
                  <span style={{ color:NAVY, fontWeight:'500' }}>: &nbsp;{v}</span>
                </div>
              ))}
            </div>
            <div style={{ background:'white', borderRadius:'12px', border:'1.5px solid #FECACA', padding:'16px' }}>
              <div style={{ fontSize:'13px', fontWeight:'600', color:'#991B1B', marginBottom:'8px' }}>⚠️ Status Lifecycle</div>
              <p style={{ fontSize:'12px', color:'#64748B', margin:'0 0 12px' }}>Contact the group admin to update the asset status.</p>
              <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
                {['FUNDING','ACQUIRED','IN_USE','MAINTENANCE','DISPOSED'].map(s => (
                  <span key={s} style={{ padding:'4px 10px', borderRadius:'6px', fontSize:'11px', fontWeight:'600',
                    background: asset.status===s ? '#166534' : '#F1F5F9',
                    color: asset.status===s ? 'white' : '#475569' }}>
                    {asset.status===s ? '✓ ' : ''}{s.replace(/_/g,' ')}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function AssetsPage({ groupId: propGroupId }: { groupId?: string }) {
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
      const aUrl = propGroupId ? `/api/assets?groupId=${propGroupId}` : '/api/assets'
      const [aRes, gRes] = await Promise.all([fetch(aUrl), fetch('/api/groups')])
      const [aData, gData] = await Promise.all([aRes.json(), gRes.json()])
      if (aData.success) setAssets(aData.data)
      if (gData.success) setGroups(gData.data)
    } catch { showToast('Failed to load data', 'error') }
    finally { setLoading(false) }
  }, [propGroupId])

  // Fetch members lazily — runs when create form opens OR contribute modal opens
  const fetchMembers = useCallback(async () => {
    if (members.length > 0) return
    try {
      const groupsToFetch = propGroupId
        ? groups.filter((g: any) => g.id === propGroupId)
        : groups
      if (groupsToFetch.length === 0) return
      const results = await Promise.all(
        groupsToFetch.map((g: any) =>
          fetch(`/api/members?groupId=${g.id}`)
            .then(r => r.json())
            .then(d => (d.success ? (d.data || []).map((m: any) => ({ ...m, groupId: g.id, userId: m.userId || m.id })) : []))
            .catch(() => [])
        )
      )
      setMembers(results.flat())
    } catch {}
  }, [propGroupId, groups, members.length])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filtered = assets.filter(a => {
    const ms  = a.name.toLowerCase().includes(search.toLowerCase()) || (a.groupName||'').toLowerCase().includes(search.toLowerCase())
    const mt  = filterType === 'ALL' || a.type === filterType
    const mst = filterStatus === 'ALL' || a.status === filterStatus
    const mg  = propGroupId ? a.groupId === propGroupId : true
    return ms && mt && mst && mg
  })

  // Stats
  const totalTarget  = assets.reduce((s, a) => s + a.targetAmount, 0)
  const totalRaised  = assets.reduce((s, a) => s + a.raisedAmount, 0)
  const funding      = assets.filter(a => a.status === 'FUNDING').length
  const acquired     = assets.filter(a => ['ACQUIRED','ACTIVE'].includes(a.status)).length

  if (view === 'create') return (
    <CreateAssetForm
      groups={groups}
      groupMembers={members}
      defaultGroupId={propGroupId}
      fetchMembers={fetchMembers}
      onBack={() => setView('list')}
      onSuccess={(msg: string) => { showToast(msg); setView('list'); fetchAll() }}
    />
  )

  if (view === 'detail' && selected) return (
    <AssetDetail
      asset={selected}
      members={members}
      groupMembers={members}
      fetchMembers={fetchMembers}
      onBack={() => setView('list')}
      onContribute={() => setContributeAsset(selected)}
      onSuccess={(msg: string) => {
        showToast(msg); fetchAll()
        // Refresh selected asset data
        fetch('/api/assets').then(r => r.json()).then(d => {
          if (d.success) { const a = d.data.find((x: any) => x.id === selected.id); if (a) setSelected(a) }
        })
      }}
    />
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
                      <button onClick={() => { fetchMembers(); setContributeAsset(a) }}
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
