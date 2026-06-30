'use client'
import { useState, useEffect, useCallback } from 'react'

const TEAL = '#0F6E56'; const NAVY = '#0D2137'; const PURPLE = '#7C3AED'

const STATUS_META: Record<string, any> = {
  FUNDING:  { bg:'#DBEAFE', color:'#1E40AF', icon:'💰', label:'Funding'  },
  ACQUIRED: { bg:'#F3E8FF', color:'#6B21A8', icon:'🏠', label:'Acquired' },
  RENTING:  { bg:'#DCFCE7', color:'#166534', icon:'🔑', label:'Renting'  },
  SOLD:     { bg:'#F1F5F9', color:'#475569', icon:'✅', label:'Sold'     },
}

const TYPE_ICONS: Record<string, string> = {
  residential: '🏠', commercial: '🏢', agricultural: '🌾', industrial: '🏭', mixed: '🏙️',
}

const fmt  = (n: number) => new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)
const fmtK = (n: number) => n >= 1000000 ? `$${(n/1000000).toFixed(2)}M` : n >= 1000 ? `$${(n/1000).toFixed(0)}K` : `$${fmt(n)}`

function Toast({ msg, type, onClose }: any) {
  useEffect(()=>{ const t=setTimeout(onClose,5000); return()=>clearTimeout(t) },[onClose])
  return <div style={{position:'fixed',top:'20px',right:'20px',zIndex:9999,padding:'12px 20px',borderRadius:'10px',fontWeight:'500',fontSize:'13px',boxShadow:'0 8px 25px rgba(0,0,0,0.15)',background:type==='success'?'#166534':'#991B1B',color:'white',display:'flex',alignItems:'center',gap:'10px',maxWidth:'420px'}}>
    <span>{type==='success'?'✅':'❌'}</span><span style={{flex:1}}>{msg}</span>
    <button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'18px'}}>×</button>
  </div>
}

function StatusPill({ status }: any) {
  const m = STATUS_META[status] || STATUS_META.FUNDING
  return <span style={{background:m.bg,color:m.color,fontSize:'11px',fontWeight:'600',padding:'3px 9px',borderRadius:'999px',display:'inline-flex',alignItems:'center',gap:'4px',whiteSpace:'nowrap'}}>{m.icon} {m.label}</span>
}

function Field({ label, value, onChange, type='text', placeholder='', required=false, hint='' }: any) {
  return (
    <div style={{marginBottom:'13px'}}>
      <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>{label}{required&&<span style={{color:'#DC2626'}}> *</span>}</label>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} required={required}
        style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none'}}/>
      {hint&&<p style={{fontSize:'11px',color:'#94A3B8',margin:'4px 0 0'}}>{hint}</p>}
    </div>
  )
}

