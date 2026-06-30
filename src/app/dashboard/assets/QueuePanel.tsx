'use client'
import { useState, useEffect, useCallback } from 'react'

const TEAL   = '#0F6E56'
const NAVY   = '#0D2137'
const PURPLE = '#7C3AED'

// ── Status pipeline ────────────────────────────────────────────
const PIPELINE: Record<string, {
  label: string; icon: string; color: string; bg: string; border: string; next?: string; nextLabel?: string
}> = {
  WAITING:   { label:'Waiting',   icon:'⏳', color:'#475569', bg:'#F1F5F9', border:'#CBD5E1' },
  FUNDING:   { label:'Funding',   icon:'💰', color:'#1E40AF', bg:'#DBEAFE', border:'#93C5FD', next:'SOURCING',  nextLabel:'Mark Fully Funded' },
  SOURCING:  { label:'Sourcing',  icon:'🔍', color:'#854D0E', bg:'#FEF9C3', border:'#FCD34D', next:'ORDERED',   nextLabel:'Mark Order Placed' },
  ORDERED:   { label:'Ordered',   icon:'📦', color:'#6B21A8', bg:'#F3E8FF', border:'#C4B5FD', next:'DELIVERED', nextLabel:'Mark Delivered' },
  DELIVERED: { label:'Delivered', icon:'✅', color:'#166534', bg:'#DCFCE7', border:'#86EFAC' },
  SKIPPED:   { label:'Skipped',   icon:'⏭️', color:'#991B1B', bg:'#FEE2E2', border:'#FCA5A5' },
}

const TIER_COLORS: Record<string, [string,string]> = {
  PLATINUM: ['#E9D5FF','#5B21B6'],
  GOLD:     ['#FEF3C7','#92400E'],
  SILVER:   ['#F1F5F9','#475569'],
  BRONZE:   ['#FEE2E2','#7F1D1D'],
}

// ── Helpers ────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

function StatusPill({ status }: { status: string }) {
  const s = PIPELINE[status] || PIPELINE.WAITING
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
      {s.icon} {s.label}
    </span>
  )
}

function TierBadge({ tier }: { tier: string }) {
  const [bg, color] = TIER_COLORS[tier] || ['#F1F5F9', '#475569']
  return <span style={{ background: bg, color, fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '4px' }}>{tier}</span>
}

function Toast({ msg, type, onClose }: any) {
  useEffect(() => { const t = setTimeout(onClose, 5000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position:'fixed', top:'20px', right:'20px', zIndex:9999, padding:'12px 20px', borderRadius:'10px', fontWeight:'500', fontSize:'13px', boxShadow:'0 8px 25px rgba(0,0,0,0.18)', background: type==='success'?'#166534':'#991B1B', color:'white', display:'flex', alignItems:'center', gap:'12px', maxWidth:'420px' }}>
      <span style={{ fontSize:'16px' }}>{type==='success'?'✅':'❌'}</span>
      <span style={{ flex:1 }}>{msg}</span>
      <button onClick={onClose} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:'18px', lineHeight:1 }}>×</button>
    </div>
  )
}

