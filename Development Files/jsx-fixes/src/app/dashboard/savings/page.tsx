'use client'
import { useState, useEffect, useCallback } from 'react'

const TEAL = '#0F6E56'; const NAVY = '#0D2137'; const PURPLE = '#7C3AED'
const GOLD = '#854D0E'; const GREEN = '#166534'; const RED = '#991B1B'

const POOL_STATUS: Record<string, any> = {
  SETUP:     { bg:'#EEF2FF', color:'#3730A3', icon:'⚙️',  label:'Setup'     },
  ACTIVE:    { bg:'#DCFCE7', color:GREEN,      icon:'▶️',  label:'Active'    },
  MATURED:   { bg:'#FEF9C3', color:GOLD,       icon:'🏁',  label:'Matured'   },
  CLOSED:    { bg:'#F1F5F9', color:'#475569',  icon:'✅',  label:'Closed'    },
  CANCELLED: { bg:'#FEE2E2', color:RED,        icon:'🚫',  label:'Cancelled' },
}

const LOAN_STATUS: Record<string, any> = {
  PENDING_APPROVAL: { bg:'#FEF9C3', color:GOLD,    label:'Pending'   },
  APPROVED:         { bg:'#F3E8FF', color:'#6B21A8',label:'Approved'  },
  ACTIVE:           { bg:'#DCFCE7', color:GREEN,   label:'Active'    },
  SETTLED:          { bg:'#F0FDF4', color:'#14532D',label:'Settled'   },
  REJECTED:         { bg:'#FEE2E2', color:RED,      label:'Rejected'  },
}

const FREQ_LABELS: Record<string, string> = {
  WEEKLY:'Weekly', FORTNIGHTLY:'Fortnightly', MONTHLY:'Monthly'
}

const fmt  = (n: number) => new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)
const fmtK = (n: number) => n>=1000000?`$${(n/1000000).toFixed(2)}M`:n>=1000?`$${(n/1000).toFixed(0)}K`:`$${fmt(n)}`

// ── Reusable helpers ──────────────────────────────────────────
function Toast({ msg, type, onClose }: any) {
  useEffect(()=>{ const t=setTimeout(onClose,5000); return()=>clearTimeout(t) },[onClose])
  return <div style={{position:'fixed',top:'20px',right:'20px',zIndex:9999,padding:'12px 20px',borderRadius:'10px',fontWeight:'500',fontSize:'13px',boxShadow:'0 8px 25px rgba(0,0,0,0.15)',background:type==='success'?'#166534':'#991B1B',color:'white',display:'flex',alignItems:'center',gap:'10px',maxWidth:'440px'}}>
    <span>{type==='success'?'✅':'❌'}</span><span style={{flex:1}}>{msg}</span>
    <button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'18px'}}>×</button>
  </div>
}

function Pill({ bg, color, children }: any) {
  return <span style={{background:bg,color,fontSize:'11px',fontWeight:'600',padding:'3px 9px',borderRadius:'999px',display:'inline-flex',alignItems:'center',gap:'4px',whiteSpace:'nowrap'}}>{children}</span>
}

function KpiCard({ icon, label, value, sub, color }: any) {
  return <div style={{background:'white',borderRadius:'10px',padding:'14px',border:'1px solid #E2E8F0'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'6px'}}>
      <span style={{fontSize:'11px',color:'#64748B'}}>{label}</span>
      <span style={{fontSize:'20px'}}>{icon}</span>
    </div>
    <div style={{fontSize:'22px',fontWeight:'700',color:color||NAVY}}>{value}</div>
    {sub&&<div style={{fontSize:'11px',color:'#94A3B8',marginTop:'2px'}}>{sub}</div>}
  </div>
}