// ── Create Property Modal ─────────────────────────────────────
function CreatePropertyModal({ groups, onClose, onSuccess }: any) {
  const [form, setForm] = useState({
    groupId:'', name:'', description:'', propertyAddress:'', propertyType:'residential',
    targetCapital:'', managementFeePct:'10', maintenanceReservePct:'5',
    bondAmount:'', bondProvider:'', notes:''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k: string) => (v: string) => setForm(p=>({...p,[k]:v}))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const res = await fetch('/api/property', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({...form, targetCapital:parseFloat(form.targetCapital), managementFeePct:parseFloat(form.managementFeePct)/100,
          maintenanceReservePct:parseFloat(form.maintenanceReservePct)/100, bondAmount:form.bondAmount?parseFloat(form.bondAmount):undefined}) })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error || 'Failed')
    } catch { setError('Network error') } finally { setSaving(false) }
  }

  const TYPES = ['residential','commercial','agricultural','industrial','mixed']

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
      <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'600px',maxHeight:'92vh',overflowY:'auto',boxShadow:'0 25px 50px rgba(0,0,0,0.3)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
          <h3 style={{fontSize:'17px',fontWeight:'700',color:NAVY,margin:0}}>🏠 New Property Investment</h3>
          <button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px'}}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            <div style={{gridColumn:'1/-1'}}>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Group *</label>
              <select value={form.groupId} onChange={e=>set('groupId')(e.target.value)} required style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box'}}>
                <option value="">Select group...</option>
                {groups.map((g: any)=><option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div style={{gridColumn:'1/-1'}}><Field label="Property Name" value={form.name} onChange={set('name')} placeholder="e.g. Borrowdale Residential Complex" required /></div>
            <div style={{gridColumn:'1/-1'}}><Field label="Property Address" value={form.propertyAddress} onChange={set('propertyAddress')} placeholder="Full street address" /></div>
          </div>

          <div style={{marginBottom:'14px'}}>
            <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'6px'}}>Property Type</label>
            <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
              {TYPES.map(t=><div key={t} onClick={()=>set('propertyType')(t)}
                style={{padding:'7px 14px',borderRadius:'8px',cursor:'pointer',border:`2px solid ${form.propertyType===t?TEAL:'#E2E8F0'}`,background:form.propertyType===t?'#F0FDF4':'white',fontSize:'12px',fontWeight:'500',color:NAVY,display:'flex',alignItems:'center',gap:'6px'}}>
                {TYPE_ICONS[t]} {t.charAt(0).toUpperCase()+t.slice(1)}
              </div>)}
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px'}}>
            <Field label="Target Capital ($) *" value={form.targetCapital} onChange={set('targetCapital')} type="number" placeholder="500000" required />
            <div style={{marginBottom:'13px'}}>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Management Fee %</label>
              <div style={{position:'relative'}}>
                <input type="number" step="0.5" value={form.managementFeePct} onChange={e=>set('managementFeePct')(e.target.value)} placeholder="10"
                  style={{width:'100%',padding:'9px 28px 9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
                <span style={{position:'absolute',right:'10px',top:'50%',transform:'translateY(-50%)',color:'#64748B',fontSize:'12px'}}>%</span>
              </div>
            </div>
            <div style={{marginBottom:'13px'}}>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Maintenance Reserve %</label>
              <div style={{position:'relative'}}>
                <input type="number" step="0.5" value={form.maintenanceReservePct} onChange={e=>set('maintenanceReservePct')(e.target.value)} placeholder="5"
                  style={{width:'100%',padding:'9px 28px 9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
                <span style={{position:'absolute',right:'10px',top:'50%',transform:'translateY(-50%)',color:'#64748B',fontSize:'12px'}}>%</span>
              </div>
            </div>
            <Field label="Bond Amount ($)" value={form.bondAmount} onChange={set('bondAmount')} type="number" placeholder="Optional" hint="If property is bonded/mortgaged" />
            <div style={{gridColumn:'2/-1'}}><Field label="Bond Provider" value={form.bondProvider} onChange={set('bondProvider')} placeholder="e.g. Stanbic Bank Zimbabwe" /></div>
          </div>

          <div style={{marginBottom:'14px'}}>
            <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Description</label>
            <textarea value={form.description} onChange={e=>set('description')(e.target.value)} rows={2} placeholder="Property overview, investment thesis..."
              style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box',resize:'vertical'}}/>
          </div>
          <Field label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any additional notes..." />

          {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',marginBottom:'12px'}}>❌ {error}</div>}
          <div style={{display:'flex',gap:'10px'}}>
            <button type="button" onClick={onClose} style={{flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
            <button type="submit" disabled={saving} style={{flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white'}}>
              {saving?'⏳ Creating...':'🏠 Create Property Investment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Property Detail ───────────────────────────────────────────
function PropertyDetail({ propertyId, members, onClose, onAction }: any) {
  const [prop, setProp]   = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]     = useState<'overview'|'investors'|'rental'|'valuations'|'actions'>('overview')
  const [contributeForm, setContributeForm] = useState({ userId:'', amount:'', method:'BANK_TRANSFER', ref:'' })
  const [rentalForm, setRentalForm]   = useState({ period:new Date().toISOString().slice(0,7), grossRental:'', notes:'' })
  const [valuationForm, setValForm]   = useState({ valuationDate:new Date().toISOString().split('T')[0], marketValue:'', valuedBy:'', method:'estate_agent', documentUrl:'', notes:'' })
  const [statusForm, setStatusForm]   = useState({ status:'', purchaseDate:'', purchasePrice:'', salePrice:'', soldAt:'' })
  const [saving, setSaving]           = useState(false)

  const fetchProp = useCallback(async () => {
    const res  = await fetch(`/api/property?propertyId=${propertyId}`)
    const data = await res.json()
    if (data.success) setProp(data.data)
    setLoading(false)
  }, [propertyId])

  useEffect(()=>{ fetchProp() },[fetchProp])

  async function handleAction(action: string, payload: any) {
    setSaving(true)
    try {
      const res  = await fetch('/api/property', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,...payload}) })
      const data = await res.json()
      if (data.success) { onAction(data.message); fetchProp() }
      else onAction(data.error||'Failed','error')
    } catch { onAction('Network error','error') } finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
      <div style={{background:'white',borderRadius:'16px',padding:'40px',textAlign:'center'}}><div style={{fontSize:'32px',marginBottom:'12px'}}>⏳</div>Loading...</div>
    </div>
  )

  if (!prop) return null

  const sm       = STATUS_META[prop.status] || STATUS_META.FUNDING
  const annualYield = prop.monthlyRental > 0 && prop.currentValue > 0
    ? ((prop.monthlyRental * 12) / prop.currentValue * 100).toFixed(2)
    : null
  const capitalGain = prop.purchasePrice > 0 && prop.currentValue > 0
    ? prop.currentValue - prop.purchasePrice : 0

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
      <div style={{background:'white',borderRadius:'16px',width:'100%',maxWidth:'740px',maxHeight:'92vh',display:'flex',flexDirection:'column',boxShadow:'0 25px 60px rgba(0,0,0,0.3)',overflow:'hidden'}}>

        {/* Header */}
        <div style={{background:`linear-gradient(135deg,${NAVY},#1A4A6B)`,padding:'22px 26px',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:'14px'}}>
            <div style={{width:'48px',height:'48px',borderRadius:'12px',background:'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'24px',flexShrink:0}}>
              {TYPE_ICONS[prop.propertyType||'residential']}
            </div>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'3px'}}>
                <span style={{fontSize:'17px',fontWeight:'700',color:'white'}}>{prop.name}</span>
                <StatusPill status={prop.status} />
                <span style={{background:'rgba(255,255,255,0.15)',color:'rgba(255,255,255,0.8)',fontSize:'10px',fontWeight:'500',padding:'2px 7px',borderRadius:'4px'}}>{prop.propertyType}</span>
              </div>
              {prop.propertyAddress && <div style={{fontSize:'12px',color:'rgba(255,255,255,0.6)'}}>{prop.propertyAddress}</div>}
              <div style={{fontSize:'11px',color:'rgba(255,255,255,0.5)',marginTop:'2px'}}>{prop.groupName}</div>
            </div>
            <button onClick={onClose} style={{width:'32px',height:'32px',background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'18px',color:'white'}}>×</button>
          </div>

          {/* Key metrics strip */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px',marginTop:'16px',paddingTop:'14px',borderTop:'1px solid rgba(255,255,255,0.1)'}}>
            {[
              {l:'Current Value',    v:fmtK(prop.currentValue),          c:prop.currentValue>prop.purchasePrice?'#9FE1CB':'white'},
              {l:'Capital Raised',   v:fmtK(prop.raisedCapital),         c:'white'},
              {l:'Target Capital',   v:fmtK(prop.targetCapital),         c:'rgba(255,255,255,0.7)'},
              {l:'Monthly Rental',   v:prop.monthlyRental>0?fmtK(prop.monthlyRental):'—', c:'#9FE1CB'},
              {l:'Annual Yield',     v:annualYield?`${annualYield}%`:'—', c:'#9FE1CB'},
            ].map(s=>(
              <div key={s.l}>
                <div style={{fontSize:'9px',color:'rgba(255,255,255,0.5)',textTransform:'uppercase',letterSpacing:'0.04em'}}>{s.l}</div>
                <div style={{fontSize:'15px',fontWeight:'700',color:s.c,marginTop:'2px'}}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Funding progress */}
          {prop.status === 'FUNDING' && (
            <div style={{marginTop:'12px'}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',color:'rgba(255,255,255,0.6)',marginBottom:'4px'}}>
                <span>Funding progress</span>
                <span style={{fontWeight:'600',color:'rgba(255,255,255,0.9)'}}>{prop.fundingPct}%</span>
              </div>
              <div style={{height:'8px',background:'rgba(255,255,255,0.15)',borderRadius:'4px',overflow:'hidden'}}>
                <div style={{height:'100%',background:'rgba(255,255,255,0.8)',borderRadius:'4px',width:`${prop.fundingPct}%`,transition:'width 0.5s'}}/>
              </div>
              <div style={{fontSize:'11px',color:'rgba(255,255,255,0.5)',marginTop:'4px'}}>${fmt(prop.raisedCapital)} raised of ${fmt(prop.targetCapital)} target</div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{display:'flex',borderBottom:'1px solid #E2E8F0',flexShrink:0,overflowX:'auto'}}>
          {[['overview','📋 Overview'],['investors','👥 Investors'],['rental','🔑 Rental Income'],['valuations','📊 Valuations'],['actions','⚙️ Actions']].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id as any)} style={{padding:'10px 16px',background:'none',border:'none',borderBottom:tab===id?`2px solid ${TEAL}`:'2px solid transparent',color:tab===id?TEAL:'#64748B',fontWeight:tab===id?'600':'400',fontSize:'13px',cursor:'pointer',marginBottom:'-1px',whiteSpace:'nowrap'}}>{label}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{flex:1,overflowY:'auto',padding:'18px 22px'}}>

          {/* Overview */}
          {tab==='overview' && (
            <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px'}}>
                {[
                  ['Property Type',    prop.propertyType||'—'],
                  ['Status',          prop.status],
                  ['Investors',       `${prop.stakeCount} investor${prop.stakeCount!==1?'s':''}`],
                  ['Purchase Price',  prop.purchasePrice>0?`$${fmt(prop.purchasePrice)}`:'—'],
                  ['Purchase Date',   prop.purchaseDate?new Date(prop.purchaseDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—'],
                  ['Bond Amount',     prop.bondAmount>0?`$${fmt(prop.bondAmount)}`:'—'],
                  ['Bond Provider',   prop.bondProvider||'—'],
                  ['Mgmt Fee',        `${(prop.managementFeePct*100).toFixed(0)}%`],
                  ['Maintenance Res.',`${(prop.maintenanceReservePct*100).toFixed(0)}%`],
                  ['Total Income',    `$${fmt(prop.totalIncome||0)}`],
                  ['Capital Gain',    capitalGain!==0?`${capitalGain>0?'+':''}$${fmt(capitalGain)}`:'—'],
                  ['Last Valuation',  prop.lastValuationDate?new Date(prop.lastValuationDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'No valuations'],
                ].map(([l,v])=>(
                  <div key={l} style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px'}}>
                    <div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'3px'}}>{l}</div>
                    <div style={{fontSize:'13px',fontWeight:'500',color:NAVY}}>{v}</div>
                  </div>
                ))}
              </div>
              {prop.description&&<div style={{background:'#F8FAFC',borderRadius:'8px',padding:'12px 14px',border:'1px solid #E2E8F0',fontSize:'13px',color:'#475569',lineHeight:'1.6'}}>{prop.description}</div>}
              {prop.notes&&<div style={{background:'#FEF9C3',borderRadius:'8px',padding:'12px 14px',border:'1px solid #FCD34D',fontSize:'12px',color:'#854D0E'}}>📝 {prop.notes}</div>}
            </div>
          )}

          {/* Investors */}
          {tab==='investors' && (
            <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
              {/* Contribute form */}
              {['FUNDING','ACQUIRED'].includes(prop.status) && (
                <div style={{background:'#F0FDF4',borderRadius:'12px',padding:'16px',border:'1px solid #BBF7D0'}}>
                  <h4 style={{fontSize:'13px',fontWeight:'600',color:NAVY,margin:'0 0 12px'}}>💰 Record Capital Contribution</h4>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'8px',alignItems:'end'}}>
                    <div>
                      <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Member</label>
                      <select value={contributeForm.userId} onChange={e=>setContributeForm(f=>({...f,userId:e.target.value}))}
                        style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',background:'white',boxSizing:'border-box'}}>
                        <option value="">Select...</option>
                        {members.filter((m:any)=>m.groupId===prop.groupId).map((m:any)=><option key={m.userId} value={m.userId}>{m.fullName}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Amount ($)</label>
                      <input type="number" step="0.01" value={contributeForm.amount} onChange={e=>setContributeForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"
                        style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'13px',fontWeight:'600',outline:'none',boxSizing:'border-box'}}/>
                    </div>
                    <div>
                      <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Method</label>
                      <select value={contributeForm.method} onChange={e=>setContributeForm(f=>({...f,method:e.target.value}))}
                        style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',background:'white',boxSizing:'border-box'}}>
                        <option value="BANK_TRANSFER">Bank</option><option value="ECOCASH">EcoCash</option><option value="CARD">Card</option>
                      </select>
                    </div>
                    <button onClick={()=>handleAction('CONTRIBUTE',{propertyGroupId:prop.id,userId:contributeForm.userId,amount:parseFloat(contributeForm.amount),paymentMethod:contributeForm.method,paymentRef:contributeForm.ref})}
                      disabled={saving||!contributeForm.userId||!contributeForm.amount}
                      style={{padding:'8px 14px',background:saving?'#94A3B8':TEAL,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',whiteSpace:'nowrap'}}>
                      {saving?'⏳':'✓ Record'}
                    </button>
                  </div>
                </div>
              )}
              {/* Ownership table */}
              {!prop.stakes?.length ? <div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}>No investors yet. Record a contribution above to get started.</div> : (
                <>
                  <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                    {prop.stakes.map((s: any)=>(
                      <div key={s.userId} style={{display:'flex',alignItems:'center',gap:'12px',background:'#F8FAFC',borderRadius:'10px',padding:'12px 14px',border:'1px solid #E2E8F0'}}>
                        <div style={{width:'36px',height:'36px',borderRadius:'50%',background:'#E1F5EE',color:TEAL,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',flexShrink:0}}>
                          {(s.fullName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:'13px',fontWeight:'600',color:NAVY}}>{s.fullName}</div>
                          <div style={{fontSize:'11px',color:'#94A3B8'}}>{s.email}</div>
                        </div>
                        <div style={{textAlign:'center'}}>
                          <div style={{fontSize:'20px',fontWeight:'700',color:PURPLE}}>{Number(s.ownershipPct).toFixed(2)}%</div>
                          <div style={{fontSize:'10px',color:'#94A3B8'}}>ownership</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontSize:'14px',fontWeight:'600',color:TEAL}}>${fmt(s.totalContributed)}</div>
                          <div style={{fontSize:'10px',color:'#94A3B8'}}>contributed</div>
                        </div>
                        {prop.currentValue>0&&(
                          <div style={{textAlign:'right'}}>
                            <div style={{fontSize:'13px',fontWeight:'600',color:NAVY}}>${fmt(s.currentValue)}</div>
                            <div style={{fontSize:'10px',color:'#94A3B8'}}>value today</div>
                          </div>
                        )}
                      </div>
                    </>
          )}
                  </div>
                  {/* Ownership pie summary */}
                  <div style={{background:'white',borderRadius:'10px',border:'1px solid #E2E8F0',padding:'14px'}}>
                    <div style={{height:'12px',background:'#F1F5F9',borderRadius:'6px',overflow:'hidden',display:'flex',marginBottom:'8px'}}>
                      {prop.stakes.map((s: any, i: number)=>{
                        const colors=['#0F6E56','#7C3AED','#1A5EA8','#854D0E','#166534','#991B1B']
                        return <div key={s.userId} style={{height:'100%',background:colors[i%colors.length],width:`${s.ownershipPct}%`,transition:'width 0.5s'}} title={`${s.fullName}: ${s.ownershipPct.toFixed(2)}%`}/>
                      })}
                    </div>
                    <div style={{display:'flex',gap:'12px',flexWrap:'wrap'}}>
                      {prop.stakes.map((s: any,i: number)=>{
                        const colors=['#0F6E56','#7C3AED','#1A5EA8','#854D0E','#166534','#991B1B']
                        return <div key={s.userId} style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'11px',color:'#64748B'}}>
                          <div style={{width:'8px',height:'8px',borderRadius:'2px',background:colors[i%colors.length]}}/>
                          {s.fullName} <strong style={{color:colors[i%colors.length]}}>{s.ownershipPct.toFixed(1)}%</strong>
                        </div>
                      })}
                    </div>
                  </div>
              )}
            </div>
          )}

          {/* Rental Income */}
          {tab==='rental' && (
            <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
              {['RENTING','ACQUIRED'].includes(prop.status) && (
                <div style={{background:'#F0FDF4',borderRadius:'12px',padding:'16px',border:'1px solid #BBF7D0'}}>
                  <h4 style={{fontSize:'13px',fontWeight:'600',color:NAVY,margin:'0 0 12px'}}>🔑 Record Monthly Rental Income</h4>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px',marginBottom:'10px'}}>
                    <div>
                      <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Period (YYYY-MM) *</label>
                      <input type="month" value={rentalForm.period} onChange={e=>setRentalForm(f=>({...f,period:e.target.value}))}
                        style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
                    </div>
                    <div>
                      <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Gross Rental ($) *</label>
                      <input type="number" step="0.01" value={rentalForm.grossRental} onChange={e=>setRentalForm(f=>({...f,grossRental:e.target.value}))} placeholder="0.00"
                        style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'13px',fontWeight:'600',outline:'none',boxSizing:'border-box'}}/>
                    </div>
                    <div style={{display:'flex',alignItems:'flex-end'}}>
                      <button onClick={()=>handleAction('RECORD_RENTAL',{propertyGroupId:prop.id,...rentalForm,grossRental:parseFloat(rentalForm.grossRental)})}
                        disabled={saving||!rentalForm.grossRental}
                        style={{width:'100%',padding:'9px',background:saving?'#94A3B8':TEAL,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                        {saving?'⏳':'Record & Distribute'}
                      </button>
                    </div>
                  </div>
                  {parseFloat(rentalForm.grossRental||'0')>0&&(
                    <div style={{background:'white',borderRadius:'8px',padding:'10px 14px',border:'1px solid #E2E8F0',fontSize:'12px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
                      {[
                        ['Mgmt Fee',`-$${fmt(parseFloat(rentalForm.grossRental)*prop.managementFeePct)}`,`${(prop.managementFeePct*100).toFixed(0)}%`],
                        ['Maintenance',`-$${fmt(parseFloat(rentalForm.grossRental)*prop.maintenanceReservePct)}`,`${(prop.maintenanceReservePct*100).toFixed(0)}%`],
                        ['Platform',`-$${fmt(parseFloat(rentalForm.grossRental)*0.01)}`,'1%'],
                        ['Net to Investors',`$${fmt(parseFloat(rentalForm.grossRental)*(1-prop.managementFeePct-prop.maintenanceReservePct-0.01))}`,''],
                      ].map(([l,v,p])=>(
                        <div key={l}>
                          <div style={{fontSize:'10px',color:'#94A3B8',marginBottom:'2px'}}>{l} {p&&<span style={{color:'#CBD5E1'}}>({p})</span>}</div>
                          <div style={{fontSize:'13px',fontWeight:'700',color:l==='Net to Investors'?TEAL:'#854D0E'}}>{v}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Rental history */}
              {!prop.rentalDistributions?.length ? (
                <div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}><div style={{fontSize:'32px',marginBottom:'8px'}}>🔑</div><p>No rental income recorded yet.</p></div>
              ) : (
                <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr style={{background:'#F8FAFC'}}>
                      {['Period','Gross Rental','Mgmt Fee','Maintenance','Net Distributed','Investors','Date'].map(h=>(
                        <th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {prop.rentalDistributions.map((d: any,i: number)=>(
                        <tr key={d.id} style={{borderBottom:'1px solid #F8FAFC',background:i%2===0?'white':'#FAFAFA'}}>
                          <td style={{padding:'9px 12px',fontSize:'13px',fontWeight:'700',color:NAVY}}>{d.period}</td>
                          <td style={{padding:'9px 12px',fontSize:'13px',color:'#475569'}}>${fmt(d.grossRental)}</td>
                          <td style={{padding:'9px 12px',fontSize:'12px',color:'#854D0E'}}>-${fmt(d.managementFee)}</td>
                          <td style={{padding:'9px 12px',fontSize:'12px',color:'#854D0E'}}>-${fmt(d.maintenanceReserve)}</td>
                          <td style={{padding:'9px 12px',fontSize:'13px',fontWeight:'700',color:TEAL}}>${fmt(d.netDistributed)}</td>
                          <td style={{padding:'9px 12px',fontSize:'12px',color:'#64748B'}}>{d.sharesCount}</td>
                          <td style={{padding:'9px 12px',fontSize:'11px',color:'#94A3B8',whiteSpace:'nowrap'}}>{new Date(d.distributedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{background:'#F8FAFC',borderTop:'2px solid #E2E8F0'}}>
                      <td colSpan={4} style={{padding:'10px 12px',fontSize:'12px',fontWeight:'600',color:NAVY}}>Total</td>
                      <td style={{padding:'10px 12px',fontSize:'14px',fontWeight:'700',color:TEAL}}>${fmt(prop.rentalDistributions.reduce((s:number,d:any)=>s+d.netDistributed,0))}</td>
                      <td colSpan={2}/>
                    </tr></tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Valuations */}
          {tab==='valuations' && (
            <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
              <div style={{background:'#F0FDF4',borderRadius:'12px',padding:'16px',border:'1px solid #BBF7D0'}}>
                <h4 style={{fontSize:'13px',fontWeight:'600',color:NAVY,margin:'0 0 12px'}}>📊 Record New Valuation</h4>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'8px',alignItems:'end'}}>
                  {[['valuationDate','Date','date',''],['marketValue','Market Value ($)','number','0'],['valuedBy','Valued By','text','Estate agent name'],['method','Method','text','bank_valuation']].map(([k,l,t,p])=>(
                    <div key={k}>
                      <label style={{display:'block',fontSize:'10px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>{l}</label>
                      <input type={t} value={(valuationForm as any)[k]} onChange={e=>setValForm(f=>({...f,[k]:e.target.value}))} placeholder={p}
                        style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
                    </div>
                  ))}
                </div>
                {prop.purchasePrice>0&&parseFloat(valuationForm.marketValue||'0')>0&&(
                  <div style={{marginTop:'10px',display:'flex',gap:'12px',fontSize:'12px'}}>
                    <span style={{color:'#64748B'}}>Capital gain: <strong style={{color:parseFloat(valuationForm.marketValue)>prop.purchasePrice?TEAL:'#991B1B'}}>
                      {parseFloat(valuationForm.marketValue)>prop.purchasePrice?'+':''}{((parseFloat(valuationForm.marketValue)-prop.purchasePrice)/prop.purchasePrice*100).toFixed(1)}%
                      (${fmt(parseFloat(valuationForm.marketValue)-prop.purchasePrice)})
                    </strong></span>
                  </div>
                )}
                <button onClick={()=>handleAction('ADD_VALUATION',{propertyGroupId:prop.id,...valuationForm,marketValue:parseFloat(valuationForm.marketValue)})}
                  disabled={saving||!valuationForm.marketValue}
                  style={{marginTop:'10px',padding:'8px 18px',background:saving?'#94A3B8':TEAL,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                  {saving?'⏳ Saving...':'📊 Record Valuation'}
                </button>
              </div>

              {!prop.valuations?.length ? (
                <div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}><div style={{fontSize:'32px',marginBottom:'8px'}}>📊</div><p>No valuations recorded.</p></div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                  {prop.valuations.map((v: any,i: number)=>(
                    <div key={v.id} style={{background:i===0?'#F0FDF4':'#F8FAFC',borderRadius:'10px',padding:'12px 16px',border:`1px solid ${i===0?'#BBF7D0':'#E2E8F0'}`,display:'flex',alignItems:'center',gap:'14px'}}>
                      {i===0&&<span style={{fontSize:'11px',background:'#0F6E56',color:'white',padding:'2px 8px',borderRadius:'4px',flexShrink:0}}>LATEST</span>}
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                          <span style={{fontSize:'16px',fontWeight:'700',color:NAVY}}>${fmt(v.marketValue)}</span>
                          {prop.purchasePrice>0&&<span style={{fontSize:'11px',color:v.marketValue>prop.purchasePrice?TEAL:'#991B1B',fontWeight:'600'}}>
                            {v.marketValue>prop.purchasePrice?'↑':v.marketValue<prop.purchasePrice?'↓':'='} {((v.marketValue-prop.purchasePrice)/prop.purchasePrice*100).toFixed(1)}% vs purchase
                          </span>}
                        </div>
                        <div style={{fontSize:'11px',color:'#94A3B8',marginTop:'2px'}}>
                          {new Date(v.valuationDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}
                          {v.valuedBy&&` · ${v.valuedBy}`} {v.method&&`(${v.method.replace('_',' ')})`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          {tab==='actions' && (
            <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
              <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'18px'}}>
                <h4 style={{fontSize:'14px',fontWeight:'600',color:NAVY,margin:'0 0 14px'}}>⚙️ Update Property Status</h4>

                {prop.status==='FUNDING'&&(
                  <div style={{marginBottom:'16px',background:'#F0FDF4',borderRadius:'10px',padding:'14px',border:'1px solid #BBF7D0'}}>
                    <div style={{fontSize:'13px',fontWeight:'600',color:NAVY,marginBottom:'10px'}}>Mark as Acquired</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'10px'}}>
                      <div>
                        <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Purchase Date</label>
                        <input type="date" value={statusForm.purchaseDate} onChange={e=>setStatusForm(f=>({...f,purchaseDate:e.target.value}))}
                          style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
                      </div>
                      <div>
                        <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Purchase Price ($)</label>
                        <input type="number" value={statusForm.purchasePrice} onChange={e=>setStatusForm(f=>({...f,purchasePrice:e.target.value}))} placeholder="0.00"
                          style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
                      </div>
                    </div>
                    <button onClick={()=>handleAction('UPDATE_STATUS',{propertyGroupId:prop.id,status:'ACQUIRED',...statusForm,purchasePrice:statusForm.purchasePrice?parseFloat(statusForm.purchasePrice):undefined})}
                      disabled={saving} style={{padding:'8px 18px',background:PURPLE,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>🏠 Mark as Acquired</button>
                  </div>
                )}

                {prop.status==='ACQUIRED'&&(
                  <button onClick={()=>handleAction('UPDATE_STATUS',{propertyGroupId:prop.id,status:'RENTING'})}
                    disabled={saving} style={{padding:'9px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer',marginBottom:'10px'}}>🔑 Mark as Renting</button>
                )}

                {['ACQUIRED','RENTING'].includes(prop.status)&&(
                  <div style={{background:'#FEF9C3',borderRadius:'10px',padding:'14px',border:'1px solid #FCD34D'}}>
                    <div style={{fontSize:'13px',fontWeight:'600',color:'#854D0E',marginBottom:'10px'}}>💰 Record Sale</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'10px'}}>
                      <div>
                        <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Sale Date</label>
                        <input type="date" value={statusForm.soldAt} onChange={e=>setStatusForm(f=>({...f,soldAt:e.target.value}))}
                          style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
                      </div>
                      <div>
                        <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px'}}>Sale Price ($)</label>
                        <input type="number" value={statusForm.salePrice} onChange={e=>setStatusForm(f=>({...f,salePrice:e.target.value}))} placeholder="0.00"
                          style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
                      </div>
                    </div>
                    {statusForm.salePrice&&prop.purchasePrice>0&&(
                      <div style={{fontSize:'12px',color:'#854D0E',marginBottom:'10px'}}>
                        Capital gain: <strong>{parseFloat(statusForm.salePrice)>prop.purchasePrice?'+':''}{((parseFloat(statusForm.salePrice)-prop.purchasePrice)/prop.purchasePrice*100).toFixed(1)}%</strong>
                        {' '}(${fmt(parseFloat(statusForm.salePrice)-prop.purchasePrice)})
                      </div>
                    )}
                    <button onClick={()=>handleAction('UPDATE_STATUS',{propertyGroupId:prop.id,status:'SOLD',salePrice:parseFloat(statusForm.salePrice),soldAt:statusForm.soldAt})}
                      disabled={saving||!statusForm.salePrice} style={{padding:'8px 18px',background:'#854D0E',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>✅ Mark as Sold</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Version Badge (remove before production) ─────────────────
function VersionBadge({ label, ver }: { label: string; ver: string }) {
  return (
    <div style={{ position:'fixed', bottom:'12px', right:'12px', background:'rgba(13,33,55,0.9)', color:'white', fontSize:'10px', padding:'4px 10px', borderRadius:'999px', zIndex:9998, fontFamily:'monospace', display:'flex', alignItems:'center', gap:'6px', pointerEvents:'none' }}>
      <span style={{ opacity:0.5 }}>DEV</span>
      <span style={{ opacity:0.8 }}>{label}</span>
      <span style={{ background:'#0F6E56', padding:'1px 6px', borderRadius:'999px', fontWeight:'700' }}>{ver}</span>
    </div>
  )
}

export default function PropertyPage() {
  const [data, setData]       = useState<any>(null)
  const [groups, setGroups]   = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast]     = useState<any>(null)
  const [showCreate, setShowCreate]   = useState(false)
  const [selectedId, setSelectedId]   = useState<string|null>(null)
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [filterType, setFilterType]   = useState('ALL')
  const [search, setSearch]           = useState('')

  function showToast(msg: string, type='success') { setToast({msg,type}) }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, gRes] = await Promise.all([fetch('/api/property'), fetch('/api/groups')])
      const [pData, gData] = await Promise.all([pRes.json(), gRes.json()])
      if (pData.success) setData(pData.data)
      if (gData.success) {
        setGroups(gData.data)
        const allMembers: any[] = []
        for (const g of gData.data) {
          const mRes  = await fetch(`/api/members?groupId=${g.id}`)
          const mData = await mRes.json()
          if (mData.success) allMembers.push(...(mData.data||[]).map((m:any)=>({...m,groupId:g.id})))
        }
        setMembers(allMembers)
      }
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(()=>{ fetchData() },[fetchData])

  const properties = data?.properties || []
  const filtered = properties.filter((p: any) => {
    const ms  = (p.name||'').toLowerCase().includes(search.toLowerCase()) || (p.propertyAddress||'').toLowerCase().includes(search.toLowerCase())
    const mst = filterStatus==='ALL' || p.status===filterStatus
    const mt  = filterType==='ALL' || p.propertyType===filterType
    return ms&&mst&&mt
  })

  const TYPES = ['residential','commercial','agricultural','industrial','mixed']

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'20px'}}>
      <VersionBadge label="🏠 Property" ver="v1.1" />

      <VersionBadge label="🏠 Property" ver="v1.1" />
      {toast&&<Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
      {showCreate&&<CreatePropertyModal groups={groups} onClose={()=>setShowCreate(false)} onSuccess={(msg:string)=>{showToast(msg);fetchData()}}/>}
      {selectedId&&<PropertyDetail propertyId={selectedId} members={members} onClose={()=>setSelectedId(null)} onAction={(msg:string,type='success')=>{showToast(msg,type);fetchData()}}/>}

      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <h2 style={{fontSize:'20px',fontWeight:'700',color:NAVY,margin:'0 0 4px'}}>🏠 Property Investments</h2>
          <p style={{fontSize:'13px',color:'#64748B',margin:0}}>Manage group property investments, rental income, and capital growth</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button onClick={fetchData} style={{padding:'8px 12px',background:'#F1F5F9',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'12px',cursor:'pointer',color:'#475569'}}>↻</button>
          <button onClick={()=>setShowCreate(true)} style={{padding:'10px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Add Property</button>
        </div>
      </div>

      {/* KPIs */}
      {!loading&&data&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px'}}>
          {[
            {label:'Total Properties',value:data.summary.total,                          color:NAVY,   icon:'🏠'},
            {label:'Funding',          value:data.summary.funding,                       color:'#1A5EA8',icon:'💰'},
            {label:'Renting',          value:data.summary.renting,                      color:TEAL,   icon:'🔑'},
            {label:'Portfolio Value',  value:fmtK(data.summary.totalValue),              color:PURPLE, icon:'📈'},
            {label:'Total Rental Income',value:fmtK(data.summary.totalIncome),          color:'#166534',icon:'💵'},
          ].map(s=>(
            <div key={s.label} style={{background:'white',borderRadius:'10px',padding:'14px',border:'1px solid #E2E8F0'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'6px'}}>
                <span style={{fontSize:'11px',color:'#64748B'}}>{s.label}</span>
                <span style={{fontSize:'18px'}}>{s.icon}</span>
              </div>
              <div style={{fontSize:'22px',fontWeight:'700',color:s.color}}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'center'}}>
        <input placeholder="Search by name or address..." value={search} onChange={e=>setSearch(e.target.value)}
          style={{padding:'8px 14px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',width:'240px',outline:'none'}}/>
        <div style={{display:'flex',gap:'6px'}}>
          {['ALL','FUNDING','ACQUIRED','RENTING','SOLD'].map(s=>(
            <button key={s} onClick={()=>setFilterStatus(s)} style={{padding:'5px 12px',borderRadius:'999px',fontSize:'11px',fontWeight:'500',cursor:'pointer',background:filterStatus===s?NAVY:'white',color:filterStatus===s?'white':'#64748B',border:filterStatus===s?'none':'1.5px solid #E2E8F0',whiteSpace:'nowrap'}}>
              {s==='ALL'?'All Statuses':STATUS_META[s]?.label||s}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:'6px'}}>
          {['ALL',...TYPES].map(t=>(
            <button key={t} onClick={()=>setFilterType(t)} style={{padding:'5px 12px',borderRadius:'999px',fontSize:'11px',fontWeight:'500',cursor:'pointer',background:filterType===t?TEAL:'white',color:filterType===t?'white':'#64748B',border:filterType===t?'none':'1.5px solid #E2E8F0',whiteSpace:'nowrap'}}>
              {t==='ALL'?'All Types':`${TYPE_ICONS[t]||''} ${t.charAt(0).toUpperCase()+t.slice(1)}`}
            </button>
          ))}
        </div>
      </div>

      {/* Property grid */}
      {loading?(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}>
          <div style={{fontSize:'32px',marginBottom:'10px'}}>⏳</div><p style={{color:'#64748B'}}>Loading properties...</p>
        </div>
      ):filtered.length===0?(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}>
          <div style={{fontSize:'48px',marginBottom:'16px'}}>🏠</div>
          <h3 style={{fontSize:'16px',fontWeight:'600',color:NAVY,margin:'0 0 8px'}}>{properties.length===0?'No properties yet':'No properties match your filter'}</h3>
          <p style={{color:'#64748B',fontSize:'13px',marginBottom:'20px'}}>Add your first group property investment to get started.</p>
          {properties.length===0&&<button onClick={()=>setShowCreate(true)} style={{padding:'10px 20px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Add First Property</button>}
        </div>
      ):(
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:'16px'}}>
          {filtered.map((p: any)=>{
            const sm = STATUS_META[p.status]||STATUS_META.FUNDING
            const annYield = p.monthlyRental>0&&p.currentValue>0 ? ((p.monthlyRental*12)/p.currentValue*100).toFixed(1) : null
            return (
              <div key={p.id} onClick={()=>setSelectedId(p.id)}
                style={{background:'white',borderRadius:'14px',border:'1px solid #E2E8F0',overflow:'hidden',cursor:'pointer',transition:'all 0.15s',boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}
                onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.boxShadow='0 8px 24px rgba(0,0,0,0.1)';(e.currentTarget as HTMLElement).style.transform='translateY(-2px)'}}
                onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.boxShadow='0 1px 4px rgba(0,0,0,0.04)';(e.currentTarget as HTMLElement).style.transform='translateY(0)'}}>
                {/* Card header */}
                <div style={{background:`linear-gradient(135deg,${NAVY},#1A4A6B)`,padding:'16px 18px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'8px'}}>
                    <span style={{fontSize:'28px'}}>{TYPE_ICONS[p.propertyType||'residential']}</span>
                    <StatusPill status={p.status}/>
                  </div>
                  <div style={{fontSize:'15px',fontWeight:'700',color:'white',marginBottom:'2px'}}>{p.name}</div>
                  {p.propertyAddress&&<div style={{fontSize:'11px',color:'rgba(255,255,255,0.6)',marginBottom:'4px'}}>📍 {p.propertyAddress}</div>}
                  <div style={{fontSize:'11px',color:'rgba(255,255,255,0.5)'}}>{p.groupName} · {p.stakeCount} investor{p.stakeCount!==1?'s':''}</div>
                </div>
                {/* Funding progress */}
                {p.status==='FUNDING'&&(
                  <div style={{padding:'8px 18px',borderBottom:'1px solid #F1F5F9',background:'#F8FAFC'}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',color:'#64748B',marginBottom:'4px'}}>
                      <span>Funding progress</span><span style={{fontWeight:'600'}}>{p.fundingPct}%</span>
                    </div>
                    <div style={{height:'6px',background:'#E2E8F0',borderRadius:'3px',overflow:'hidden'}}>
                      <div style={{height:'100%',background:TEAL,borderRadius:'3px',width:`${p.fundingPct}%`}}/>
                    </div>
                    <div style={{fontSize:'10px',color:'#94A3B8',marginTop:'3px'}}>${fmt(p.raisedCapital)} of ${fmt(p.targetCapital)}</div>
                  </div>
                )}
                {/* Metrics grid */}
                <div style={{padding:'14px 18px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px'}}>
                  {[
                    {l:'Current Value', v:fmtK(p.currentValue||p.raisedCapital), c:PURPLE},
                    {l:'Monthly Rental', v:p.monthlyRental>0?fmtK(p.monthlyRental):'—', c:TEAL},
                    {l:'Annual Yield',   v:annYield?`${annYield}%`:'—', c:'#166534'},
                    {l:'Total Income',  v:fmtK(p.totalIncome||0), c:NAVY},
                    {l:'Capital Target',v:fmtK(p.targetCapital), c:'#64748B'},
                    {l:'Type',          v:p.propertyType?.charAt(0).toUpperCase()+(p.propertyType?.slice(1)||''), c:'#475569'},
                  ].map(s=>(
                    <div key={s.l} style={{background:'#F8FAFC',borderRadius:'6px',padding:'8px 10px'}}>
                      <div style={{fontSize:'9px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em'}}>{s.l}</div>
                      <div style={{fontSize:'13px',fontWeight:'600',color:s.c,marginTop:'1px'}}>{s.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{padding:'8px 18px',borderTop:'1px solid #F1F5F9',display:'flex',justifyContent:'space-between',alignItems:'center',background:'#FAFAFA'}}>
                  <span style={{fontSize:'11px',color:'#94A3B8'}}>Click to manage</span>
                  <span style={{fontSize:'12px',color:TEAL,fontWeight:'500'}}>Open →</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
