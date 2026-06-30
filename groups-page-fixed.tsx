'use client'
import { useState, useEffect, useCallback } from 'react'
import SendInviteModal from '../invitations/SendInviteModal'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const BLUE = '#1A5EA8'

const CURRENCIES = ['USD','ZAR','ZWG','KES','TZS','UGX','ZMW','BWP','MWK','EUR','GBP']
const STRATEGIES = [
  { value: 'SENIORITY',  label: 'Seniority Based', desc: 'Longer-standing members get earlier payout positions' },
  { value: 'RANDOM',     label: 'Random Draw',     desc: 'Cryptographically secure random shuffle at cycle start' },
  { value: 'GROUP_VOTE', label: 'Group Vote',      desc: 'Members vote on the payout order before the cycle begins' },
]

const EMPTY_FORM = {
  name: '', description: '', currency: 'USD',
  contributionAmount: '', contributionDay: '1',
  contributionFrequency: 'monthly', maxMembers: '10',
  penaltyRate: '20', insurancePoolPct: '1.5',
  payoutStrategy: 'SENIORITY', country: 'Zimbabwe', region: '',
}

// ── Helpers ───────────────────────────────────────────────────
function statusBadge(status: string) {
  const map: Record<string, [string,string]> = {
    ACTIVE:    ['#DCFCE7','#166534'],
    DRAFT:     ['#F1F5F9','#475569'],
    PAUSED:    ['#FEF9C3','#854D0E'],
    COMPLETED: ['#DBEAFE','#1E40AF'],
    DISSOLVED: ['#FEE2E2','#991B1B'],
  }
  const [bg, color] = map[status] || ['#F1F5F9','#475569']
  return <span style={{ background:bg, color, fontSize:'11px', fontWeight:'600', padding:'2px 8px', borderRadius:'999px' }}>{status}</span>
}

function Input({ label, value, onChange, type='text', placeholder='', required=false, hint='' }: any) {
  return (
    <div style={{ marginBottom:'16px' }}>
      <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
        {label} {required && <span style={{ color:'#DC2626' }}>*</span>}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }}
      />
      {hint && <p style={{ fontSize:'11px', color:'#94A3B8', margin:'4px 0 0' }}>{hint}</p>}
    </div>
  )
}