// ── Create Pool Modal ─────────────────────────────────────────
function CreatePoolModal({ groups, members, onClose, onSuccess }: any) {
  const [form, setForm] = useState({
    groupId:'', name:'', description:'', periodMonths:'12',
    contributionAmount:'', contributionFrequency:'MONTHLY',
    startDate:new Date().toISOString().split('T')[0],
    interestRatePa:'24', maxLoanPct:'50', allowLoans:true, notes:'',
    memberIds:[] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [step, setStep]     = useState(1)
  const set = (k: string) => (v: any) => setForm(p=>({...p,[k]:v}))

  const periodCount = form.contributionFrequency==='WEEKLY'?Math.ceil(parseInt(form.periodMonths||'12')*4.33)
    :form.contributionFrequency==='FORTNIGHTLY'?Math.ceil(parseInt(form.periodMonths||'12')*2.17)
    :parseInt(form.periodMonths||'12')
  const totalPerMember = parseFloat(form.contributionAmount||'0') * periodCount
  const maturityDate   = new Date(form.startDate)
  maturityDate.setMonth(maturityDate.getMonth() + parseInt(form.periodMonths||'12'))
  const groupMembers   = members.filter((m: any)=>m.groupId===form.groupId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const payload = {
        groupId:               form.groupId,
        name:                  form.name,
        description:           form.description || undefined,
        periodMonths:          parseInt(form.periodMonths),
        contributionAmount:    parseFloat(form.contributionAmount),
        contributionFrequency: form.contributionFrequency,
        startDate:             form.startDate,
        interestRatePa:        parseFloat(form.interestRatePa) / 100,
        maxLoanPct:            parseFloat(form.maxLoanPct) / 100,
        allowLoans:            form.allowLoans,
        notes:                 form.notes || undefined,
        memberIds:             form.memberIds.filter(Boolean),
      }
      const res  = await fetch('/api/savings', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload) })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error||'Failed')
    } catch { setError('Network error') } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
      <div style={{background:'white',borderRadius:'16px',width:'100%',maxWidth:'600px',maxHeight:'92vh',overflowY:'auto',boxShadow:'0 25px 50px rgba(0,0,0,0.3)'}}>

        {/* Modal header */}
        <div style={{background:`linear-gradient(135deg,${NAVY},${TEAL})`,padding:'20px 24px',borderRadius:'16px 16px 0 0'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <h3 style={{fontSize:'16px',fontWeight:'700',color:'white',margin:'0 0 2px'}}>💰 New Savings Pool</h3>
              <p style={{fontSize:'12px',color:'rgba(255,255,255,0.6)',margin:0}}>Step {step} of 3 — {step===1?'Basic Setup':step===2?'Loan Settings':'Members'}</p>
            </div>
            <button onClick={onClose} style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px',color:'white'}}>×</button>
          </div>
          {/* Step indicator */}
          <div style={{display:'flex',gap:'6px',marginTop:'12px'}}>
            {[1,2,3].map(s=><div key={s} style={{flex:1,height:'4px',borderRadius:'2px',background:s<=step?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.2)'}}/>)}
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{padding:'22px 24px'}}>
          {/* ── Step 1: Basic Setup ── */}
          {step===1&&<>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Group *</label>
                <select value={form.groupId} onChange={e=>set('groupId')(e.target.value)} required
                  style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as any}}>
                  <option value="">Select group...</option>
                  {groups.map((g:any)=><option key={g.id} value={g.id}>{g.name} ({g.currency})</option>)}
                </select>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Pool Name *</label>
                <input type="text" value={form.name} onChange={e=>set('name')(e.target.value)} required placeholder="e.g. 2025 Annual Savings Pool"
                  style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Period Length *</label>
                <select value={form.periodMonths} onChange={e=>set('periodMonths')(e.target.value)}
                  style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as any}}>
                  {[6,12,18,24,30,36,48,60].map(m=><option key={m} value={m}>{m} months {m===12?'(1 year)':m===24?'(2 years)':m===36?'(3 years)':''}</option>)}
                </select>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Contribution Frequency *</label>
                <select value={form.contributionFrequency} onChange={e=>set('contributionFrequency')(e.target.value)}
                  style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as any}}>
                  <option value="WEEKLY">Weekly</option>
                  <option value="FORTNIGHTLY">Fortnightly (every 2 weeks)</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Contribution Amount ($) *</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:'10px',top:'50%',transform:'translateY(-50%)',color:'#64748B'}}>$</span>
                  <input type="number" step="0.01" value={form.contributionAmount} onChange={e=>set('contributionAmount')(e.target.value)} required placeholder="0.00"
                    style={{width:'100%',padding:'9px 10px 9px 24px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'14px',fontWeight:'600',outline:'none',boxSizing:'border-box' as any}}/>
                </div>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Start Date *</label>
                <input type="date" value={form.startDate} onChange={e=>set('startDate')(e.target.value)} required
                  style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/>
              </div>
            </div>
            {/* Summary card */}
            {parseFloat(form.contributionAmount||'0')>0&&<div style={{background:'#F0FDF4',borderRadius:'10px',padding:'14px',marginTop:'14px',border:'1px solid #BBF7D0'}}>
              <div style={{fontSize:'12px',fontWeight:'600',color:GREEN,marginBottom:'8px'}}>📊 Pool Preview</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px',fontSize:'12px'}}>
                {[
                  ['Payment periods', periodCount.toString()],
                  ['Per member total', `$${fmt(totalPerMember)}`],
                  ['Matures on', maturityDate.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})],
                ].map(([l,v])=><div key={l} style={{background:'white',borderRadius:'6px',padding:'8px'}}>
                  <div style={{fontSize:'10px',color:'#94A3B8',marginBottom:'2px'}}>{l}</div>
                  <div style={{fontWeight:'700',color:NAVY}}>{v}</div>
                </div>)}
              </div>
            </div>}
          </>}

          {/* ── Step 2: Loan Settings ── */}
          {step===2&&<>
            <div style={{marginBottom:'16px'}}>
              <div onClick={()=>set('allowLoans')(!form.allowLoans)}
                style={{display:'flex',alignItems:'center',gap:'12px',padding:'14px',borderRadius:'10px',border:`2px solid ${form.allowLoans?TEAL:'#E2E8F0'}`,background:form.allowLoans?'#F0FDF4':'#F8FAFC',cursor:'pointer'}}>
                <div style={{width:'22px',height:'22px',borderRadius:'6px',border:`2px solid ${form.allowLoans?TEAL:'#CBD5E1'}`,background:form.allowLoans?TEAL:'white',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  {form.allowLoans&&<span style={{color:'white',fontSize:'14px'}}>✓</span>}
                </div>
                <div>
                  <div style={{fontSize:'13px',fontWeight:'600',color:NAVY}}>Enable member loans from this pool</div>
                  <div style={{fontSize:'12px',color:'#64748B'}}>Members can borrow up to a set % of the pool. Interest flows back into the pool, growing everyone's payout.</div>
                </div>
              </div>
            </div>
            {form.allowLoans&&<>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'14px'}}>
                <div>
                  <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Interest Rate (% p.a.)</label>
                  <div style={{position:'relative'}}>
                    <input type="number" step="1" value={form.interestRatePa} onChange={e=>set('interestRatePa')(e.target.value)} placeholder="24"
                      style={{width:'100%',padding:'9px 28px 9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/>
                    <span style={{position:'absolute',right:'10px',top:'50%',transform:'translateY(-50%)',color:'#64748B',fontSize:'12px'}}>%</span>
                  </div>
                  <p style={{fontSize:'11px',color:'#94A3B8',margin:'4px 0 0'}}>Interest earned grows everyone's payout</p>
                </div>
                <div>
                  <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Max Loan (% of pool)</label>
                  <div style={{position:'relative'}}>
                    <input type="number" step="5" value={form.maxLoanPct} onChange={e=>set('maxLoanPct')(e.target.value)} placeholder="50"
                      style={{width:'100%',padding:'9px 28px 9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/>
                    <span style={{position:'absolute',right:'10px',top:'50%',transform:'translateY(-50%)',color:'#64748B',fontSize:'12px'}}>%</span>
                  </div>
                  <p style={{fontSize:'11px',color:'#94A3B8',margin:'4px 0 0'}}>Cap per loan application</p>
                </div>
              </div>
              <div style={{background:'#EEF2FF',borderRadius:'8px',padding:'12px 14px',fontSize:'12px',color:'#3730A3',border:'1px solid #C7D2FE'}}>
                💡 At payout time, any outstanding loan balance is <strong>deducted</strong> from the member's share before they receive their distribution.
              </div>
            </>}
            {!form.allowLoans&&<div style={{background:'#F8FAFC',borderRadius:'8px',padding:'14px',fontSize:'13px',color:'#64748B',textAlign:'center',border:'1px dashed #E2E8F0'}}>
              Loans are disabled. Members cannot borrow from this pool.
            </div>}
          </>}

          {/* ── Step 3: Members ── */}
          {step===3&&<>
            <p style={{fontSize:'13px',color:'#64748B',marginBottom:'14px',lineHeight:'1.6'}}>
              Select members to enrol in this pool. You can also add members later from the pool dashboard. Members can only be from the selected group.
            </p>
            {!form.groupId&&<div style={{background:'#FEF9C3',borderRadius:'8px',padding:'12px',color:GOLD,fontSize:'13px',marginBottom:'12px'}}>⚠️ Select a group in Step 1 first.</div>}
            {form.groupId&&groupMembers.length===0&&<div style={{background:'#F8FAFC',borderRadius:'8px',padding:'24px',textAlign:'center',color:'#94A3B8',fontSize:'13px'}}>No members found for this group.</div>}
            {form.groupId&&groupMembers.length>0&&<>
              {(() => {
                const groupMemberIds = groupMembers.map((m:any)=>m.userId)
                const allSelected = groupMemberIds.length > 0 && groupMemberIds.every((id:string)=>form.memberIds.includes(id))
                return (
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:'8px',fontSize:'12px'}}>
                    <span style={{color:'#64748B'}}>{form.memberIds.filter((id:string)=>groupMemberIds.includes(id)).length} of {groupMembers.length} selected</span>
                    <button type="button" onClick={()=>set('memberIds')(allSelected?form.memberIds.filter((id:string)=>!groupMemberIds.includes(id)):[...new Set([...form.memberIds,...groupMemberIds])])}
                      style={{color:TEAL,background:'none',border:'none',cursor:'pointer',fontWeight:'600'}}>
                      {allSelected?'Deselect all':'Select all'}
                    </button>
                  </div>
                )
              })()}
              <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                {groupMembers.map((m:any)=>{
                  const sel = form.memberIds.includes(m.userId)
                  return <div key={m.userId} onClick={()=>{ const next = sel ? form.memberIds.filter((id:string)=>id!==m.userId) : [...form.memberIds, m.userId]; set('memberIds')(next) }}
                    style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 12px',borderRadius:'8px',border:`1.5px solid ${sel?TEAL:'#E2E8F0'}`,background:sel?'#F0FDF4':'white',cursor:'pointer'}}>
                    <div style={{width:'20px',height:'20px',borderRadius:'4px',border:`2px solid ${sel?TEAL:'#CBD5E1'}`,background:sel?TEAL:'white',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      {sel&&<span style={{color:'white',fontSize:'12px',fontWeight:'700'}}>✓</span>}
                    </div>
                    <div style={{width:'32px',height:'32px',borderRadius:'50%',background:sel?'#DCFCE7':'#F1F5F9',color:sel?TEAL:'#94A3B8',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:'700',flexShrink:0}}>
                      {(m.fullName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:'13px',fontWeight:'500',color:NAVY}}>{m.fullName}</div>
                      <div style={{fontSize:'11px',color:'#94A3B8'}}>{m.email}</div>
                    </div>
                  </div>
                })}
              </div>
              {parseFloat(form.contributionAmount||'0')>0&&form.memberIds.length>0&&<div style={{background:'#F0FDF4',borderRadius:'8px',padding:'10px 14px',marginTop:'10px',fontSize:'12px',color:GREEN,border:'1px solid #BBF7D0'}}>
                📊 Total pool at maturity: <strong>${fmt(totalPerMember * form.memberIds.length)}</strong> ({form.memberIds.length} members × ${fmt(totalPerMember)} each)
              </div>}
            </>}
          </>}

          <div>
            <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Notes</label>
            <textarea value={form.notes} onChange={e=>set('notes')(e.target.value)} rows={2} placeholder="Any additional notes..."
              style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any,resize:'vertical' as any}}/>
          </div>

          {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',margin:'12px 0 0'}}>❌ {error}</div>}

          <div style={{display:'flex',gap:'10px',marginTop:'16px'}}>
            {step>1&&<button type="button" onClick={()=>setStep(s=>s-1)} style={{padding:'10px 16px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>← Back</button>}
            <button type="button" onClick={onClose} style={{padding:'10px 14px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
            {step<3&&<button type="button" onClick={()=>setStep(s=>s+1)} disabled={step===1&&(!form.groupId||!form.name||!form.contributionAmount)}
              style={{flex:1,padding:'10px',background:step===1&&(!form.groupId||!form.name||!form.contributionAmount)?'#CBD5E1':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
              Continue →
            </button>}
            {step===3&&<button type="submit" disabled={saving}
              style={{flex:1,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white'}}>
              {saving?'⏳ Creating...':'💰 Create Pool'}
            </button>}
          </div>
        </form>
      </div>
    </div>  )
}

// ── Pool Detail ───────────────────────────────────────────────
function PoolDetail({ poolId, allMembers, adminId, onClose, onAction }: any) {
  const [pool, setPool]   = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]     = useState<'dashboard'|'contributions'|'loans'|'members'|'payouts'>('dashboard')
  const [contribs, setContribs] = useState<any>(null)
  const [loans, setLoans]       = useState<any[]>([])
  const [saving, setSaving]     = useState(false)
  const [loanForm, setLoanForm] = useState({ borrowerId:'', amount:'', termMonths:'6', purpose:'' })
  const [repayTarget, setRepayTarget] = useState<any>(null)
  const [repayAmount, setRepayAmount] = useState('')
  const [addMemberId, setAddMemberId] = useState('')
  const [payRef, setPayRef]     = useState('')
  const [search, setSearch]     = useState('')

  const fetchPool = useCallback(async () => {
    const res = await fetch(`/api/savings?poolId=${poolId}`)
    const d   = await res.json()
    if (d.success) setPool(d.data)
    setLoading(false)
  }, [poolId])

  const fetchContribs = useCallback(async () => {
    const res = await fetch(`/api/savings/contributions?poolId=${poolId}`)
    const d   = await res.json()
    if (d.success) setContribs(d.data)
  }, [poolId])

  const fetchLoans = useCallback(async () => {
    const res = await fetch(`/api/savings/loans?poolId=${poolId}`)
    const d   = await res.json()
    if (d.success) setLoans(d.data)
  }, [poolId])

  useEffect(()=>{ fetchPool() },[fetchPool])
  useEffect(()=>{ if(tab==='contributions') fetchContribs() },[tab,fetchContribs])
  useEffect(()=>{ if(tab==='loans') fetchLoans() },[tab,fetchLoans])

  async function doAction(action: string, payload: any, url='/api/savings') {
    setSaving(true)
    try {
      const res  = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})})
      const d    = await res.json()
      if (d.success) { onAction(d.message); fetchPool(); if(tab==='contributions') fetchContribs(); if(tab==='loans') fetchLoans() }
      else onAction(d.error||'Failed','error')
    } catch { onAction('Network error','error') } finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
      <div style={{background:'white',borderRadius:'16px',padding:'40px',textAlign:'center'}}><div style={{fontSize:'32px',marginBottom:'12px'}}>⏳</div>Loading pool...</div>
    </div>
  )
  if (!pool) return null

  const sm       = POOL_STATUS[pool.status]||POOL_STATUS.SETUP
  const nonMembers = allMembers.filter((m:any)=>m.groupId===pool.groupId&&!pool.members?.find((pm:any)=>pm.userId===m.userId))
  const poolMembers = pool.members||[]
  const now      = new Date()
  const daysLeft = pool.daysLeft
  const canActivate = pool.status==='SETUP' && poolMembers.length>0
  const canMature   = pool.status==='ACTIVE' && new Date(pool.maturityDate)<=now
  const canDistrib  = pool.status==='MATURED'

  // Filter contributions
  const filteredContribs = (contribs?.contributions||[]).filter((c:any)=>
    !search || c.memberName.toLowerCase().includes(search.toLowerCase())
  )

  // Group contributions by period
  const byPeriod: Record<number,any[]> = {}
  filteredContribs.forEach((c:any)=>{ if(!byPeriod[c.periodNumber]) byPeriod[c.periodNumber]=[]; byPeriod[c.periodNumber].push(c) })

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'16px'}}>
      <div style={{background:'white',borderRadius:'16px',width:'100%',maxWidth:'820px',maxHeight:'95vh',display:'flex',flexDirection:'column',boxShadow:'0 25px 60px rgba(0,0,0,0.3)',overflow:'hidden'}}>

        {/* Header */}
        <div style={{background:`linear-gradient(135deg,${NAVY},#1A4A6B)`,padding:'20px 24px',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:'14px'}}>
            <div style={{width:'46px',height:'46px',borderRadius:'12px',background:'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',flexShrink:0}}>💰</div>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'2px'}}>
                <span style={{fontSize:'16px',fontWeight:'700',color:'white'}}>{pool.name}</span>
                <Pill bg={sm.bg} color={sm.color}>{sm.icon} {sm.label}</Pill>
                <span style={{fontSize:'11px',color:'rgba(255,255,255,0.5)'}}>{pool.groupName}</span>
              </div>
              <div style={{fontSize:'12px',color:'rgba(255,255,255,0.6)'}}>
                {FREQ_LABELS[pool.contributionFrequency]} · ${fmt(pool.contributionAmount)}/period · {pool.periodMonths} months
                {pool.allowLoans&&<span style={{marginLeft:'8px'}}>· Loans at {pool.interestRatePct}% p.a.</span>}
              </div>
            </div>
            <button onClick={onClose} style={{width:'32px',height:'32px',background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'18px',color:'white'}}>×</button>
          </div>

          {/* KPI strip */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px',marginTop:'14px',paddingTop:'12px',borderTop:'1px solid rgba(255,255,255,0.1)'}}>
            {[
              {l:'Pool Value',     v:fmtK(pool.totalPoolValue),    c:'#9FE1CB'},
              {l:'Contributed',   v:fmtK(pool.totalContributed),  c:'white'  },
              {l:'Interest Earned',v:fmtK(pool.totalInterestEarned),c:'#9FE1CB'},
              {l:'Members',       v:poolMembers.length,            c:'white'  },
              {l:pool.status==='ACTIVE'?'Days Left':'Period',
               v:pool.status==='ACTIVE'?`${daysLeft}d`:`${pool.periodMonths}mo`, c:daysLeft<30?'#FCD34D':'white'},
            ].map(s=><div key={s.l}>
              <div style={{fontSize:'9px',color:'rgba(255,255,255,0.5)',textTransform:'uppercase',letterSpacing:'0.04em'}}>{s.l}</div>
              <div style={{fontSize:'16px',fontWeight:'700',color:s.c,marginTop:'2px'}}>{s.v}</div>
            </div>)}
          </div>

          {/* Time progress */}
          {pool.status==='ACTIVE'&&<div style={{marginTop:'10px'}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',color:'rgba(255,255,255,0.5)',marginBottom:'3px'}}>
              <span>{new Date(pool.startDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
              <span style={{fontWeight:'600',color:'rgba(255,255,255,0.8)'}}>{pool.timeProgress}% elapsed</span>
              <span>{new Date(pool.maturityDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
            </div>
            <div style={{height:'6px',background:'rgba(255,255,255,0.15)',borderRadius:'3px',overflow:'hidden'}}>
              <div style={{height:'100%',background:'rgba(255,255,255,0.7)',borderRadius:'3px',width:`${pool.timeProgress}%`}}/>
            </div>
          </div>}

          {/* Action bar */}
          <div style={{display:'flex',gap:'8px',marginTop:'12px',flexWrap:'wrap'}}>
            {canActivate&&<button onClick={()=>doAction('ACTIVATE',{poolId})}
              disabled={saving} style={{padding:'6px 14px',background:TEAL,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>▶️ Activate Pool</button>}
            {canMature&&<button onClick={()=>doAction('MATURE',{poolId})}
              disabled={saving} style={{padding:'6px 14px',background:GOLD,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>🏁 Mark Matured</button>}
            {canDistrib&&<button onClick={()=>doAction('DISTRIBUTE',{poolId})}
              disabled={saving} style={{padding:'6px 14px',background:PURPLE,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>📊 Calculate Payouts</button>}
            {pool.status==='ACTIVE'&&<button onClick={()=>setTab('contributions')}
              style={{padding:'6px 14px',background:'rgba(255,255,255,0.15)',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>💸 Record Payment</button>}
            {pool.status==='ACTIVE'&&pool.allowLoans&&<button onClick={()=>setTab('loans')}
              style={{padding:'6px 14px',background:'rgba(255,255,255,0.15)',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>💳 Manage Loans</button>}
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',borderBottom:'1px solid #E2E8F0',flexShrink:0,overflowX:'auto'}}>
          {[['dashboard','📋 Dashboard'],['contributions','💸 Contributions'],['loans','💳 Loans'],['members','👥 Members'],['payouts','🎁 Payouts']].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id as any)}
              style={{padding:'10px 16px',background:'none',border:'none',borderBottom:tab===id?`2px solid ${TEAL}`:'2px solid transparent',color:tab===id?TEAL:'#64748B',fontWeight:tab===id?'600':'400',fontSize:'13px',cursor:'pointer',marginBottom:'-1px',whiteSpace:'nowrap'}}>{label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{flex:1,overflowY:'auto',padding:'18px 22px'}}>

          {/* ── Dashboard ── */}
          {tab==='dashboard'&&<div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px'}}>
              <KpiCard icon="💰" label="Total Pool Value"    value={fmtK(pool.totalPoolValue)}    color={TEAL}   sub={`$${fmt(pool.totalContributed)} contributions + $${fmt(pool.totalInterestEarned)} interest`}/>
              <KpiCard icon="📅" label="Contribution Amount" value={`$${fmt(pool.contributionAmount)}`} color={NAVY}   sub={`per member per ${FREQ_LABELS[pool.contributionFrequency].toLowerCase()} period`}/>
              <KpiCard icon="⏰" label={pool.status==='ACTIVE'?'Days to Maturity':'Duration'} value={pool.status==='ACTIVE'?`${daysLeft} days`:`${pool.periodMonths} months`} color={daysLeft<30&&pool.status==='ACTIVE'?'#991B1B':PURPLE} sub={`Matures ${new Date(pool.maturityDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`}/>
            </div>

            {/* Setup checklist */}
            {pool.status==='SETUP'&&<div style={{background:'#EEF2FF',borderRadius:'12px',padding:'16px',border:'1px solid #C7D2FE'}}>
              <div style={{fontSize:'13px',fontWeight:'600',color:'#3730A3',marginBottom:'10px'}}>📋 Setup Checklist</div>
              {[
                [true, 'Pool created with contribution schedule'],
                [poolMembers.length>0, `Members added (${poolMembers.length} enrolled)`],
                [poolMembers.length>0, 'Ready to activate'],
              ].map(([done,label],i)=><div key={i} style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px',fontSize:'13px',color:done?GREEN:'#64748B'}}>
                <span>{done?'✅':'⬜'}</span><span>{label as string}</span>
              </div>)}
              {canActivate&&<button onClick={()=>doAction('ACTIVATE',{poolId})} disabled={saving}
                style={{marginTop:'8px',padding:'8px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>▶️ Activate Now</button>}
            </div>}

            {/* Pool health indicators */}
            {pool.status==='ACTIVE'&&contribs&&<div style={{background:'#F8FAFC',borderRadius:'12px',padding:'16px',border:'1px solid #E2E8F0'}}>
              <div style={{fontSize:'13px',fontWeight:'600',color:NAVY,marginBottom:'10px'}}>📊 Collection Health</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px',marginBottom:'10px'}}>
                {[
                  {l:'Collected',   v:contribs.stats?.paid||0,    c:TEAL   },
                  {l:'Pending',     v:contribs.stats?.pending||0, c:'#1A5EA8'},
                  {l:'Overdue',     v:contribs.stats?.late||0,    c:RED    },
                  {l:'Collection %',v:`${contribs.stats?.total>0?Math.round((contribs.stats?.paid/contribs.stats?.total)*100):0}%`, c:PURPLE},
                ].map(s=><div key={s.l} style={{background:'white',borderRadius:'8px',padding:'10px',border:'1px solid #E2E8F0'}}>
                  <div style={{fontSize:'10px',color:'#94A3B8',marginBottom:'3px'}}>{s.l}</div>
                  <div style={{fontSize:'18px',fontWeight:'700',color:s.c}}>{s.v}</div>
                </div>)}
              </div>
            </div>}

            {/* Active loans summary */}
            {pool.allowLoans&&loans.length>0&&<div style={{background:'#F8FAFC',borderRadius:'12px',padding:'16px',border:'1px solid #E2E8F0'}}>
              <div style={{fontSize:'13px',fontWeight:'600',color:NAVY,marginBottom:'10px'}}>💳 Active Pool Loans</div>
              {loans.filter((l:any)=>l.status==='ACTIVE').map((l:any)=>(
                <div key={l.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',borderBottom:'1px solid #F1F5F9'}}>
                  <span style={{fontSize:'20px'}}>👤</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:'13px',fontWeight:'500',color:NAVY}}>{l.borrowerName}</div>
                    <div style={{fontSize:'11px',color:'#94A3B8'}}>{l.termMonths}mo · {l.interestRatePct}% p.a.</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:'13px',fontWeight:'700',color:'#854D0E'}}>${fmt(l.outstandingBalance)}</div>
                    <div style={{fontSize:'10px',color:'#94A3B8'}}>outstanding</div>
                  </div>
                </div>
              ))}
            </div>}

            {/* Pool details */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              {[
                ['Start Date',     new Date(pool.startDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})],
                ['Maturity Date',  new Date(pool.maturityDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})],
                ['Frequency',      FREQ_LABELS[pool.contributionFrequency]],
                ['Loans Enabled',  pool.allowLoans?`Yes — max ${(pool.maxLoanPct*100).toFixed(0)}% of pool`:'No'],
                ['Interest Rate',  pool.allowLoans?`${pool.interestRatePct}% p.a.`:'N/A'],
                ['Group',          pool.groupName],
              ].map(([l,v])=><div key={l} style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px'}}>
                <div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'3px'}}>{l}</div>
                <div style={{fontSize:'13px',fontWeight:'500',color:NAVY}}>{v}</div>
              </div>)}
            </div>
          </div>}

          {/* ── Contributions ── */}
          {tab==='contributions'&&<div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px',flexWrap:'wrap',gap:'8px'}}>
              <div style={{display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
                {contribs&&[
                  {l:'Total',   v:contribs.stats.total,       c:'#64748B'},
                  {l:'Paid',    v:contribs.stats.paid,        c:GREEN    },
                  {l:'Pending', v:contribs.stats.pending,     c:'#1A5EA8'},
                  {l:'Overdue', v:contribs.stats.late,        c:RED      },
                  {l:'Collected',v:`$${fmt(contribs.stats.totalCollected)}`, c:TEAL},
                ].map(s=><span key={s.l} style={{fontSize:'12px',color:s.c,fontWeight:'600'}}>{s.l}: {s.v}</span>)}
              </div>
              <input placeholder="Search member..." value={search} onChange={e=>setSearch(e.target.value)}
                style={{padding:'6px 12px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',width:'180px'}}/>
            </div>

            {!contribs ? <div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}>Loading contributions...</div>
            : Object.keys(byPeriod).length===0 ? (
              <div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}>
                <div style={{fontSize:'32px',marginBottom:'8px'}}>💸</div>
                <p>No contribution records. {pool.status==='SETUP'?'Activate the pool to generate the schedule.':''}</p>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                {Object.entries(byPeriod).slice(0,20).map(([period, cs]: [string, any])=>{
                  const allPaid = cs.every((c:any)=>c.status==='PAID')
                  const dueDate = cs[0]?.dueDate
                  const isOver  = cs[0]?.isOverdue
                  return <div key={period} style={{background:'white',borderRadius:'10px',border:`1px solid ${isOver?'#FECACA':allPaid?'#BBF7D0':'#E2E8F0'}`,overflow:'hidden'}}>
                    <div style={{background:isOver?'#FEF2F2':allPaid?'#F0FDF4':'#F8FAFC',padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <span style={{fontSize:'13px',fontWeight:'700',color:NAVY}}>Period #{period}</span>
                        <span style={{fontSize:'12px',color:'#64748B'}}>Due {new Date(dueDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
                        {isOver&&<span style={{fontSize:'11px',color:RED,fontWeight:'600'}}>⚠️ OVERDUE</span>}
                        {allPaid&&<span style={{fontSize:'11px',color:GREEN,fontWeight:'600'}}>✅ ALL PAID</span>}
                      </div>
                      <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                        <span style={{fontSize:'12px',color:'#64748B'}}>{cs.filter((c:any)=>c.status==='PAID').length}/{cs.length} paid</span>
                        {!allPaid&&pool.status==='ACTIVE'&&<button onClick={()=>doAction('MARK_PERIOD_COLLECTED',{poolId,periodNumber:parseInt(period)},'/api/savings/contributions')}
                          disabled={saving} style={{padding:'4px 10px',background:TEAL,color:'white',border:'none',borderRadius:'4px',fontSize:'11px',cursor:'pointer',fontWeight:'600'}}>Mark All Paid</button>}
                      </div>
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                      <tbody>
                        {cs.map((c:any)=>(
                          <tr key={c.id} style={{borderTop:'1px solid #F8FAFC'}}>
                            <td style={{padding:'9px 14px',fontSize:'13px',color:NAVY}}>{c.memberName}</td>
                            <td style={{padding:'9px 14px',fontSize:'13px',fontWeight:'600',color:TEAL}}>${fmt(c.amountDue)}</td>
                            <td style={{padding:'9px 14px'}}>
                              <span style={{background:c.status==='PAID'?'#DCFCE7':c.isOverdue?'#FEE2E2':'#F1F5F9',color:c.status==='PAID'?GREEN:c.isOverdue?RED:'#475569',fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px'}}>
                                {c.status==='PAID'?'✓ PAID':c.isOverdue?'⚠️ OVERDUE':c.status}
                              </span>
                            </td>
                            <td style={{padding:'9px 14px',fontSize:'11px',color:'#94A3B8'}}>{c.paidAt?new Date(c.paidAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'—'}</td>
                            <td style={{padding:'9px 14px'}}>
                              {c.status!=='PAID'&&pool.status==='ACTIVE'&&(
                                <button onClick={()=>doAction('WAIVE',{contributionId:c.id},'/api/savings/contributions')}
                                  style={{marginRight:'6px',padding:'3px 8px',background:'#F1F5F9',color:'#475569',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Waive</button>
                              )}
                              {c.status!=='PAID'&&pool.status==='ACTIVE'&&(
                                <button onClick={()=>doAction('RECORD',{contributionId:c.id,amountPaid:c.amountDue,paymentMethod:'ECOCASH'},'/api/savings/contributions')}
                                  style={{padding:'3px 8px',background:TEAL,color:'white',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer',fontWeight:'600'}}>Pay</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                })}
              </div>
            )}
          </div>}

          {/* ── Loans ── */}
          {tab==='loans'&&<div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
            {!pool.allowLoans&&<div style={{background:'#F8FAFC',borderRadius:'10px',padding:'24px',textAlign:'center',color:'#94A3B8'}}>
              <div style={{fontSize:'32px',marginBottom:'8px'}}>🚫</div><p>Loans are not enabled for this pool.</p>
            </div>}

            {pool.allowLoans&&<>
              {/* Apply form */}
              {pool.status==='ACTIVE'&&<div style={{background:'#F0FDF4',borderRadius:'12px',padding:'16px',border:'1px solid #BBF7D0'}}>
                <h4 style={{fontSize:'13px',fontWeight:'600',color:NAVY,margin:'0 0 12px'}}>💳 New Loan Application</h4>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'8px',marginBottom:'8px'}}>
                  <div>
                    <label style={{display:'block',fontSize:'10px',fontWeight:'600',color:'#374151',marginBottom:'3px',textTransform:'uppercase' as any}}>Borrower</label>
                    <select value={loanForm.borrowerId} onChange={e=>setLoanForm(f=>({...f,borrowerId:e.target.value}))}
                      style={{width:'100%',padding:'8px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',background:'white',boxSizing:'border-box' as any}}>
                      <option value="">Select...</option>
                      {poolMembers.map((m:any)=><option key={m.userId} value={m.userId}>{m.fullName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{display:'block',fontSize:'10px',fontWeight:'600',color:'#374151',marginBottom:'3px',textTransform:'uppercase' as any}}>Amount ($)</label>
                    <input type="number" step="0.01" value={loanForm.amount} onChange={e=>setLoanForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"
                      style={{width:'100%',padding:'8px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'13px',fontWeight:'600',outline:'none',boxSizing:'border-box' as any}}/>
                    <div style={{fontSize:'10px',color:'#94A3B8',marginTop:'2px'}}>Max: ${fmt(pool.totalPoolValue*pool.maxLoanPct)}</div>
                  </div>
                  <div>
                    <label style={{display:'block',fontSize:'10px',fontWeight:'600',color:'#374151',marginBottom:'3px',textTransform:'uppercase' as any}}>Term</label>
                    <select value={loanForm.termMonths} onChange={e=>setLoanForm(f=>({...f,termMonths:e.target.value}))}
                      style={{width:'100%',padding:'8px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',background:'white',boxSizing:'border-box' as any}}>
                      {[1,2,3,6,9,12,18,24].map(m=><option key={m} value={m}>{m}mo</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{display:'block',fontSize:'10px',fontWeight:'600',color:'#374151',marginBottom:'3px',textTransform:'uppercase' as any}}>Purpose</label>
                    <input type="text" value={loanForm.purpose} onChange={e=>setLoanForm(f=>({...f,purpose:e.target.value}))} placeholder="Reason..."
                      style={{width:'100%',padding:'8px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',boxSizing:'border-box' as any}}/>
                  </div>
                </div>
                <button onClick={()=>doAction('',{...loanForm,poolId,amount:parseFloat(loanForm.amount),termMonths:parseInt(loanForm.termMonths)},'/api/savings/loans')}
                  disabled={saving||!loanForm.borrowerId||!loanForm.amount||!loanForm.purpose}
                  style={{padding:'8px 18px',background:saving?'#94A3B8':TEAL,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                  {saving?'⏳ Submitting...':'Submit Application'}
                </button>
              </div>}

              {/* Loans table */}
              {loans.length===0?<div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}><div style={{fontSize:'32px',marginBottom:'8px'}}>💳</div><p>No loans yet.</p></div>:(
                loans.map((l:any)=>(
                  <div key={l.id} style={{background:'white',borderRadius:'10px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
                    <div style={{padding:'12px 14px',background:'#F8FAFC',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                          <span style={{fontSize:'13px',fontWeight:'600',color:NAVY}}>{l.borrowerName}</span>
                          <Pill bg={LOAN_STATUS[l.status]?.bg||'#F1F5F9'} color={LOAN_STATUS[l.status]?.color||'#475569'}>{LOAN_STATUS[l.status]?.label||l.status}</Pill>
                          {l.overdueCount>0&&<span style={{fontSize:'11px',color:RED,fontWeight:'600'}}>⚠️ {l.overdueCount} overdue</span>}
                        </div>
                        <div style={{fontSize:'12px',color:'#64748B',marginTop:'2px'}}>
                          ${fmt(l.amount)} · {l.termMonths}mo · {l.interestRatePct}% p.a. · Purpose: {l.purpose}
                        </div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:'14px',fontWeight:'700',color:l.outstandingBalance>0?'#854D0E':TEAL}}>${fmt(l.outstandingBalance)}</div>
                        <div style={{fontSize:'10px',color:'#94A3B8'}}>outstanding</div>
                      </div>
                      <div style={{display:'flex',gap:'6px'}}>
                        {l.status==='PENDING_APPROVAL'&&<>
                          <button onClick={()=>doAction('APPROVE',{loanId:l.id,approvedById:adminId},'/api/savings/loans')}
                            disabled={saving} style={{padding:'5px 10px',background:TEAL,color:'white',border:'none',borderRadius:'4px',fontSize:'11px',cursor:'pointer',fontWeight:'600'}}>Approve</button>
                          <button onClick={()=>doAction('REJECT',{loanId:l.id,reason:'Rejected'},'/api/savings/loans')}
                            disabled={saving} style={{padding:'5px 10px',background:'#FEF2F2',color:RED,border:'1px solid #FECACA',borderRadius:'4px',fontSize:'11px',cursor:'pointer'}}>Reject</button>
                        </>}
                        {l.status==='APPROVED'&&<button onClick={()=>doAction('DISBURSE',{loanId:l.id},'/api/savings/loans')}
                          disabled={saving} style={{padding:'5px 10px',background:PURPLE,color:'white',border:'none',borderRadius:'4px',fontSize:'11px',cursor:'pointer',fontWeight:'600'}}>💸 Disburse</button>}
                        {l.status==='ACTIVE'&&<button onClick={()=>{ setRepayTarget(l.repayments?.find((r:any)=>r.status!=='PAID')); setRepayAmount(l.repayments?.find((r:any)=>r.status!=='PAID')?.totalDue?.toFixed(2)||'') }}
                          style={{padding:'5px 10px',background:'#F0FDF4',color:GREEN,border:'1px solid #86EFAC',borderRadius:'4px',fontSize:'11px',cursor:'pointer',fontWeight:'600'}}>💳 Repay</button>}
                      </div>
                    </div>
                    {l.status==='ACTIVE'&&<div style={{padding:'6px 14px',background:'white'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                        <div style={{flex:1,height:'5px',background:'#F1F5F9',borderRadius:'3px',overflow:'hidden'}}>
                          <div style={{height:'100%',background:TEAL,borderRadius:'3px',width:`${l.repaymentProgress}%`}}/>
                        </div>
                        <span style={{fontSize:'11px',color:NAVY,fontWeight:'600'}}>{l.repaymentProgress}%</span>
                      </div>
                    </div>}
                  </div>
                ))
              )}
            </>}
          </div>}

          {/* ── Members ── */}
          {tab==='members'&&<div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            {/* Add member */}
            {pool.status!=='CLOSED'&&nonMembers.length>0&&<div style={{background:'#F0FDF4',borderRadius:'10px',padding:'12px 14px',border:'1px solid #BBF7D0',display:'flex',gap:'10px',alignItems:'center'}}>
              <select value={addMemberId} onChange={e=>setAddMemberId(e.target.value)}
                style={{flex:1,padding:'8px 12px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'13px',outline:'none',background:'white'}}>
                <option value="">Add a member to this pool...</option>
                {nonMembers.map((m:any)=><option key={m.userId} value={m.userId}>{m.fullName}</option>)}
              </select>
              <button onClick={()=>{ if(addMemberId) doAction('ADD_MEMBER',{poolId,userId:addMemberId}); setAddMemberId('') }}
                disabled={saving||!addMemberId}
                style={{padding:'8px 16px',background:TEAL,color:'white',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Add</button>
            </div>}

            {poolMembers.length===0?<div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}><div style={{fontSize:'32px',marginBottom:'8px'}}>👥</div><p>No members yet.</p></div>:(
              <>
                {/* Ownership progress bars */}
                <div style={{background:'#F8FAFC',borderRadius:'10px',padding:'14px',border:'1px solid #E2E8F0'}}>
                  <div style={{fontSize:'12px',fontWeight:'600',color:NAVY,marginBottom:'8px'}}>Contribution Share</div>
                  <div style={{height:'12px',background:'#F1F5F9',borderRadius:'6px',overflow:'hidden',display:'flex',marginBottom:'8px'}}>
                    {poolMembers.map((m:any,i:number)=>{
                      const colors=[TEAL,PURPLE,'#1A5EA8',GOLD,GREEN,RED,'#0891B2']
                      return <div key={m.userId} style={{height:'100%',background:colors[i%colors.length],width:`${m.sharePercentage||100/poolMembers.length}%`,transition:'width 0.5s'}} title={`${m.fullName}: ${m.sharePercentage?.toFixed(1)}%`}/>
                    })}
                  </div>
                  <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
                    {poolMembers.map((m:any,i:number)=>{
                      const colors=[TEAL,PURPLE,'#1A5EA8',GOLD,GREEN,RED,'#0891B2']
                      return <span key={m.userId} style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'11px',color:'#64748B'}}>
                        <span style={{width:'8px',height:'8px',borderRadius:'2px',background:colors[i%colors.length],display:'inline-block'}}/>
                        {m.fullName} <strong style={{color:colors[i%colors.length]}}>{(m.sharePercentage||0).toFixed(1)}%</strong>
                      </span>
                    })}
                  </div>
                </div>

                <table style={{width:'100%',borderCollapse:'collapse',background:'white',borderRadius:'10px',overflow:'hidden',border:'1px solid #E2E8F0'}}>
                  <thead><tr style={{background:'#F8FAFC'}}>
                    {['Member','Contributed','Share %','Loan Balance','Projected Payout','Joined'].map(h=>(
                      <th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {poolMembers.map((m:any,i:number)=>{
                      const grossShare = pool.totalPoolValue > 0 ? pool.totalPoolValue * (m.sharePercentage/100) : 0
                      const netPayout  = Math.max(0, grossShare - m.loanBalance)
                      return <tr key={m.userId} style={{borderBottom:'1px solid #F8FAFC',background:i%2===0?'white':'#FAFAFA'}}>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                            <div style={{width:'30px',height:'30px',borderRadius:'50%',background:'#E1F5EE',color:TEAL,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',flexShrink:0}}>
                              {(m.fullName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                            </div>
                            <div style={{fontSize:'13px',fontWeight:'500',color:NAVY}}>{m.fullName}</div>
                          </div>
                        </td>
                        <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'600',color:TEAL}}>${fmt(m.totalContributed)}</td>
                        <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'700',color:PURPLE}}>{(m.sharePercentage||0).toFixed(2)}%</td>
                        <td style={{padding:'10px 12px',fontSize:'13px',color:m.loanBalance>0?'#854D0E':'#64748B',fontWeight:m.loanBalance>0?'600':'400'}}>
                          {m.loanBalance>0?`$${fmt(m.loanBalance)}`:'—'}
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{fontSize:'13px',fontWeight:'700',color:netPayout>0?GREEN:'#94A3B8'}}>${fmt(netPayout)}</div>
                          {m.loanBalance>0&&<div style={{fontSize:'10px',color:'#94A3B8'}}>After ${fmt(m.loanBalance)} loan deduction</div>}
                        </td>
                        <td style={{padding:'10px 12px',fontSize:'11px',color:'#94A3B8'}}>{new Date(m.joinedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</td>
                      </tr>
                    })}
                  </tbody>
                  <tfoot><tr style={{background:'#F8FAFC',borderTop:'2px solid #E2E8F0'}}>
                    <td style={{padding:'10px 12px',fontSize:'12px',fontWeight:'600',color:NAVY}}>Totals</td>
                    <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'700',color:TEAL}}>${fmt(poolMembers.reduce((s:number,m:any)=>s+m.totalContributed,0))}</td>
                    <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'700',color:PURPLE}}>100%</td>
                    <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'700',color:'#854D0E'}}>${fmt(poolMembers.reduce((s:number,m:any)=>s+m.loanBalance,0))}</td>
                    <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'700',color:GREEN}}>${fmt(poolMembers.reduce((s:number,m:any)=>s+Math.max(0,pool.totalPoolValue*(m.sharePercentage/100)-m.loanBalance),0))}</td>
                    <td/>
                  </tr></tfoot>
                </table>
            </>
            )}
          </div>}

          {/* ── Payouts ── */}
          {tab==='payouts'&&<div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
            {pool.status==='ACTIVE'&&<div style={{background:'#EEF2FF',borderRadius:'10px',padding:'14px',fontSize:'13px',color:'#3730A3',border:'1px solid #C7D2FE'}}>
              ℹ️ Payouts can only be calculated after the pool matures on <strong>{new Date(pool.maturityDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</strong>.
            </div>}
            {pool.status==='MATURED'&&(!pool.payouts||pool.payouts.length===0)&&<div style={{background:'#FEF9C3',borderRadius:'10px',padding:'16px',border:'1px solid #FCD34D',textAlign:'center'}}>
              <div style={{fontSize:'32px',marginBottom:'8px'}}>🏁</div>
              <p style={{fontSize:'13px',color:GOLD,margin:'0 0 12px'}}>Pool has matured! Calculate payouts to distribute funds to members.</p>
              <button onClick={()=>doAction('DISTRIBUTE',{poolId})} disabled={saving}
                style={{padding:'10px 24px',background:PURPLE,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
                {saving?'⏳ Calculating...':'📊 Calculate Payouts'}
              </button>
            </div>}
            {pool.payouts?.length>0&&<>
              <div style={{background:'#F0FDF4',borderRadius:'10px',padding:'14px',border:'1px solid #BBF7D0',display:'flex',gap:'16px',flexWrap:'wrap'}}>
                <div><div style={{fontSize:'10px',color:'#94A3B8',marginBottom:'2px'}}>TOTAL POOL</div><div style={{fontSize:'16px',fontWeight:'700',color:NAVY}}>${fmt(pool.totalPoolValue)}</div></div>
                <div><div style={{fontSize:'10px',color:'#94A3B8',marginBottom:'2px'}}>PAID OUT</div><div style={{fontSize:'16px',fontWeight:'700',color:GREEN}}>${fmt(pool.payouts.filter((p:any)=>p.status==='PAID').reduce((s:number,p:any)=>s+p.netPayout,0))}</div></div>
                <div><div style={{fontSize:'10px',color:'#94A3B8',marginBottom:'2px'}}>PENDING</div><div style={{fontSize:'16px',fontWeight:'700',color:GOLD}}>${fmt(pool.payouts.filter((p:any)=>p.status==='PENDING').reduce((s:number,p:any)=>s+p.netPayout,0))}</div></div>
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',background:'white',borderRadius:'10px',overflow:'hidden',border:'1px solid #E2E8F0'}}>
                <thead><tr style={{background:'#F8FAFC'}}>
                  {['Member','Share %','Gross Share','Loan Deduction','Net Payout','Status','Action'].map(h=>(
                    <th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {pool.payouts.map((py:any,i:number)=>(
                    <tr key={py.userId} style={{borderBottom:'1px solid #F8FAFC',background:i%2===0?'white':'#FAFAFA'}}>
                      <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'500',color:NAVY}}>{py.fullName}</td>
                      <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'700',color:PURPLE}}>{Number(py.sharePercent).toFixed(2)}%</td>
                      <td style={{padding:'10px 12px',fontSize:'13px',color:NAVY}}>${fmt(py.grossShare)}</td>
                      <td style={{padding:'10px 12px',fontSize:'13px',color:py.loanDeduction>0?'#854D0E':'#64748B'}}>
                        {py.loanDeduction>0?`-$${fmt(py.loanDeduction)}`:'—'}
                      </td>
                      <td style={{padding:'10px 12px',fontSize:'14px',fontWeight:'700',color:py.netPayout>0?GREEN:'#94A3B8'}}>${fmt(py.netPayout)}</td>
                      <td style={{padding:'10px 12px'}}>
                        <Pill bg={py.status==='PAID'?'#DCFCE7':'#FEF9C3'} color={py.status==='PAID'?GREEN:GOLD}>{py.status==='PAID'?'✓ PAID':'PENDING'}</Pill>
                      </td>
                      <td style={{padding:'10px 12px'}}>
                        {py.status==='PENDING'&&<button onClick={()=>doAction('PAYOUT_PAID',{poolId,userId:py.userId,paymentRef:`PAY-${Date.now()}`})}
                          disabled={saving} style={{padding:'4px 10px',background:TEAL,color:'white',border:'none',borderRadius:'4px',fontSize:'11px',cursor:'pointer',fontWeight:'600'}}>Mark Paid</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{background:'#F8FAFC',borderTop:'2px solid #E2E8F0'}}>
                  <td colSpan={2} style={{padding:'10px 12px',fontSize:'12px',fontWeight:'600',color:NAVY}}>Totals</td>
                  <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'700',color:NAVY}}>${fmt(pool.payouts.reduce((s:number,p:any)=>s+p.grossShare,0))}</td>
                  <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'700',color:'#854D0E'}}>-${fmt(pool.payouts.reduce((s:number,p:any)=>s+p.loanDeduction,0))}</td>
                  <td style={{padding:'10px 12px',fontSize:'14px',fontWeight:'700',color:GREEN}}>${fmt(pool.payouts.reduce((s:number,p:any)=>s+p.netPayout,0))}</td>
                  <td colSpan={2}/>
                </tr></tfoot>
              </table>
              <button onClick={()=>doAction('DISTRIBUTE',{poolId})} disabled={saving}
                style={{padding:'8px 16px',background:'#F1F5F9',color:'#475569',border:'1px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>↻ Recalculate Payouts</button>
            </>}
          </div>}
        </div>
      </div>

      {/* Repayment sub-modal */}
      {repayTarget&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1100}}>
        <div style={{background:'white',borderRadius:'16px',padding:'24px',width:'400px',boxShadow:'0 25px 50px rgba(0,0,0,0.3)'}}>
          <h3 style={{fontSize:'15px',fontWeight:'700',color:NAVY,margin:'0 0 12px'}}>💳 Record Loan Repayment</h3>
          <div style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px',marginBottom:'12px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'6px',fontSize:'12px'}}>
            {[['Principal',`$${fmt(repayTarget.principalDue)}`],['Interest',`$${fmt(repayTarget.interestDue)}`],['Total Due',`$${fmt(repayTarget.totalDue)}`]].map(([l,v])=>(
              <div key={l}><div style={{fontSize:'10px',color:'#94A3B8'}}>{l}</div><div style={{fontWeight:'700',color:NAVY}}>{v}</div></div>
            ))}
          </div>
          <input type="number" step="0.01" value={repayAmount} onChange={e=>setRepayAmount(e.target.value)} placeholder="0.00"
            style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'14px',fontWeight:'600',outline:'none',boxSizing:'border-box' as any,marginBottom:'10px'}}/>
          <div style={{display:'flex',gap:'8px'}}>
            <button onClick={()=>setRepayTarget(null)} style={{flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>Cancel</button>
            <button onClick={()=>{ doAction('REPAY',{loanId:loans.find((l:any)=>l.repayments?.find((r:any)=>r.id===repayTarget.id))?.id,repaymentId:repayTarget.id,amountPaid:parseFloat(repayAmount),paymentMethod:'ECOCASH'},'/api/savings/loans'); setRepayTarget(null) }}
              disabled={saving||!repayAmount} style={{flex:2,padding:'10px',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
              ✓ Record Payment
            </button>
          </div>
        </div>
      </div>}
    </div>
  )
}

// ── Version Badge (remove before production) ─────────────────
function VersionBadge() {
  return (
    <div style={{ position:'fixed', bottom:'12px', right:'12px', background:'rgba(13,33,55,0.85)', color:'white', fontSize:'10px', padding:'4px 10px', borderRadius:'999px', zIndex:9998, fontFamily:'monospace', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', gap:'6px' }}>
      <span style={{ opacity:0.5 }}>DEV</span>
      <span style={{ opacity:0.8 }}>💰 Savings Pools</span>
      <span style={{ background:'#0F6E56', padding:'1px 6px', borderRadius:'999px', fontWeight:'700' }}>v2.1</span>
    </div>
  )
}

export default function SavingsPage() {
  const [data, setData]       = useState<any>(null)
  const [groups, setGroups]   = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast]     = useState<any>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string|null>(null)
  const [filterStatus, setFilterStatus] = useState('ALL')

  function showToast(msg: string, type='success') { setToast({msg,type}) }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [sRes, gRes] = await Promise.all([fetch('/api/savings'), fetch('/api/groups')])
      const [sData, gData] = await Promise.all([sRes.json(), gRes.json()])
      if (sData.success) setData(sData.data)
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

  const pools = (data?.pools||[]).filter((p:any)=>filterStatus==='ALL'||p.status===filterStatus)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'20px'}}>
      <VersionBadge label="💰 Savings Pools" ver="v2.1" />
      {toast&&<Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
      {showCreate&&<CreatePoolModal groups={groups} members={members} onClose={()=>setShowCreate(false)} onSuccess={(msg:string)=>{showToast(msg);fetchData()}}/>}
      {selectedId&&<PoolDetail poolId={selectedId} allMembers={members} adminId="admin" onClose={()=>setSelectedId(null)} onAction={(msg:string,type='success')=>{showToast(msg,type);fetchData()}}/>}

      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <h2 style={{fontSize:'20px',fontWeight:'700',color:NAVY,margin:'0 0 4px'}}>💰 Savings Pools</h2>
          <p style={{fontSize:'13px',color:'#64748B',margin:0}}>Time-bound collective savings with optional member lending</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button onClick={fetchData} style={{padding:'8px 12px',background:'#F1F5F9',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'12px',cursor:'pointer',color:'#475569'}}>↻</button>
          <button onClick={()=>setShowCreate(true)} style={{padding:'10px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ New Pool</button>
        </div>
      </div>

      {/* Summary KPIs */}
      {!loading&&data&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px'}}>
          <KpiCard icon="💰" label="Total Pools"     value={data.summary.total}                 color={NAVY}   />
          <KpiCard icon="▶️" label="Active"           value={data.summary.active}               color={TEAL}   />
          <KpiCard icon="🏁" label="Matured"          value={data.summary.matured}              color={GOLD}   />
          <KpiCard icon="📊" label="Total Pool Value" value={fmtK(data.summary.totalValue)}     color={PURPLE} />
        </div>
      )}

      {/* Status filter */}
      <div style={{display:'flex',gap:'6px'}}>
        {['ALL','SETUP','ACTIVE','MATURED','CLOSED'].map(s=>(
          <button key={s} onClick={()=>setFilterStatus(s)} style={{padding:'5px 14px',borderRadius:'999px',fontSize:'12px',fontWeight:'500',cursor:'pointer',background:filterStatus===s?TEAL:'white',color:filterStatus===s?'white':'#64748B',border:filterStatus===s?'none':'1.5px solid #E2E8F0',whiteSpace:'nowrap'}}>
            {s==='ALL'?'All':POOL_STATUS[s]?.label||s}
          </button>
        ))}
      </div>

      {/* Pool list */}
      {loading?(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}>
          <div style={{fontSize:'32px',marginBottom:'10px'}}>⏳</div><p style={{color:'#64748B'}}>Loading pools...</p>
        </div>
      ):pools.length===0?(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}>
          <div style={{fontSize:'48px',marginBottom:'16px'}}>💰</div>
          <h3 style={{fontSize:'16px',fontWeight:'600',color:NAVY,margin:'0 0 8px'}}>No savings pools yet</h3>
          <p style={{color:'#64748B',fontSize:'13px',marginBottom:'20px'}}>Create a pool for your group to start a structured savings programme.</p>
          <button onClick={()=>setShowCreate(true)} style={{padding:'10px 20px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Create First Pool</button>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          {pools.map((p: any)=>{
            const sm = POOL_STATUS[p.status]||POOL_STATUS.SETUP
            const daysLeft = p.daysLeft
            return (
              <div key={p.id} onClick={()=>setSelectedId(p.id)}
                style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px 20px',cursor:'pointer',display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap',transition:'all 0.15s'}}
                onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.boxShadow='0 4px 16px rgba(0,0,0,0.08)'}}
                onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.boxShadow='none'}}>

                <div style={{width:'44px',height:'44px',borderRadius:'10px',background:`linear-gradient(135deg,${NAVY},${TEAL})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',flexShrink:0}}>💰</div>

                <div style={{flex:1,minWidth:'200px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'3px'}}>
                    <span style={{fontSize:'14px',fontWeight:'700',color:NAVY}}>{p.name}</span>
                    <Pill bg={sm.bg} color={sm.color}>{sm.icon} {sm.label}</Pill>
                    {p.status==='ACTIVE'&&daysLeft<30&&<Pill bg='#FEE2E2' color={RED}>⚠️ {daysLeft}d left</Pill>}
                  </div>
                  <div style={{fontSize:'12px',color:'#64748B'}}>
                    {p.groupName} · {FREQ_LABELS[p.contributionFrequency]} ${fmt(p.contributionAmount)} · {p.periodMonths} months
                    {p.allowLoans&&<span style={{marginLeft:'6px',color:'#94A3B8'}}>· Loans {p.interestRatePct}%</span>}
                  </div>
                  {p.status==='ACTIVE'&&<div style={{marginTop:'6px'}}>
                    <div style={{height:'5px',background:'#F1F5F9',borderRadius:'3px',overflow:'hidden',maxWidth:'200px'}}>
                      <div style={{height:'100%',background:TEAL,borderRadius:'3px',width:`${p.timeProgress}%`}}/>
                    </div>
                  </div>}
                </div>

                <div style={{display:'flex',gap:'16px',flexWrap:'wrap',flexShrink:0}}>
                  {[
                    {l:'Pool Value',  v:fmtK(p.totalPoolValue), c:PURPLE},
                    {l:'Members',     v:p.memberCount,           c:NAVY  },
                    {l:'Matures',     v:new Date(p.maturityDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}), c:'#64748B'},
                  ].map(s=><div key={s.l} style={{textAlign:'center',minWidth:'70px'}}>
                    <div style={{fontSize:'14px',fontWeight:'700',color:s.c}}>{s.v}</div>
                    <div style={{fontSize:'10px',color:'#94A3B8'}}>{s.l}</div>
                  </div>)}
                </div>

                <span style={{fontSize:'18px',color:'#CBD5E1',flexShrink:0}}>→</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