// ── Initialise Queue Modal ─────────────────────────────────────
function InitialiseQueueModal({ asset, members, onClose, onSuccess }: any) {
  const [strategy, setStrategy]   = useState(asset.positionStrategy || 'SENIORITY')
  const [order, setOrder]         = useState<any[]>(members)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [dragIdx, setDragIdx]     = useState<number|null>(null)

  const STRATEGIES = [
    { value:'SENIORITY',  icon:'🏆', label:'Seniority',   desc:'Longer-standing members receive first' },
    { value:'RANDOM',     icon:'🎲', label:'Random Draw', desc:'Cryptographically secure shuffle at start' },
    { value:'GROUP_VOTE', icon:'🗳️', label:'Group Vote',  desc:'Drag and drop to set the order below' },
  ]

  function moveUp(i: number) {
    if (i === 0) return
    const arr = [...order]; [arr[i-1], arr[i]] = [arr[i], arr[i-1]]; setOrder(arr)
  }
  function moveDown(i: number) {
    if (i === order.length - 1) return
    const arr = [...order]; [arr[i], arr[i+1]] = [arr[i+1], arr[i]]; setOrder(arr)
  }

  async function handleInit() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/assets/queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId:  asset.id,
          strategy,
          memberIds: strategy === 'GROUP_VOTE' ? order.map((m: any) => m.id) : undefined,
        }),
      })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error || 'Failed to initialise queue')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'20px' }}>
      <div style={{ background:'white', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'560px', maxHeight:'90vh', overflowY:'auto', boxShadow:'0 25px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'20px' }}>
          <div>
            <h3 style={{ fontSize:'17px', fontWeight:'700', color:NAVY, margin:'0 0 4px' }}>🔄 Initialise Round Robin Queue</h3>
            <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>{asset.name} · {members.length} members</p>
          </div>
          <button onClick={onClose} style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', width:'32px', height:'32px', cursor:'pointer', fontSize:'18px', color:'#64748B' }}>×</button>
        </div>

        {/* Strategy picker */}
        <div style={{ marginBottom:'20px' }}>
          <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'8px' }}>Position Assignment Strategy</label>
          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {STRATEGIES.map(s => (
              <div key={s.value} onClick={() => setStrategy(s.value)}
                style={{ padding:'12px 14px', borderRadius:'10px', cursor:'pointer', border:`2px solid ${strategy===s.value?PURPLE:'#E2E8F0'}`, background:strategy===s.value?'#F3E8FF':'white', display:'flex', alignItems:'center', gap:'12px' }}>
                <div style={{ width:'18px', height:'18px', borderRadius:'50%', border:`2px solid ${strategy===s.value?PURPLE:'#CBD5E1'}`, background:strategy===s.value?PURPLE:'white', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {strategy===s.value && <div style={{ width:'6px', height:'6px', borderRadius:'50%', background:'white' }} />}
                </div>
                <div>
                  <span style={{ fontSize:'14px' }}>{s.icon}</span>
                  <span style={{ fontSize:'13px', fontWeight:'600', color:NAVY, marginLeft:'6px' }}>{s.label}</span>
                  <span style={{ fontSize:'11px', color:'#64748B', marginLeft:'8px' }}>— {s.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Member order — shown for GROUP_VOTE, preview for others */}
        <div style={{ marginBottom:'20px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
            <label style={{ fontSize:'12px', fontWeight:'600', color:'#374151' }}>
              {strategy==='GROUP_VOTE' ? 'Drag to set order (position 1 receives first)' : 'Preview order (will be shuffled/sorted at start)'}
            </label>
            <span style={{ fontSize:'11px', color:'#94A3B8' }}>{members.length} members</span>
          </div>
          <div style={{ border:'1px solid #E2E8F0', borderRadius:'10px', overflow:'hidden' }}>
            {order.map((m: any, i: number) => (
              <div key={m.id}
                style={{ display:'flex', alignItems:'center', gap:'10px', padding:'10px 14px', borderBottom: i < order.length-1 ? '1px solid #F1F5F9':'none', background: i%2===0?'white':'#FAFAFA' }}>
                <div style={{ width:'24px', height:'24px', borderRadius:'50%', background:'#F3E8FF', color:PURPLE, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'700', flexShrink:0 }}>{i+1}</div>
                <div style={{ width:'30px', height:'30px', borderRadius:'50%', background:'#E1F5EE', color:TEAL, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'700', flexShrink:0 }}>
                  {m.fullName.split(' ').map((n: string)=>n[0]).join('').slice(0,2)}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'13px', fontWeight:'500', color:NAVY }}>{m.fullName}</div>
                  <div style={{ fontSize:'11px', color:'#94A3B8' }}>Score: {Number(m.reputationScore).toFixed(0)} · {m.tier}</div>
                </div>
                {strategy==='GROUP_VOTE' && (
                  <div style={{ display:'flex', gap:'4px' }}>
                    <button onClick={() => moveUp(i)} disabled={i===0} style={{ width:'24px', height:'24px', border:'1px solid #E2E8F0', borderRadius:'4px', background:i===0?'#F8FAFC':'white', cursor:i===0?'default':'pointer', fontSize:'13px', display:'flex', alignItems:'center', justifyContent:'center', color:i===0?'#CBD5E1':'#475569' }}>↑</button>
                    <button onClick={() => moveDown(i)} disabled={i===order.length-1} style={{ width:'24px', height:'24px', border:'1px solid #E2E8F0', borderRadius:'4px', background:i===order.length-1?'#F8FAFC':'white', cursor:i===order.length-1?'default':'pointer', fontSize:'13px', display:'flex', alignItems:'center', justifyContent:'center', color:i===order.length-1?'#CBD5E1':'#475569' }}>↓</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'8px', padding:'10px 14px', color:'#991B1B', fontSize:'12px', marginBottom:'14px' }}>❌ {error}</div>}

        <div style={{ display:'flex', gap:'10px' }}>
          <button onClick={onClose} style={{ flex:1, padding:'10px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#475569' }}>Cancel</button>
          <button onClick={handleInit} disabled={saving}
            style={{ flex:2, padding:'10px', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:saving?'not-allowed':'pointer', background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${PURPLE})`, color:'white' }}>
            {saving ? '⏳ Initialising...' : `🚀 Start Queue — ${members.length} Members`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Advance Status Modal ───────────────────────────────────────
function AdvanceModal({ entry, action, onClose, onSuccess }: any) {
  const [serialNumber, setSerialNumber]   = useState(entry.serialNumber || '')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [skipReason, setSkipReason]       = useState('')
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState('')

  const isDeliver = action === 'MARK_DELIVERED'
  const isOrder   = action === 'MARK_ORDERED'
  const isSkip    = action === 'SKIP'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isSkip && !skipReason.trim()) return setError('Please provide a reason for skipping')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/assets/queue/advance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: entry.id, action, serialNumber, deliveryNotes, skipReason }),
      })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error || 'Action failed')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  const titles: Record<string, string> = {
    MARK_ORDERED:   '📦 Confirm Order Placed',
    MARK_DELIVERED: '✅ Confirm Delivery',
    SKIP:           '⏭️ Skip Member',
  }
  const colors: Record<string, string> = {
    MARK_ORDERED: '#6B21A8', MARK_DELIVERED: TEAL, SKIP: '#991B1B',
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'white', borderRadius:'16px', padding:'28px', width:'440px', boxShadow:'0 25px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'18px' }}>
          <div>
            <h3 style={{ fontSize:'16px', fontWeight:'700', color:NAVY, margin:'0 0 4px' }}>{titles[action]}</h3>
            <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>Position #{entry.position} · {entry.memberName}</p>
          </div>
          <button onClick={onClose} style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', width:'32px', height:'32px', cursor:'pointer', fontSize:'18px', color:'#64748B' }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          {(isOrder || isDeliver) && (
            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
                Serial Number {isDeliver && <span style={{ color:'#DC2626' }}>*</span>}
              </label>
              <input type="text" value={serialNumber} onChange={e => setSerialNumber(e.target.value)} required={isDeliver}
                placeholder="Manufacturer serial / chassis number..."
                style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }} />
              <p style={{ fontSize:'11px', color:'#94A3B8', margin:'4px 0 0' }}>Uniquely identifies this member's unit</p>
            </div>
          )}

          {isDeliver && (
            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Delivery Notes</label>
              <textarea value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)} rows={3}
                placeholder="Condition at delivery, any observations, handover details..."
                style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any, resize:'vertical' as any }} />
            </div>
          )}

          {isSkip && (
            <>
              <div style={{ background:'#FEF9C3', border:'1px solid #FCD34D', borderRadius:'8px', padding:'12px 14px', marginBottom:'14px', fontSize:'12px', color:'#854D0E' }}>
                ⚠️ Skipping a member moves them to the end. Their position cannot be recovered automatically. The next waiting member will start funding immediately.
              </div>
              <div style={{ marginBottom:'14px' }}>
                <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Reason for Skipping <span style={{ color:'#DC2626' }}>*</span></label>
                <textarea value={skipReason} onChange={e => setSkipReason(e.target.value)} rows={3} required
                  placeholder="Explain why this member is being skipped (e.g. withdrew from group, unable to receive at this time)..."
                  style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any, resize:'vertical' as any }} />
              </div>
            </>
          )}

          {isDeliver && (
            <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:'8px', padding:'12px 14px', marginBottom:'14px', fontSize:'12px', color:'#166534' }}>
              ✅ Marking delivered will:
              <ul style={{ margin:'6px 0 0', paddingLeft:'16px', display:'flex', flexDirection:'column', gap:'2px' }}>
                <li>Record this member as owner of their unit</li>
                <li>Generate a digital handover record</li>
                <li>Automatically activate the next member in the queue</li>
              </ul>
            </div>
          )}

          {error && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'8px', padding:'10px', color:'#991B1B', fontSize:'12px', marginBottom:'12px' }}>❌ {error}</div>}

          <div style={{ display:'flex', gap:'10px' }}>
            <button type="button" onClick={onClose} style={{ flex:1, padding:'10px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#475569' }}>Cancel</button>
            <button type="submit" disabled={saving}
              style={{ flex:2, padding:'10px', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:saving?'not-allowed':'pointer', background:saving?'#94A3B8':colors[action], color:'white' }}>
              {saving ? '⏳ Processing...' : titles[action]}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Contribute to Queue Modal ──────────────────────────────────
function QueueContributeModal({ asset, currentEntry, members, onClose, onSuccess }: any) {
  const [amount, setAmount]   = useState('')
  const [userId, setUserId]   = useState(members[0]?.id || '')
  const [method, setMethod]   = useState('ECOCASH')
  const [ref, setRef]         = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const remaining = Number(currentEntry.targetAmount) - Number(currentEntry.raisedAmount)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || parseFloat(amount) <= 0) return setError('Enter a valid amount')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/assets/queue', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, userId, amount: parseFloat(amount), paymentMethod: method, paymentRef: ref }),
      })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error || 'Failed')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  const pct = Math.min(100, Math.round(Number(currentEntry.raisedAmount) / Number(currentEntry.targetAmount) * 100))

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'white', borderRadius:'16px', padding:'28px', width:'440px', boxShadow:'0 25px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'16px' }}>
          <div>
            <h3 style={{ fontSize:'16px', fontWeight:'700', color:NAVY, margin:'0 0 4px' }}>💰 Queue Contribution</h3>
            <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>Currently funding: <strong>{currentEntry.memberName}</strong> (Position #{currentEntry.position})</p>
          </div>
          <button onClick={onClose} style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', width:'32px', height:'32px', cursor:'pointer', fontSize:'18px', color:'#64748B' }}>×</button>
        </div>

        {/* Funding progress */}
        <div style={{ background:'#F3E8FF', borderRadius:'10px', padding:'14px', marginBottom:'18px', border:'1px solid #C4B5FD' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', color:PURPLE, marginBottom:'6px' }}>
            <span>Funding for {currentEntry.memberName}'s unit</span>
            <span style={{ fontWeight:'700' }}>{pct}% · ${fmt(Number(currentEntry.raisedAmount))} of ${fmt(Number(currentEntry.targetAmount))}</span>
          </div>
          <div style={{ height:'10px', background:'rgba(124,58,237,0.15)', borderRadius:'5px', overflow:'hidden' }}>
            <div style={{ height:'100%', borderRadius:'5px', background:PURPLE, width:`${pct}%`, transition:'width 0.5s' }} />
          </div>
          <div style={{ fontSize:'12px', color:PURPLE, marginTop:'6px' }}>Still needed: <strong>${fmt(remaining)}</strong></div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom:'12px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Contributing Member</label>
            <select value={userId} onChange={e => setUserId(e.target.value)} style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white' }}>
              {members.map((m: any) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
            </select>
          </div>
          <div style={{ marginBottom:'12px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Amount ($) *</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:'12px', top:'50%', transform:'translateY(-50%)', color:'#64748B' }}>$</span>
              <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required
                style={{ width:'100%', padding:'9px 12px 9px 26px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'14px', fontWeight:'600', outline:'none', boxSizing:'border-box' as any }} />
            </div>
            {remaining > 0 && <button type="button" onClick={() => setAmount(remaining.toFixed(2))} style={{ marginTop:'4px', fontSize:'11px', color:PURPLE, background:'none', border:'none', cursor:'pointer', padding:0 }}>Fill remaining: ${fmt(remaining)}</button>}
          </div>
          <div style={{ marginBottom:'12px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Payment Method</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
              {[['ECOCASH','📱 EcoCash'],['BANK_TRANSFER','🏦 Bank'],['CARD','💳 Card'],['CASH','💵 Cash']].map(([v,l]) => (
                <div key={v} onClick={() => setMethod(v)} style={{ padding:'8px', borderRadius:'8px', cursor:'pointer', border:`2px solid ${method===v?PURPLE:'#E2E8F0'}`, background:method===v?'#F3E8FF':'white', fontSize:'12px', fontWeight:'500', color:NAVY }}>{l}</div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Reference <span style={{ color:'#94A3B8', fontWeight:'400' }}>(optional)</span></label>
            <input type="text" value={ref} onChange={e => setRef(e.target.value)} placeholder="EcoCash ref, bank ref..."
              style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }} />
          </div>
          {error && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'8px', padding:'10px', color:'#991B1B', fontSize:'12px', marginBottom:'12px' }}>❌ {error}</div>}
          <div style={{ display:'flex', gap:'10px' }}>
            <button type="button" onClick={onClose} style={{ flex:1, padding:'10px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#475569' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ flex:2, padding:'10px', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:saving?'not-allowed':'pointer', background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${PURPLE})`, color:'white' }}>
              {saving ? '⏳ Recording...' : '✓ Record Contribution'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


// ── Certificate Modal ──────────────────────────────────────────
function CertificateModal({ entry, onClose }: { entry: any; onClose: () => void }) {
  const [loading, setLoading]   = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string|null>(null)
  const [error, setError]       = useState('')

  useEffect(() => {
    loadPreview()
  }, [])

  async function loadPreview() {
    setLoading(true)
    try {
      const res = await fetch(`/api/assets/handover?entryId=${entry.id}&preview=true`)
      if (!res.ok) throw new Error('Failed to generate preview')
      const blob = await res.blob()
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (e: any) {
      setError(e.message || 'Failed to load preview')
    } finally {
      setLoading(false)
    }
  }

  async function handleDownload() {
    try {
      const res = await fetch(`/api/assets/handover?entryId=${entry.id}`)
      if (!res.ok) throw new Error('Failed to generate certificate')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const ref  = `HOC-${entry.id.slice(0,6).toUpperCase()}-${String(entry.position).padStart(3,'0')}`
      a.href     = url
      a.download = `Handover-Certificate-${ref}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message || 'Download failed')
    }
  }

  function handlePrint() {
    if (!previewUrl) return
    const win = window.open(previewUrl, '_blank')
    win?.print()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'20px' }}>
      <div style={{ background:'white', borderRadius:'16px', width:'100%', maxWidth:'720px', maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 25px 60px rgba(0,0,0,0.35)', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'18px 24px', borderBottom:'1px solid #E2E8F0', display:'flex', alignItems:'center', gap:'12px', background: NAVY, flexShrink:0 }}>
          <div style={{ flex:1 }}>
            <h3 style={{ fontSize:'16px', fontWeight:'700', color:'white', margin:'0 0 2px' }}>📜 Digital Handover Certificate</h3>
            <p style={{ fontSize:'12px', color:'rgba(255,255,255,0.6)', margin:0 }}>
              {entry.memberName} · Position #{entry.position} · {entry.serialNumber ? `S/N: ${entry.serialNumber}` : 'No serial assigned'}
            </p>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={handlePrint} disabled={!previewUrl}
              style={{ padding:'7px 14px', background:'rgba(255,255,255,0.15)', color:'white', border:'1px solid rgba(255,255,255,0.25)', borderRadius:'8px', fontSize:'12px', cursor:previewUrl?'pointer':'not-allowed', fontWeight:'500' }}>
              🖨️ Print
            </button>
            <button onClick={handleDownload}
              style={{ padding:'7px 14px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:'600', cursor:'pointer' }}>
              📥 Download PDF
            </button>
            <button onClick={onClose}
              style={{ width:'32px', height:'32px', background:'rgba(255,255,255,0.15)', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'18px', color:'white', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
          </div>
        </div>

        {/* Certificate info strip */}
        <div style={{ padding:'10px 24px', background:'#F3E8FF', borderBottom:'1px solid #C4B5FD', display:'flex', gap:'24px', flexShrink:0, flexWrap:'wrap' }}>
          {[
            { label:'Member',    value: entry.memberName       },
            { label:'Position',  value: `#${entry.position}`   },
            { label:'Delivered', value: entry.deliveredAt ? new Date(entry.deliveredAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'Pending' },
            { label:'Status',    value: entry.status           },
          ].map(item => (
            <div key={item.label}>
              <div style={{ fontSize:'10px', color:PURPLE, fontWeight:'600', textTransform:'uppercase', letterSpacing:'0.04em' }}>{item.label}</div>
              <div style={{ fontSize:'13px', color:NAVY, fontWeight:'500' }}>{item.value}</div>
            </div>
          ))}
        </div>

        {/* PDF Preview */}
        <div style={{ flex:1, overflow:'hidden', background:'#F8FAFC', display:'flex', alignItems:'center', justifyContent:'center', minHeight:'400px' }}>
          {loading && (
            <div style={{ textAlign:'center', color:'#64748B' }}>
              <div style={{ fontSize:'36px', marginBottom:'12px' }}>⏳</div>
              <p style={{ fontSize:'14px' }}>Generating certificate preview...</p>
            </div>
          )}
          {error && (
            <div style={{ textAlign:'center', color:'#991B1B', padding:'20px' }}>
              <div style={{ fontSize:'36px', marginBottom:'12px' }}>❌</div>
              <p style={{ fontSize:'14px' }}>{error}</p>
              <button onClick={loadPreview} style={{ marginTop:'12px', padding:'8px 16px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'8px', cursor:'pointer', color:'#991B1B', fontSize:'13px' }}>
                Try Again
              </button>
            </div>
          )}
          {previewUrl && !loading && (
            <iframe
              src={previewUrl}
              style={{ width:'100%', height:'100%', border:'none', minHeight:'460px' }}
              title="Certificate Preview"
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 24px', borderTop:'1px solid #E2E8F0', background:'white', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <p style={{ fontSize:'11px', color:'#94A3B8', margin:0 }}>
            This is an official document. Both parties should retain a signed copy.
          </p>
          <button onClick={onClose} style={{ padding:'8px 20px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#475569' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Main Queue Component ───────────────────────────────────────
export default function RoundRobinQueue({ assetId, assetName, onBack, members }: {
  assetId: string; assetName: string; onBack: () => void; members: any[]
}) {
  const [data, setData]         = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [toast, setToast]       = useState<any>(null)
  const [view, setView]         = useState<'timeline'|'table'|'analytics'>('timeline')
  const [showInit, setShowInit] = useState(false)
  const [advanceModal, setAdvanceModal] = useState<{entry:any; action:string}|null>(null)
  const [showContribute, setShowContribute] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [certEntry, setCertEntry]               = useState<any>(null)

  function showToast(msg: string, type: 'success'|'error' = 'success') { setToast({ msg, type }) }

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/assets/queue?assetId=${assetId}`)
      const json = await res.json()
      if (json.success) setData(json.data)
      else showToast(json.error || 'Failed to load queue', 'error')
    } catch { showToast('Network error', 'error') }
    finally { setLoading(false) }
  }, [assetId])

  useEffect(() => { fetchQueue() }, [fetchQueue])

  async function handleReset() {
    try {
      const res  = await fetch('/api/assets/queue', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ assetId }) })
      const json = await res.json()
      if (json.success) { showToast('Queue reset successfully'); fetchQueue() }
      else showToast(json.error || 'Reset failed', 'error')
    } catch { showToast('Network error', 'error') }
    setShowResetConfirm(false)
  }

  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <button onClick={onBack} style={{ alignSelf:'flex-start', background:'#F1F5F9', border:'none', borderRadius:'8px', padding:'8px 14px', cursor:'pointer', fontSize:'13px', color:'#475569' }}>← Back</button>
      <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
        <div style={{ fontSize:'32px', marginBottom:'12px' }}>⏳</div>
        <p style={{ color:'#64748B' }}>Loading queue...</p>
      </div>
    </div>
  )

  if (!data) return null

  const { asset, queue, summary } = data
  const currentEntry = queue.find((e: any) => e.status === 'FUNDING')
  const nextEntry    = queue.find((e: any) => e.status === 'WAITING')

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {showInit && <InitialiseQueueModal asset={asset} members={members} onClose={() => setShowInit(false)} onSuccess={(msg: string) => { showToast(msg); fetchQueue() }} />}
      {advanceModal && <AdvanceModal entry={advanceModal.entry} action={advanceModal.action} onClose={() => setAdvanceModal(null)} onSuccess={(msg: string) => { showToast(msg); fetchQueue() }} />}
      {showContribute && currentEntry && <QueueContributeModal asset={asset} currentEntry={currentEntry} members={members} onClose={() => setShowContribute(false)} onSuccess={(msg: string) => { showToast(msg); fetchQueue() }} />}

      {/* Reset confirm */}
      {certEntry && <CertificateModal entry={certEntry} onClose={() => setCertEntry(null)} />}

      {showResetConfirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div style={{ background:'white', borderRadius:'16px', padding:'28px', width:'420px' }}>
            <h3 style={{ fontSize:'16px', fontWeight:'700', color:'#991B1B', margin:'0 0 8px' }}>⚠️ Reset Queue?</h3>
            <p style={{ fontSize:'13px', color:'#374151', margin:'0 0 20px', lineHeight:'1.5' }}>This will delete all queue entries and reset all funding progress. All contribution records will remain but the queue positions will be lost. This cannot be undone.</p>
            <div style={{ display:'flex', gap:'10px' }}>
              <button onClick={() => setShowResetConfirm(false)} style={{ flex:1, padding:'10px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer' }}>Cancel</button>
              <button onClick={handleReset} style={{ flex:1, padding:'10px', background:'#991B1B', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>Reset Queue</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
        <button onClick={onBack} style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', padding:'8px 14px', cursor:'pointer', fontSize:'13px', color:'#475569' }}>← Back</button>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <span style={{ fontSize:'20px' }}>🔄</span>
            <h2 style={{ fontSize:'18px', fontWeight:'700', color:NAVY, margin:0 }}>{assetName}</h2>
            <span style={{ background:'#F3E8FF', color:PURPLE, fontSize:'11px', fontWeight:'600', padding:'3px 9px', borderRadius:'999px' }}>Round Robin Queue</span>
          </div>
          <p style={{ fontSize:'12px', color:'#64748B', margin:'3px 0 0' }}>{asset.groupName} · {asset.currency} · {asset.positionStrategy} positions</p>
        </div>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          {!summary.isQueueInitialised ? (
            <button onClick={() => setShowInit(true)} style={{ padding:'9px 18px', background:`linear-gradient(135deg,${NAVY},${PURPLE})`, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
              🚀 Initialise Queue
            </button>
          ) : (
            <>
              {currentEntry && (
                <button onClick={() => setShowContribute(true)} style={{ padding:'8px 14px', background:PURPLE, color:'white', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:'600', cursor:'pointer' }}>
                  💰 Record Contribution
                </button>
              )}
              <button onClick={fetchQueue} style={{ padding:'8px 12px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#475569' }}>↻</button>
              <button onClick={() => setShowResetConfirm(true)} style={{ padding:'8px 12px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#991B1B' }}>Reset</button>
            </>
          )}
        </div>
      </div>

      {/* Not initialised state */}
      {!summary.isQueueInitialised && (
        <div style={{ background:'white', borderRadius:'16px', border:'2px dashed #C4B5FD', padding:'60px 40px', textAlign:'center' }}>
          <div style={{ fontSize:'56px', marginBottom:'16px' }}>🔄</div>
          <h3 style={{ fontSize:'18px', fontWeight:'700', color:NAVY, margin:'0 0 10px' }}>Queue Not Yet Initialised</h3>
          <p style={{ color:'#64748B', fontSize:'14px', lineHeight:'1.6', maxWidth:'460px', margin:'0 auto 24px' }}>
            Click <strong>Initialise Queue</strong> to assign positions to all active group members. Choose a strategy — Seniority, Random, or Group Vote — and the queue will be created with the first member immediately moving into funding stage.
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', maxWidth:'480px', margin:'0 auto 28px' }}>
            {[
              { icon:'🏆', label:'Seniority', desc:'Longer members first' },
              { icon:'🎲', label:'Random',    desc:'Fair random draw'    },
              { icon:'🗳️', label:'Vote',      desc:'Members decide order'},
            ].map(s => (
              <div key={s.label} style={{ background:'#F3E8FF', borderRadius:'10px', padding:'14px', border:'1px solid #C4B5FD' }}>
                <div style={{ fontSize:'24px', marginBottom:'6px' }}>{s.icon}</div>
                <div style={{ fontSize:'13px', fontWeight:'600', color:PURPLE }}>{s.label}</div>
                <div style={{ fontSize:'11px', color:'#64748B', marginTop:'2px' }}>{s.desc}</div>
              </div>
            ))}
          </div>
          <button onClick={() => setShowInit(true)} style={{ padding:'12px 32px', background:`linear-gradient(135deg,${NAVY},${PURPLE})`, color:'white', border:'none', borderRadius:'10px', fontSize:'15px', fontWeight:'700', cursor:'pointer' }}>
            🚀 Initialise Queue
          </button>
        </div>
      )}

      {/* Initialised — show summary + queue */}
      {summary.isQueueInitialised && (
        <>
          {/* KPI strip */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px' }}>
            {[
              { label:'Delivered',   value:summary.delivered,   color:'#166534', bg:'#DCFCE7' },
              { label:'In Progress', value:summary.inProgress,  color:'#1E40AF', bg:'#DBEAFE' },
              { label:'Waiting',     value:summary.waiting,     color:'#475569', bg:'#F1F5F9' },
              { label:'Skipped',     value:summary.skipped,     color:'#991B1B', bg:'#FEE2E2' },
              { label:'Total Queue', value:summary.totalMembers, color:PURPLE,   bg:'#F3E8FF' },
            ].map(s => (
              <div key={s.label} style={{ background:s.bg, borderRadius:'10px', padding:'14px 12px', textAlign:'center' }}>
                <div style={{ fontSize:'26px', fontWeight:'700', color:s.color }}>{s.value}</div>
                <div style={{ fontSize:'11px', color:s.color, fontWeight:'600', marginTop:'2px', opacity:0.8 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Current funding spotlight */}
          {currentEntry && (
            <div style={{ background:`linear-gradient(135deg,${NAVY},${PURPLE})`, borderRadius:'16px', padding:'22px 24px', color:'white' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'14px', flexWrap:'wrap', gap:'12px' }}>
                <div>
                  <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.6)', marginBottom:'4px' }}>Currently Funding — Position #{currentEntry.position}</div>
                  <div style={{ fontSize:'22px', fontWeight:'700', marginBottom:'4px' }}>{currentEntry.memberName}</div>
                  <div style={{ fontSize:'13px', color:'rgba(255,255,255,0.75)' }}>
                    ${fmt(currentEntry.raisedAmount)} raised of ${fmt(currentEntry.targetAmount)} target
                  </div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'8px', alignItems:'flex-end' }}>
                  <div style={{ background:'rgba(255,255,255,0.15)', borderRadius:'10px', padding:'10px 14px', textAlign:'center', minWidth:'110px' }}>
                    <div style={{ fontSize:'28px', fontWeight:'700' }}>{currentEntry.fundingProgress}%</div>
                    <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.7)' }}>funded</div>
                  </div>
                  {nextEntry && (
                    <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.6)', textAlign:'right' }}>
                      Next: <strong style={{ color:'rgba(255,255,255,0.9)' }}>{nextEntry.memberName}</strong>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ height:'12px', background:'rgba(255,255,255,0.2)', borderRadius:'6px', overflow:'hidden', marginBottom:'14px' }}>
                <div style={{ height:'100%', borderRadius:'6px', background:'rgba(255,255,255,0.9)', width:`${currentEntry.fundingProgress}%`, transition:'width 0.5s' }} />
              </div>
              <div style={{ display:'flex', gap:'10px', flexWrap:'wrap' }}>
                <button onClick={() => setShowContribute(true)} style={{ padding:'8px 18px', background:'rgba(255,255,255,0.2)', color:'white', border:'1px solid rgba(255,255,255,0.35)', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
                  💰 Record Contribution
                </button>
                {currentEntry.fundingProgress >= 100 && (
                  <button onClick={() => setAdvanceModal({ entry: currentEntry, action: 'MARK_ORDERED' })} style={{ padding:'8px 18px', background:'rgba(255,255,255,0.9)', color:PURPLE, border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'700', cursor:'pointer' }}>
                    ✅ Mark Fully Funded → Sourcing
                  </button>
                )}
              </div>
            </div>
          )}

          {summary.cycleComplete && (
            <div style={{ background:'linear-gradient(135deg,#166534,#0F6E56)', borderRadius:'16px', padding:'24px', textAlign:'center', color:'white' }}>
              <div style={{ fontSize:'48px', marginBottom:'12px' }}>🎉</div>
              <div style={{ fontSize:'20px', fontWeight:'700', marginBottom:'6px' }}>Round Robin Complete!</div>
              <div style={{ fontSize:'14px', color:'rgba(255,255,255,0.8)' }}>All {summary.totalMembers} members have received their units. The cycle is complete.</div>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display:'flex', gap:'0', borderBottom:'1px solid #E2E8F0' }}>
            {[
              { id:'timeline', label:'🔄 Timeline View'  },
              { id:'table',    label:'📋 Table View'     },
              { id:'analytics',label:'📊 Analytics'      },
            ].map(t => (
              <button key={t.id} onClick={() => setView(t.id as any)} style={{ padding:'10px 20px', background:'none', border:'none', borderBottom:view===t.id?`2px solid ${PURPLE}`:'2px solid transparent', color:view===t.id?PURPLE:'#64748B', fontWeight:view===t.id?'600':'400', fontSize:'13px', cursor:'pointer', marginBottom:'-1px' }}>{t.label}</button>
            ))}
          </div>

          {/* ── TIMELINE VIEW ── */}
          {view === 'timeline' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'0' }}>
              {queue.map((entry: any, i: number) => {
                const s = PIPELINE[entry.status]
                const isCurrent = entry.status === 'FUNDING'
                const isDone    = entry.status === 'DELIVERED'
                const canAdvance = ['FUNDING','SOURCING','ORDERED'].includes(entry.status)
                return (
                  <div key={entry.id} style={{ display:'flex', gap:'0', alignItems:'stretch' }}>
                    {/* Connector line + node */}
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:'48px', flexShrink:0 }}>
                      <div style={{ width:'2px', flex: i === 0 ? '0 0 24px' : 1, background: i === 0 ? 'transparent' : isDone ? '#0F6E56' : '#E2E8F0' }} />
                      <div style={{ width:'36px', height:'36px', borderRadius:'50%', background:s.bg, border:`2px solid ${s.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px', flexShrink:0, zIndex:1 }}>{s.icon}</div>
                      <div style={{ width:'2px', flex: i === queue.length-1 ? '0 0 24px' : 1, background: isDone ? '#0F6E56' : '#E2E8F0' }} />
                    </div>

                    {/* Entry card */}
                    <div style={{ flex:1, padding:'12px 0 12px 16px', paddingBottom: i === queue.length-1 ? '0':'12px' }}>
                      <div style={{ background: isCurrent ? `linear-gradient(to right, ${s.bg}, white)` : isDone ? '#F0FDF4' : 'white', borderRadius:'12px', border:`1px solid ${isCurrent?s.border:isDone?'#86EFAC':'#F1F5F9'}`, padding:'14px 16px', marginBottom: i < queue.length-1 ? '0':'0' }}>
                        <div style={{ display:'flex', alignItems:'flex-start', gap:'12px', flexWrap:'wrap' }}>
                          {/* Avatar + name */}
                          <div style={{ display:'flex', alignItems:'center', gap:'10px', flex:1, minWidth:'200px' }}>
                            <div style={{ width:'38px', height:'38px', borderRadius:'50%', background:s.bg, color:s.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:'700', border:`2px solid ${s.border}`, flexShrink:0 }}>
                              {entry.memberName.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                            </div>
                            <div>
                              <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                                <span style={{ fontSize:'14px', fontWeight:isCurrent?'700':'500', color:NAVY }}>#{entry.position} {entry.memberName}</span>
                                <StatusPill status={entry.status} />
                                <TierBadge tier={entry.tier} />
                              </div>
                              <div style={{ fontSize:'11px', color:'#94A3B8', marginTop:'2px' }}>
                                Score: {entry.reputationScore.toFixed(0)} · {entry.memberEmail}
                              </div>
                            </div>
                          </div>

                          {/* Funding progress */}
                          <div style={{ minWidth:'180px' }}>
                            {['FUNDING','SOURCING','ORDERED','DELIVERED'].includes(entry.status) && (
                              <>
                                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', color:'#64748B', marginBottom:'3px' }}>
                                  <span>Funded</span>
                                  <span style={{ fontWeight:'600', color:s.color }}>{entry.fundingProgress}%</span>
                                </div>
                                <div style={{ height:'6px', background:'#F1F5F9', borderRadius:'3px', overflow:'hidden' }}>
                                  <div style={{ height:'100%', borderRadius:'3px', background:s.color, width:`${entry.fundingProgress}%` }} />
                                </div>
                                <div style={{ fontSize:'10px', color:'#94A3B8', marginTop:'2px' }}>
                                  ${fmt(entry.raisedAmount)} of ${fmt(entry.targetAmount)}
                                </div>
                              </>
                            )}
                            {entry.status === 'WAITING' && (
                              <div style={{ fontSize:'12px', color:'#94A3B8' }}>
                                Target: ${fmt(entry.targetAmount)}
                              </div>
                            )}
                          </div>

                          {/* Dates + serial */}
                          <div style={{ minWidth:'140px', fontSize:'11px', color:'#64748B' }}>
                            {entry.fundingStarted && <div>Started: {new Date(entry.fundingStarted).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'})}</div>}
                            {entry.orderedAt     && <div>Ordered: {new Date(entry.orderedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'})}</div>}
                            {entry.deliveredAt   && <div>Delivered: {new Date(entry.deliveredAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'})}</div>}
                            {entry.serialNumber  && <div style={{ fontFamily:'monospace', fontSize:'10px', marginTop:'2px', color:TEAL }}>S/N: {entry.serialNumber}</div>}
                            {entry.skipReason    && <div style={{ color:'#991B1B', fontSize:'10px', marginTop:'2px' }}>Skipped: {entry.skipReason}</div>}
                          </div>

                          {/* Actions */}
                          <div style={{ display:'flex', gap:'6px', alignItems:'center', flexShrink:0 }}>
                            {entry.status === 'FUNDING' && (
                              <>
                                <button onClick={() => setShowContribute(true)}
                                  style={{ padding:'6px 12px', background:PURPLE, color:'white', border:'none', borderRadius:'6px', fontSize:'11px', fontWeight:'600', cursor:'pointer' }}>💰 Contribute</button>
                                {entry.fundingProgress >= 100 && (
                                  <button onClick={() => setAdvanceModal({ entry, action:'MARK_ORDERED' })}
                                    style={{ padding:'6px 12px', background:'#FEF9C3', color:'#854D0E', border:'1px solid #FCD34D', borderRadius:'6px', fontSize:'11px', fontWeight:'600', cursor:'pointer' }}>→ Sourcing</button>
                                )}
                              </>
                            )}
                            {entry.status === 'SOURCING' && (
                              <button onClick={() => setAdvanceModal({ entry, action:'MARK_ORDERED' })}
                                style={{ padding:'6px 12px', background:'#F3E8FF', color:PURPLE, border:`1px solid #C4B5FD`, borderRadius:'6px', fontSize:'11px', fontWeight:'600', cursor:'pointer' }}>→ Mark Ordered</button>
                            )}
                            {entry.status === 'ORDERED' && (
                              <button onClick={() => setAdvanceModal({ entry, action:'MARK_DELIVERED' })}
                                style={{ padding:'6px 12px', background:'#DCFCE7', color:'#166534', border:'1px solid #86EFAC', borderRadius:'6px', fontSize:'11px', fontWeight:'600', cursor:'pointer' }}>→ Mark Delivered</button>
                            )}
                            {['FUNDING','SOURCING'].includes(entry.status) && (
                              <button onClick={() => setAdvanceModal({ entry, action:'SKIP' })}
                                style={{ padding:'6px 10px', background:'#FEF2F2', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'6px', fontSize:'11px', cursor:'pointer' }}>Skip</button>
                            )}
                            {entry.deliveryNotes && (
                              <button title={entry.deliveryNotes} style={{ padding:'6px 10px', background:'#F1F5F9', border:'none', borderRadius:'6px', fontSize:'11px', cursor:'help', color:'#64748B' }}>📝</button>
                            )}
                            {entry.status === 'DELIVERED' && (
                              <button onClick={() => setCertEntry(entry)}
                                style={{ padding:'6px 12px', background:'#DCFCE7', color:'#166534', border:'1px solid #86EFAC', borderRadius:'6px', fontSize:'11px', fontWeight:'600', cursor:'pointer', whiteSpace:'nowrap' }}>
                                📜 Certificate
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── TABLE VIEW ── */}
          {view === 'table' && (
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr style={{ background:'#F8FAFC' }}>
                    {['Pos','Member','Tier','Score','Status','Raised','Target','Progress %','Delivered','Serial','Actions'].map(h => (
                      <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:'10px', fontWeight:'600', color:'#64748B', borderBottom:'1px solid #E2E8F0', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queue.map((entry: any, i: number) => (
                    <tr key={entry.id} style={{ borderBottom:'1px solid #F8FAFC', background: entry.status==='FUNDING'?'#F3E8FF': entry.status==='DELIVERED'?'#F0FDF4': i%2===0?'white':'#FAFAFA' }}>
                      <td style={{ padding:'10px 14px', fontSize:'14px', fontWeight:'700', color:PURPLE }}>#{entry.position}</td>
                      <td style={{ padding:'10px 14px' }}>
                        <div style={{ fontSize:'13px', fontWeight:'500', color:NAVY }}>{entry.memberName}</div>
                        <div style={{ fontSize:'10px', color:'#94A3B8' }}>{entry.memberEmail}</div>
                      </td>
                      <td style={{ padding:'10px 14px' }}><TierBadge tier={entry.tier} /></td>
                      <td style={{ padding:'10px 14px', fontSize:'13px', fontWeight:'600', color:TEAL }}>{entry.reputationScore.toFixed(0)}</td>
                      <td style={{ padding:'10px 14px' }}><StatusPill status={entry.status} /></td>
                      <td style={{ padding:'10px 14px', fontSize:'13px', fontWeight:'600', color:TEAL }}>${fmt(entry.raisedAmount)}</td>
                      <td style={{ padding:'10px 14px', fontSize:'12px', color:'#475569' }}>${fmt(entry.targetAmount)}</td>
                      <td style={{ padding:'10px 14px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                          <div style={{ width:'60px', height:'5px', background:'#F1F5F9', borderRadius:'3px', overflow:'hidden' }}>
                            <div style={{ height:'100%', background:PIPELINE[entry.status]?.color||'#94A3B8', width:`${entry.fundingProgress}%` }} />
                          </div>
                          <span style={{ fontSize:'11px', fontWeight:'600', color:NAVY }}>{entry.fundingProgress}%</span>
                        </div>
                      </td>
                      <td style={{ padding:'10px 14px', fontSize:'11px', color:'#64748B' }}>
                        {entry.deliveredAt ? new Date(entry.deliveredAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}) : '—'}
                      </td>
                      <td style={{ padding:'10px 14px', fontSize:'11px', color:TEAL, fontFamily:'monospace' }}>{entry.serialNumber || '—'}</td>
                      <td style={{ padding:'10px 14px' }}>
                        <div style={{ display:'flex', gap:'4px' }}>
                          {entry.status==='FUNDING' && <button onClick={() => setShowContribute(true)} style={{ padding:'3px 8px', background:PURPLE, color:'white', border:'none', borderRadius:'4px', fontSize:'10px', cursor:'pointer', fontWeight:'600' }}>💰</button>}
                          {entry.status==='SOURCING' && <button onClick={() => setAdvanceModal({entry, action:'MARK_ORDERED'})} style={{ padding:'3px 8px', background:'#F3E8FF', color:PURPLE, border:`1px solid #C4B5FD`, borderRadius:'4px', fontSize:'10px', cursor:'pointer' }}>Order</button>}
                          {entry.status==='ORDERED'  && <button onClick={() => setAdvanceModal({entry, action:'MARK_DELIVERED'})} style={{ padding:'3px 8px', background:'#DCFCE7', color:'#166534', border:'1px solid #86EFAC', borderRadius:'4px', fontSize:'10px', cursor:'pointer' }}>Deliver</button>}
                          {['FUNDING','SOURCING'].includes(entry.status) && <button onClick={() => setAdvanceModal({entry, action:'SKIP'})} style={{ padding:'3px 8px', background:'#FEF2F2', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'4px', fontSize:'10px', cursor:'pointer' }}>Skip</button>}
                          {entry.status === 'DELIVERED' && <button onClick={() => setCertEntry(entry)} style={{ padding:'3px 8px', background:'#DCFCE7', color:'#166534', border:'1px solid #86EFAC', borderRadius:'4px', fontSize:'10px', cursor:'pointer', fontWeight:'600' }}>📜 Cert</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── ANALYTICS VIEW ── */}
          {view === 'analytics' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
              {/* Pipeline funnel */}
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px' }}>
                <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 16px' }}>📊 Pipeline Status</h3>
                <div style={{ display:'flex', gap:'2px', height:'48px', borderRadius:'8px', overflow:'hidden' }}>
                  {Object.entries(PIPELINE).filter(([k]) => k !== 'SKIPPED').map(([status, meta]) => {
                    const count = queue.filter((e: any) => e.status === status).length
                    if (count === 0) return null
                    const pct = Math.round(count / queue.length * 100)
                    return (
                      <div key={status} style={{ flex:count, background:meta.bg, border:`1px solid ${meta.border}`, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', minWidth:'40px' }} title={`${meta.label}: ${count}`}>
                        <span style={{ fontSize:'18px' }}>{meta.icon}</span>
                        <span style={{ fontSize:'10px', fontWeight:'600', color:meta.color }}>{count}</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ display:'flex', gap:'12px', flexWrap:'wrap', marginTop:'10px' }}>
                  {Object.entries(PIPELINE).map(([status, meta]) => {
                    const count = queue.filter((e: any) => e.status === status).length
                    if (count === 0) return null
                    return (
                      <div key={status} style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                        <div style={{ width:'10px', height:'10px', borderRadius:'2px', background:meta.bg, border:`1px solid ${meta.border}` }} />
                        <span style={{ fontSize:'11px', color:'#64748B' }}>{meta.label}: <strong style={{ color:meta.color }}>{count}</strong></span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Financial summary */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px' }}>
                {[
                  { label:'Total Target (All Units)',  value:`$${fmt(queue.reduce((s:number,e:any)=>s+e.targetAmount,0))}`, color:NAVY     },
                  { label:'Total Raised So Far',        value:`$${fmt(queue.reduce((s:number,e:any)=>s+e.raisedAmount,0))}`, color:TEAL     },
                  { label:'Remaining to Collect',       value:`$${fmt(queue.filter((e:any)=>!['DELIVERED','SKIPPED'].includes(e.status)).reduce((s:number,e:any)=>s+e.targetAmount-e.raisedAmount,0))}`, color:PURPLE },
                ].map(s => (
                  <div key={s.label} style={{ background:'white', borderRadius:'10px', padding:'16px', border:'1px solid #E2E8F0' }}>
                    <div style={{ fontSize:'11px', color:'#64748B', marginBottom:'6px' }}>{s.label}</div>
                    <div style={{ fontSize:'22px', fontWeight:'700', color:s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Member progress table */}
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px' }}>
                <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 14px' }}>Member Funding Progress</h3>
                {queue.map((entry: any) => (
                  <div key={entry.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 0', borderBottom:'1px solid #F8FAFC' }}>
                    <div style={{ width:'20px', fontSize:'12px', fontWeight:'700', color:PURPLE, textAlign:'right', flexShrink:0 }}>#{entry.position}</div>
                    <div style={{ width:'32px', height:'32px', borderRadius:'50%', background:'#F3E8FF', color:PURPLE, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'700', flexShrink:0 }}>
                      {entry.memberName.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                    </div>
                    <div style={{ width:'160px', fontSize:'13px', color:NAVY, fontWeight:'500', flexShrink:0 }}>{entry.memberName}</div>
                    <div style={{ flex:1, height:'8px', background:'#F1F5F9', borderRadius:'4px', overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:'4px', background:PIPELINE[entry.status]?.color||'#CBD5E1', width:`${entry.fundingProgress}%`, transition:'width 0.5s' }} />
                    </div>
                    <div style={{ width:'40px', fontSize:'12px', fontWeight:'700', color:PIPELINE[entry.status]?.color||'#CBD5E1', textAlign:'right', flexShrink:0 }}>{entry.fundingProgress}%</div>
                    <div style={{ flexShrink:0 }}><StatusPill status={entry.status} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