function Select({ label, value, onChange, options, required=false }: any) {
  return (
    <div style={{ marginBottom:'16px' }}>
      <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
        {label} {required && <span style={{ color:'#DC2626' }}>*</span>}
      </label>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white', boxSizing:'border-box' as any }}>
        {options.map((o: any) => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
      </select>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────
export default function GroupsPage() {
  const [view, setView]                 = useState<'list'|'detail'|'create'>('list')
  const [groups, setGroups]             = useState<any[]>([])
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<any>(null)
  const [detailTab, setDetailTab]       = useState('overview')
  const [search, setSearch]             = useState('')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteGroupId, setInviteGroupId]     = useState<string|null>(null)
  const [currentUserId, setCurrentUserId]     = useState<string>('')

  // Get current user ID on mount
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => { if (d.success && d.data?.id) setCurrentUserId(d.data.id) })
      .catch(() => {})
  }, [])
  const [toast, setToast]               = useState<{msg:string; type:'success'|'error'}|null>(null)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [formError, setFormError]       = useState('')

  // ── Fetch groups ────────────────────────────────────────────
  const fetchGroups = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/groups')
      const data = await res.json()
      if (data.success) setGroups(data.data)
      else showToast(data.error || 'Failed to load groups', 'error')
    } catch {
      showToast('Network error loading groups', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchGroups() }, [fetchGroups])

  function showToast(msg: string, type: 'success'|'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const filtered = groups.filter(g => {
    const matchSearch = g.name.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'ALL' || g.status === filterStatus
    return matchSearch && matchStatus
  })

  // ── Create group ────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) return setFormError('Group name is required')
    if (!form.contributionAmount) return setFormError('Contribution amount is required')
    setSaving(true)
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                form.name.trim(),
          description:         form.description.trim(),
          currency:            form.currency,
          contributionAmount:  parseFloat(form.contributionAmount),
          contributionDay:     parseInt(form.contributionDay),
          contributionFrequency: form.contributionFrequency,
          maxMembers:          parseInt(form.maxMembers),
          penaltyRate:         parseFloat(form.penaltyRate),
          insurancePoolPct:    parseFloat(form.insurancePoolPct),
          payoutStrategy:      form.payoutStrategy,
          country:             form.country.trim(),
          region:              form.region.trim(),
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(data.message || 'Group created successfully!')
        setForm(EMPTY_FORM)
        setView('list')
        fetchGroups() // Refresh list
      } else {
        setFormError(data.error || 'Failed to create group')
      }
    } catch {
      setFormError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── LIST VIEW ───────────────────────────────────────────────
  if (view === 'list') return (
    <div style={{ display:'flex', flexDirection:'column', gap:'20px' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', zIndex:9999, padding:'12px 20px', borderRadius:'10px', fontWeight:'500', fontSize:'13px', boxShadow:'0 8px 25px rgba(0,0,0,0.15)', background: toast.type==='success'?'#166534':'#991B1B', color:'white' }}>
          {toast.type==='success'?'✅':'❌'} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h2 style={{ fontSize:'20px', fontWeight:'700', color:NAVY, margin:'0 0 4px' }}>Groups</h2>
          <p style={{ fontSize:'13px', color:'#64748B', margin:0 }}>
            {loading ? 'Loading...' : `${groups.length} groups · ${groups.filter(g=>g.status==='ACTIVE').length} active`}
          </p>
        </div>
        <button onClick={() => setView('create')} style={{ background:TEAL, color:'white', border:'none', borderRadius:'8px', padding:'10px 18px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
          + Create Group
        </button>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap' }}>
        <input placeholder="Search groups..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding:'8px 14px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', width:'240px', outline:'none' }}
        />
        {['ALL','ACTIVE','DRAFT','PAUSED','COMPLETED'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{
            padding:'6px 14px', borderRadius:'999px', fontSize:'12px', fontWeight:'500', cursor:'pointer',
            background: filterStatus===s ? TEAL : 'white',
            color: filterStatus===s ? 'white' : '#64748B',
            border: filterStatus===s ? 'none' : '1.5px solid #E2E8F0',
          }}>{s}</button>
        ))}
        <button onClick={fetchGroups} style={{ padding:'6px 12px', borderRadius:'8px', fontSize:'12px', cursor:'pointer', background:'#F1F5F9', border:'1.5px solid #E2E8F0', color:'#475569' }}>
          ↻ Refresh
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'12px' }}>
        {[
          { label:'Total Groups',  value: loading ? '—' : groups.length,                                         color: TEAL    },
          { label:'Active Groups', value: loading ? '—' : groups.filter(g=>g.status==='ACTIVE').length,          color:'#166534'},
          { label:'Total Members', value: loading ? '—' : groups.reduce((s:number,g:any)=>s+g.memberCount,0),   color: BLUE    },
          { label:'Total Escrow',  value: loading ? '—' : `$${groups.reduce((s:number,g:any)=>s+g.escrowBalance,0).toLocaleString()}`, color:'#B45309'},
        ].map(s => (
          <div key={s.label} style={{ background:'white', borderRadius:'10px', padding:'14px 16px', border:'1px solid #E2E8F0' }}>
            <div style={{ fontSize:'11px', color:'#64748B', marginBottom:'4px' }}>{s.label}</div>
            <div style={{ fontSize:'22px', fontWeight:'700', color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'32px', marginBottom:'12px' }}>⏳</div>
          <p style={{ color:'#64748B', fontSize:'14px' }}>Loading groups from database...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'48px', marginBottom:'12px' }}>👥</div>
          <h3 style={{ fontSize:'16px', fontWeight:'600', color:NAVY, margin:'0 0 8px' }}>
            {search || filterStatus !== 'ALL' ? 'No groups match your filter' : 'No groups yet'}
          </h3>
          <p style={{ color:'#64748B', fontSize:'13px', marginBottom:'20px' }}>
            {search || filterStatus !== 'ALL' ? 'Try adjusting your search or filter.' : 'Create your first savings group to get started.'}
          </p>
          {!search && filterStatus === 'ALL' && (
            <button onClick={() => setView('create')} style={{ padding:'10px 20px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
              + Create First Group
            </button>
          )}
        </div>
      )}

      {/* Group cards */}
      {!loading && filtered.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'16px' }}>
          {filtered.map((g:any) => (
            <div key={g.id} style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
              {/* Card header */}
              <div style={{ background: g.status==='ACTIVE' ? `linear-gradient(135deg, ${NAVY}, ${TEAL})` : '#F8FAFC', padding:'16px' }}>
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'8px' }}>
                  <div style={{ width:'40px', height:'40px', borderRadius:'10px', background:'rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'20px' }}>👥</div>
                  {statusBadge(g.status)}
                </div>
                <h3 style={{ fontSize:'15px', fontWeight:'700', color: g.status==='ACTIVE'?'white':NAVY, margin:'0 0 2px' }}>{g.name}</h3>
                <p style={{ fontSize:'11px', color: g.status==='ACTIVE'?'#9FE1CB':'#94A3B8', margin:0 }}>
                  {g.region && g.country ? `${g.region}, ${g.country}` : g.country || 'Location not set'}
                </p>
              </div>

              {/* Card body */}
              <div style={{ padding:'14px 16px' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'12px' }}>
                  {[
                    { label:'Pool',        value:`${g.currency==='USD'?'$':''}${(g.contributionAmount*g.memberCount).toLocaleString()}` },
                    { label:'Contribution',value:`${g.currency==='USD'?'$':''}${g.contributionAmount}/mo` },
                    { label:'Members',     value:`${g.memberCount}/${g.maxMembers}` },
                    { label:'Escrow',      value:`${g.currency==='USD'?'$':''}${g.escrowBalance.toLocaleString()}` },
                  ].map(item => (
                    <div key={item.label} style={{ background:'#F8FAFC', borderRadius:'6px', padding:'8px 10px' }}>
                      <div style={{ fontSize:'10px', color:'#94A3B8' }}>{item.label}</div>
                      <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                {/* Cycle progress */}
                {g.activeCycle && (
                  <div style={{ marginBottom:'12px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', color:'#64748B', marginBottom:'4px' }}>
                      <span>Cycle {g.activeCycle.cycleNumber}</span>
                      <span>{g.currency} {Number(g.activeCycle.poolAmount).toLocaleString()} pool</span>
                    </div>
                    <div style={{ height:'6px', background:'#F1F5F9', borderRadius:'3px', overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:'3px', background:TEAL, width:'60%' }} />
                    </div>
                  </div>
                )}

                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px', fontSize:'11px', color:'#64748B' }}>
                  <span>Strategy: <strong>{g.payoutStrategy.replace('_',' ')}</strong></span>
                  <span>{g.currency}</span>
                </div>

                <button onClick={() => { setSelectedGroup(g); setView('detail'); setDetailTab('overview') }}
                  style={{ width:'100%', padding:'8px', background:'#F8FAFC', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', fontWeight:'500', cursor:'pointer', color:NAVY }}>
                  View Details →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ── CREATE VIEW ─────────────────────────────────────────────
  if (view === 'create') return (
    <div style={{ maxWidth:'720px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'24px' }}>
        <button onClick={() => { setView('list'); setFormError(''); setForm(EMPTY_FORM) }}
          style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', padding:'8px 14px', cursor:'pointer', fontSize:'13px', color:'#475569' }}>← Back</button>
        <div>
          <h2 style={{ fontSize:'20px', fontWeight:'700', color:NAVY, margin:'0 0 2px' }}>Create New Group</h2>
          <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>Set up a new stokvel savings group</p>
        </div>
      </div>

      {formError && (
        <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'10px', padding:'12px 16px', marginBottom:'16px', color:'#991B1B', fontSize:'13px' }}>
          ❌ {formError}
        </div>
      )}

      <form onSubmit={handleCreate}>
        {/* Basic Info */}
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px', marginBottom:'16px' }}>
          <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 16px', paddingBottom:'10px', borderBottom:'1px solid #F1F5F9' }}>📋 Basic Information</h3>
          <Input label="Group Name" value={form.name} onChange={(v:string)=>setForm(f=>({...f,name:v}))} placeholder="e.g. Harare Builders Circle" required />
          <div style={{ marginBottom:'16px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Description</label>
            <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}
              placeholder="What is this group about?" rows={3}
              style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any, resize:'vertical' as any }}
            />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <Input label="Country" value={form.country} onChange={(v:string)=>setForm(f=>({...f,country:v}))} placeholder="Zimbabwe" />
            <Input label="Region / City" value={form.region} onChange={(v:string)=>setForm(f=>({...f,region:v}))} placeholder="Harare" />
          </div>
        </div>

        {/* Financial */}
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px', marginBottom:'16px' }}>
          <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 16px', paddingBottom:'10px', borderBottom:'1px solid #F1F5F9' }}>💰 Financial Settings</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <Select label="Currency" value={form.currency} onChange={(v:string)=>setForm(f=>({...f,currency:v}))} options={CURRENCIES} required />
            <Input label="Monthly Contribution Amount" value={form.contributionAmount} onChange={(v:string)=>setForm(f=>({...f,contributionAmount:v}))} type="number" placeholder="100" required hint="Amount each member contributes per month" />
            <Select label="Frequency" value={form.contributionFrequency} onChange={(v:string)=>setForm(f=>({...f,contributionFrequency:v}))} options={[{value:'monthly',label:'Monthly'},{value:'weekly',label:'Weekly'},{value:'biweekly',label:'Bi-Weekly'}]} />
            <Input label="Collection Day (1–28)" value={form.contributionDay} onChange={(v:string)=>setForm(f=>({...f,contributionDay:v}))} type="number" placeholder="1" hint="Day of month contributions are auto-debited" />
            <Input label="Maximum Members" value={form.maxMembers} onChange={(v:string)=>setForm(f=>({...f,maxMembers:v}))} type="number" placeholder="10" />
            <Input label="Penalty Rate (%)" value={form.penaltyRate} onChange={(v:string)=>setForm(f=>({...f,penaltyRate:v}))} type="number" placeholder="20" hint="% charged on defaulting members" />
            <Input label="Insurance Pool (%)" value={form.insurancePoolPct} onChange={(v:string)=>setForm(f=>({...f,insurancePoolPct:v}))} type="number" placeholder="1.5" hint="% deducted each month into insurance reserve" />
          </div>

          {/* Live preview */}
          {form.contributionAmount && form.maxMembers && (
            <div style={{ background:'#F0FDF4', borderRadius:'8px', padding:'12px 16px', border:'1px solid #BBF7D0', marginTop:'4px' }}>
              <div style={{ fontSize:'12px', fontWeight:'600', color:'#166534', marginBottom:'8px' }}>📊 Live Pool Preview</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px' }}>
                {[
                  { label:'Monthly pool',    value:`${form.currency==='USD'?'$':''}${(parseFloat(form.contributionAmount||'0')*parseInt(form.maxMembers||'0')).toLocaleString()}` },
                  { label:'Insurance/month', value:`${form.currency==='USD'?'$':''}${(parseFloat(form.contributionAmount||'0')*parseInt(form.maxMembers||'0')*parseFloat(form.insurancePoolPct||'0')/100).toFixed(2)}` },
                  { label:'Platform fee',    value:`${form.currency==='USD'?'$':''}${(parseFloat(form.contributionAmount||'0')*parseInt(form.maxMembers||'0')*0.02).toFixed(2)}` },
                ].map(item => (
                  <div key={item.label}>
                    <div style={{ fontSize:'10px', color:'#166534', opacity:0.7 }}>{item.label}</div>
                    <div style={{ fontSize:'16px', fontWeight:'700', color:'#166534' }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Payout Strategy */}
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px', marginBottom:'16px' }}>
          <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 16px', paddingBottom:'10px', borderBottom:'1px solid #F1F5F9' }}>🔄 Payout Position Strategy</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            {STRATEGIES.map(s => (
              <div key={s.value} onClick={() => setForm(f=>({...f,payoutStrategy:s.value}))} style={{
                padding:'14px 16px', borderRadius:'8px', cursor:'pointer',
                border:`2px solid ${form.payoutStrategy===s.value?TEAL:'#E2E8F0'}`,
                background: form.payoutStrategy===s.value?'#F0FDF4':'white',
                display:'flex', alignItems:'center', gap:'12px',
              }}>
                <div style={{ width:'18px', height:'18px', borderRadius:'50%', border:`2px solid ${form.payoutStrategy===s.value?TEAL:'#CBD5E1'}`, background:form.payoutStrategy===s.value?TEAL:'white', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  {form.payoutStrategy===s.value && <div style={{ width:'6px', height:'6px', borderRadius:'50%', background:'white' }} />}
                </div>
                <div>
                  <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY }}>{s.label}</div>
                  <div style={{ fontSize:'11px', color:'#64748B', marginTop:'2px' }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div style={{ display:'flex', gap:'10px' }}>
          <button type="button" onClick={() => { setView('list'); setFormError(''); setForm(EMPTY_FORM) }}
            style={{ padding:'11px 24px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'14px', cursor:'pointer', color:'#475569', fontWeight:'500' }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={{
            flex:1, padding:'11px', border:'none', borderRadius:'8px', fontSize:'14px', fontWeight:'600', cursor: saving?'not-allowed':'pointer',
            background: saving?'#94A3B8':`linear-gradient(135deg, ${NAVY}, ${TEAL})`, color:'white',
          }}>
            {saving ? '⏳ Saving to database...' : '✓ Create Group'}
          </button>
        </div>
      </form>
    </div>
  )

  // ── DETAIL VIEW ─────────────────────────────────────────────
  const g = selectedGroup
  const TABS = ['overview','members','cycle','settings']

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
        <button onClick={() => setView('list')} style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', padding:'8px 14px', cursor:'pointer', fontSize:'13px', color:'#475569' }}>← Back</button>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <h2 style={{ fontSize:'18px', fontWeight:'700', color:NAVY, margin:0 }}>{g.name}</h2>
            {statusBadge(g.status)}
          </div>
          <p style={{ fontSize:'12px', color:'#64748B', margin:'2px 0 0' }}>
            {g.region && g.country ? `${g.region}, ${g.country} · ` : ''}{g.currency} · {g.payoutStrategy.replace('_',' ')} · Admin: {g.adminName}
          </p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => { setInviteGroupId(g.id); setShowInviteModal(true) }} style={{ padding:'8px 14px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', fontWeight:'500' }}>+ Invite Member</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:'0', borderBottom:'1px solid #E2E8F0' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setDetailTab(t)} style={{
            padding:'10px 18px', background:'none', border:'none',
            borderBottom: detailTab===t?`2px solid ${TEAL}`:'2px solid transparent',
            color: detailTab===t?TEAL:'#64748B', fontWeight: detailTab===t?'600':'400',
            fontSize:'13px', cursor:'pointer', textTransform:'capitalize', marginBottom:'-1px',
          }}>{t}</button>
        ))}
      </div>

      {/* Overview */}
      {detailTab==='overview' && (
        <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px' }}>
            {[
              { label:'Monthly Pool',   value:`$${(g.contributionAmount*g.memberCount).toLocaleString()}`, color:TEAL   },
              { label:'Escrow Balance', value:`$${g.escrowBalance.toLocaleString()}`,                      color:BLUE   },
              { label:'Members',        value:`${g.memberCount}/${g.maxMembers}`,                          color:NAVY   },
              { label:'Penalty Rate',   value:`${(g.penaltyRate*100).toFixed(0)}%`,                        color:'#B45309' },
            ].map(s => (
              <div key={s.label} style={{ background:'white', borderRadius:'10px', padding:'16px', border:'1px solid #E2E8F0' }}>
                <div style={{ fontSize:'11px', color:'#64748B', marginBottom:'4px' }}>{s.label}</div>
                <div style={{ fontSize:'22px', fontWeight:'700', color:s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ background:'white', borderRadius:'12px', padding:'20px', border:'1px solid #E2E8F0' }}>
            <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 14px' }}>Group Details</h3>
            {[
              ['Description',       g.description || 'No description'],
              ['Admin',             g.adminName],
              ['Contribution',      `$${g.contributionAmount}/month`],
              ['Collection Day',    `${g.contributionDay}${['st','nd','rd','th'][Math.min((g.contributionDay||1)-1,3)]} of month`],
              ['Max Members',       g.maxMembers],
              ['Strategy',          g.payoutStrategy.replace('_',' ')],
              ['Insurance Pool',    `${(g.insurancePoolPct*100).toFixed(1)}%`],
              ['Platform Fee',      `${(g.platformFeePct*100).toFixed(0)}%`],
              ['Country',           g.country || '—'],
              ['Region',            g.region || '—'],
              ['Created',           new Date(g.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})],
            ].map(([label,value]) => (
              <div key={label as string} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F8FAFC', fontSize:'13px' }}>
                <span style={{ color:'#64748B' }}>{label}</span>
                <span style={{ color:NAVY, fontWeight:'500', maxWidth:'60%', textAlign:'right' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* No cycle state */}
          {!g.activeCycle && (
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'32px', textAlign:'center' }}>
              <div style={{ fontSize:'36px', marginBottom:'10px' }}>🔄</div>
              <h3 style={{ fontSize:'15px', fontWeight:'600', color:NAVY, margin:'0 0 6px' }}>No Active Cycle</h3>
              <p style={{ color:'#64748B', fontSize:'13px', marginBottom:'16px' }}>Add members first, then start the first cycle to begin collecting contributions and assigning payout positions.</p>
              <button style={{ padding:'10px 20px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>🚀 Start Cycle 1</button>
            </div>
          )}
        </div>
      )}

      {/* Members tab */}
      {detailTab==='members' && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
            <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:0 }}>{g.memberCount} Members</h3>
            <button onClick={() => { setInviteGroupId(g.id); setShowInviteModal(true) }} style={{ padding:'7px 14px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', fontWeight:'500' }}>+ Invite</button>
          </div>
          <p style={{ color:'#64748B', fontSize:'13px' }}>Member details load from the database. Connect the members API to see full details here.</p>
        </div>
      )}

      {/* Cycle tab */}
      {detailTab==='cycle' && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'32px', textAlign:'center' }}>
          {g.activeCycle ? (
            <div>
              <h3 style={{ fontSize:'15px', fontWeight:'600', color:NAVY, margin:'0 0 8px' }}>Cycle {g.activeCycle.cycleNumber} Active</h3>
              <p style={{ color:'#64748B', fontSize:'13px' }}>Pool: ${Number(g.activeCycle.poolAmount).toLocaleString()}</p>
            </div>
          ) : (
            <>
              <div style={{ fontSize:'36px', marginBottom:'10px' }}>🔄</div>
              <h3 style={{ fontSize:'15px', fontWeight:'600', color:NAVY, margin:'0 0 6px' }}>No Cycle Started</h3>
              <p style={{ color:'#64748B', fontSize:'13px', marginBottom:'16px' }}>Start the first cycle to assign payout positions.</p>
              <button style={{ padding:'10px 20px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>🚀 Start Cycle 1</button>
            </>
          )}
        </div>
      )}

      {/* Settings tab */}
      {detailTab==='settings' && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'24px', maxWidth:'500px' }}>
          <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 16px' }}>Group Settings</h3>
          <p style={{ color:'#64748B', fontSize:'13px', marginBottom:'16px' }}>Group: <strong>{g.name}</strong></p>
          <div style={{ display:'flex', gap:'10px' }}>
            <button style={{ flex:1, padding:'10px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>Save Changes</button>
            <button style={{ padding:'10px 16px', background:'#FEF2F2', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'8px', fontSize:'13px', cursor:'pointer' }}>Pause Group</button>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && inviteGroupId && (
        <SendInviteModal
          groups={groups}
          preselectedGroupId={inviteGroupId}
          currentUserId={currentUserId}
          onClose={() => { setShowInviteModal(false); setInviteGroupId(null) }}
          onSuccess={() => { showToast('Invitation sent successfully!'); setShowInviteModal(false); setInviteGroupId(null) }}
        />
      )}
    </div>
  )
}
