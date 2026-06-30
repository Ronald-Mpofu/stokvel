'use client'
// src/app/dashboard/investment/InvestmentPanel.tsx — v1.0
import { useState, useEffect, useCallback } from 'react'

const TEAL = '#0F6E56'; const NAVY = '#0D2137'
const GREEN = '#166534'; const RED = '#991B1B'
const AMBER = '#854D0E'; const PURPLE = '#7C3AED'

const STATUS_COLORS: Record<string,any> = {
  SETUP:            { bg:'#EEF2FF', color:'#3730A3', icon:'⚙️',  label:'Setup'       },
  ACTIVE:           { bg:'#DCFCE7', color:GREEN,      icon:'▶️',  label:'Active'       },
  CLOSED:           { bg:'#F1F5F9', color:'#475569',  icon:'✅',  label:'Closed'       },
  PENDING_APPROVAL: { bg:'#FEF9C3', color:AMBER,      icon:'⏳',  label:'Pending'      },
  APPROVED:         { bg:'#DCFCE7', color:GREEN,       icon:'✅',  label:'Approved'     },
  ACTIVE_LOAN:      { bg:'#DBEAFE', color:'#1E3A8A',  icon:'💳',  label:'Active'       },
  SETTLED:          { bg:'#F0FDF4', color:GREEN,       icon:'🏁',  label:'Settled'      },
  REJECTED:         { bg:'#FEE2E2', color:RED,         icon:'❌',  label:'Rejected'     },
  PENDING:          { bg:'#FEF9C3', color:AMBER,       icon:'⏳',  label:'Pending'      },
  PAID:             { bg:'#DCFCE7', color:GREEN,       icon:'✅',  label:'Paid'         },
  PARTIAL:          { bg:'#DBEAFE', color:'#1E3A8A',   icon:'⚡',  label:'Partial'      },
  LATE:             { bg:'#FEE2E2', color:RED,          icon:'⚠️', label:'Late'         },
  WAIVED:           { bg:'#F1F5F9', color:'#475569',   icon:'🔵',  label:'Waived'       },
}

const fmt = (n: number) => new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)

function Pill({ status, custom }: { status?: string; custom?: { bg:string; color:string; label:string; icon?:string } }) {
  const s = custom || STATUS_COLORS[status||''] || STATUS_COLORS.PENDING
  return <span style={{ background:s.bg, color:s.color, fontSize:'10px', fontWeight:'600', padding:'2px 8px', borderRadius:'999px', display:'inline-flex', alignItems:'center', gap:'3px', whiteSpace:'nowrap' }}>
    {s.icon && <span>{s.icon}</span>}{s.label}
  </span>
}

function Toast({ msg, type, onClose }: any) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  return <div style={{ position:'fixed',top:'20px',right:'20px',zIndex:9999,padding:'12px 20px',borderRadius:'10px',fontSize:'13px',fontWeight:'500',boxShadow:'0 8px 25px rgba(0,0,0,0.15)',background:type==='success'?GREEN:RED,color:'white',display:'flex',alignItems:'center',gap:'10px',maxWidth:'420px' }}>
    <span>{type==='success'?'✅':'❌'}</span><span style={{flex:1}}>{msg}</span>
    <button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'18px'}}>×</button>
  </div>
}

// ── Create Club Modal ─────────────────────────────────────────
function CreateClubModal({ groupId, groupMembers, onClose, onSuccess }: any) {
  const [form, setForm] = useState({
    name:'', description:'', contributionAmount:'', contributionFrequency:'MONTHLY',
    loanLimitPct:'50', loanInterestRatePa:'18', lateContribPenaltyPct:'5',
    adminId:'', treasurerId:'', secretaryId:'', notes:'', memberIds:[] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k:string) => (v:any) => setForm(p=>({...p,[k]:v}))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const res  = await fetch('/api/investment', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...form, groupId,
          contributionAmount:    parseFloat(form.contributionAmount),
          loanLimitPct:          parseFloat(form.loanLimitPct) / 100,
          loanInterestRatePa:    parseFloat(form.loanInterestRatePa) / 100,
          lateContribPenaltyPct: parseFloat(form.lateContribPenaltyPct) / 100,
        }) })
      if (!res.ok && res.status === 404) {
        setError('API route not found. Ensure src/app/api/investment/route.ts exists and restart the dev server.')
        return
      }
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { setError(`Server returned non-JSON (status ${res.status}). Restart dev server.`); return }
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error || 'Failed')
    } catch (e: any) { setError(e?.message || 'Network error — check server logs') } finally { setSaving(false) }
  }

  const allSel = groupMembers.length > 0 && groupMembers.every((m:any)=>form.memberIds.includes(m.userId||m.id))
  const INPUT:  React.CSSProperties = { width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' }
  const LABEL:  React.CSSProperties = { display:'block', fontSize:'11px', fontWeight:'600', color:'#64748B', marginBottom:'4px', textTransform:'uppercase', letterSpacing:'0.04em' }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1010,padding:'20px' }}>
      <div style={{ background:'white',borderRadius:'16px',width:'100%',maxWidth:'600px',maxHeight:'92vh',overflowY:'auto',boxShadow:'0 25px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ background:`linear-gradient(135deg,${NAVY},${TEAL})`,padding:'20px 24px',borderRadius:'16px 16px 0 0',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div>
            <h3 style={{ fontSize:'15px',fontWeight:'700',color:'white',margin:'0 0 2px' }}>📈 New Investment Club</h3>
            <p style={{ fontSize:'12px',color:'rgba(255,255,255,0.6)',margin:0 }}>Create an indefinite-period investment portfolio for this group</p>
          </div>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px',color:'white' }}>×</button>
        </div>

        <form onSubmit={submit} style={{ padding:'22px 24px', display:'flex', flexDirection:'column', gap:'14px' }}>
          {/* Basic */}
          <div>
            <label style={LABEL}>Club Name *</label>
            <input type="text" value={form.name} onChange={e=>set('name')(e.target.value)} required placeholder="e.g. 2025 Growth Portfolio" style={INPUT}/>
          </div>
          <div>
            <label style={LABEL}>Description</label>
            <textarea value={form.description} onChange={e=>set('description')(e.target.value)} rows={2} placeholder="Investment objectives and strategy..." style={{...INPUT,resize:'vertical' as any}}/>
          </div>

          {/* Contribution */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <div>
              <label style={LABEL}>Monthly Contribution ($) *</label>
              <input type="number" step="0.01" min="1" value={form.contributionAmount} onChange={e=>set('contributionAmount')(e.target.value)} required placeholder="100.00" style={INPUT}/>
            </div>
            <div>
              <label style={LABEL}>Frequency</label>
              <select value={form.contributionFrequency} onChange={e=>set('contributionFrequency')(e.target.value)} style={{...INPUT,background:'white'}}>
                <option value="MONTHLY">Monthly</option>
                <option value="FORTNIGHTLY">Fortnightly</option>
                <option value="WEEKLY">Weekly</option>
              </select>
            </div>
          </div>

          {/* Financial rules */}
          <div style={{ background:'#F8FAFC', borderRadius:'10px', padding:'14px', border:'1px solid #E2E8F0' }}>
            <div style={{ fontSize:'12px', fontWeight:'600', color:NAVY, marginBottom:'12px' }}>💱 Financial Rules</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px' }}>
              <div>
                <label style={LABEL}>Loan Limit (% of contributions)</label>
                <div style={{ position:'relative' }}>
                  <input type="number" step="1" min="10" max="100" value={form.loanLimitPct} onChange={e=>set('loanLimitPct')(e.target.value)} style={{...INPUT,paddingRight:'28px'}}/>
                  <span style={{ position:'absolute',right:'10px',top:'50%',transform:'translateY(-50%)',color:'#94A3B8',fontSize:'12px' }}>%</span>
                </div>
                <p style={{ fontSize:'10px',color:'#94A3B8',margin:'3px 0 0' }}>Member can borrow up to this % of their total contributions</p>
              </div>
              <div>
                <label style={LABEL}>Loan Interest (% p.a.)</label>
                <div style={{ position:'relative' }}>
                  <input type="number" step="0.5" min="0" max="50" value={form.loanInterestRatePa} onChange={e=>set('loanInterestRatePa')(e.target.value)} style={{...INPUT,paddingRight:'28px'}}/>
                  <span style={{ position:'absolute',right:'10px',top:'50%',transform:'translateY(-50%)',color:'#94A3B8',fontSize:'12px' }}>%</span>
                </div>
              </div>
              <div>
                <label style={LABEL}>Late Penalty (% per period)</label>
                <div style={{ position:'relative' }}>
                  <input type="number" step="0.5" min="0" max="20" value={form.lateContribPenaltyPct} onChange={e=>set('lateContribPenaltyPct')(e.target.value)} style={{...INPUT,paddingRight:'28px'}}/>
                  <span style={{ position:'absolute',right:'10px',top:'50%',transform:'translateY(-50%)',color:'#94A3B8',fontSize:'12px' }}>%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Management */}
          <div style={{ background:'#F8FAFC', borderRadius:'10px', padding:'14px', border:'1px solid #E2E8F0' }}>
            <div style={{ fontSize:'12px', fontWeight:'600', color:NAVY, marginBottom:'12px' }}>👔 Portfolio Management</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px' }}>
              {[['adminId','Admin / Portfolio Manager'],['treasurerId','Treasurer'],['secretaryId','Secretary']].map(([k,l])=>(
                <div key={k}>
                  <label style={LABEL}>{l}</label>
                  <select value={(form as any)[k]} onChange={e=>set(k)(e.target.value)} style={{...INPUT,background:'white'}}>
                    <option value="">Select...</option>
                    {groupMembers.map((m:any)=><option key={m.userId||m.id} value={m.userId||m.id}>{m.fullName}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Members */}
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
              <label style={LABEL}>Enrol Members</label>
              <button type="button" onClick={()=>set('memberIds')(allSel?[]:groupMembers.map((m:any)=>m.userId||m.id))}
                style={{ fontSize:'11px',color:TEAL,background:'none',border:'none',cursor:'pointer',fontWeight:'600' }}>
                {allSel?'Deselect all':'Select all'}
              </button>
            </div>
            <div style={{ display:'flex',flexDirection:'column',gap:'4px',maxHeight:'140px',overflowY:'auto',border:'1.5px solid #E2E8F0',borderRadius:'8px',padding:'8px' }}>
              {groupMembers.map((m:any)=>{
                const uid = m.userId||m.id
                const sel = form.memberIds.includes(uid)
                return <div key={uid} onClick={()=>set('memberIds')(sel?form.memberIds.filter((id:string)=>id!==uid):[...form.memberIds,uid])}
                  style={{ display:'flex',alignItems:'center',gap:'8px',padding:'6px 8px',borderRadius:'6px',cursor:'pointer',background:sel?'#F0FDF4':'white',border:`1px solid ${sel?TEAL:'transparent'}` }}>
                  <div style={{ width:'16px',height:'16px',borderRadius:'4px',border:`2px solid ${sel?TEAL:'#CBD5E1'}`,background:sel?TEAL:'white',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                    {sel&&<span style={{ color:'white',fontSize:'10px',fontWeight:'700' }}>✓</span>}
                  </div>
                  <span style={{ fontSize:'13px',color:NAVY }}>{m.fullName}</span>
                </div>
              })}
            </div>
            <p style={{ fontSize:'11px',color:'#94A3B8',margin:'4px 0 0' }}>{form.memberIds.length} selected</p>
          </div>

          {error && <div style={{ background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:RED,fontSize:'12px' }}>❌ {error}</div>}

          <div style={{ display:'flex',gap:'10px' }}>
            <button type="button" onClick={onClose} style={{ flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white' }}>
              {saving?'⏳ Creating...':'📈 Create Investment Club'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Club Detail ───────────────────────────────────────────────
function ClubDetail({ clubId, groupMembers, onClose, onAction }: any) {
  const [club, setClub]   = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]     = useState<'dashboard'|'members'|'contributions'|'loans'|'disbursements'|'settings'>('dashboard')
  const [saving, setSaving] = useState(false)
  const [loanForm, setLoanForm] = useState({ borrowerId:'', amount:'', termMonths:'12', purpose:'' })
  const [disbForm, setDisbForm] = useState({ userId:'', amount:'', reason:'' })
  const [contribPay, setContribPay] = useState<any>(null)
  const [search, setSearch] = useState('')

  const fetchClub = useCallback(async () => {
    const res  = await fetch(`/api/investment?clubId=${clubId}`)
    const data = await res.json()
    if (data.success) setClub(data.data)
    setLoading(false)
  }, [clubId])

  useEffect(() => { fetchClub() }, [fetchClub])

  async function doAction(action: string, payload: any = {}) {
    setSaving(true)
    try {
      const res  = await fetch('/api/investment', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action, clubId, ...payload }) })
      const data = await res.json()
      if (data.success) { onAction(data.message); fetchClub() }
      else onAction(data.error||'Failed', 'error')
    } catch (e: any) { onAction(e?.message || 'Network error','error') } finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1010 }}>
      <div style={{ background:'white',borderRadius:'14px',padding:'40px',textAlign:'center' }}>⏳ Loading...</div>
    </div>
  )
  if (!club) return null

  const sm      = STATUS_COLORS[club.status] || STATUS_COLORS.SETUP
  const members = club.members || []
  const contribs = (club.contributions || []).filter((c:any) =>
    !search || c.memberName?.toLowerCase().includes(search.toLowerCase()))
  const loans    = club.loans || []
  const disbs    = club.disbursements || []
  const nonMembers = groupMembers.filter((m:any) => !members.find((cm:any)=>cm.userId===(m.userId||m.id)))
  const now = new Date()

  // Group contributions by period
  const byPeriod: Record<number,any[]> = {}
  contribs.forEach((c:any) => { if(!byPeriod[c.periodNumber]) byPeriod[c.periodNumber]=[]; byPeriod[c.periodNumber].push(c) })

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1010,padding:'16px' }}>
      <div style={{ background:'white',borderRadius:'16px',width:'100%',maxWidth:'860px',maxHeight:'95vh',display:'flex',flexDirection:'column',boxShadow:'0 25px 60px rgba(0,0,0,0.3)',overflow:'hidden' }}>

        {/* Header */}
        <div style={{ background:`linear-gradient(135deg,${NAVY},#1E3A5F)`,padding:'20px 24px',flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'flex-start',gap:'12px' }}>
            <div style={{ width:'44px',height:'44px',borderRadius:'10px',background:'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',flexShrink:0 }}>📈</div>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex',alignItems:'center',gap:'8px',marginBottom:'2px',flexWrap:'wrap' }}>
                <span style={{ fontSize:'16px',fontWeight:'700',color:'white' }}>{club.name}</span>
                <Pill custom={{ bg:sm.bg, color:sm.color, label:sm.label, icon:sm.icon }}/>
              </div>
              <div style={{ fontSize:'12px',color:'rgba(255,255,255,0.6)' }}>
                {club.contributionFrequency} · {members.length} members
                {club.adminName && <span style={{ marginLeft:'8px' }}>· 👔 {club.adminName}</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ width:'32px',height:'32px',background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'18px',color:'white' }}>×</button>
          </div>

          {/* KPI strip */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px',marginTop:'14px',paddingTop:'12px',borderTop:'1px solid rgba(255,255,255,0.1)' }}>
            {[
              { l:'Total Fund',      v:`$${fmt(club.totalFundValue)}` },
              { l:'Contributed',     v:`$${fmt(club.totalContributed)}` },
              { l:'Outstanding Loans', v:`$${fmt(club.totalLoaned)}` },
              { l:'Disbursed',       v:`$${fmt(club.totalDisbursed)}` },
              { l:'Available',       v:`$${fmt(club.availableToLoan)}` },
            ].map(s=>(
              <div key={s.l}>
                <div style={{ fontSize:'9px',color:'rgba(255,255,255,0.5)',textTransform:'uppercase',letterSpacing:'0.05em' }}>{s.l}</div>
                <div style={{ fontSize:'15px',fontWeight:'700',color:'white',marginTop:'2px' }}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display:'flex',gap:'8px',marginTop:'12px',flexWrap:'wrap' }}>
            {club.status==='SETUP' && members.length>0 && (
              <button onClick={()=>doAction('ACTIVATE')} disabled={saving}
                style={{ padding:'6px 14px',background:TEAL,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer' }}>▶️ Activate Club</button>
            )}
            {club.status==='ACTIVE' && (
              <button onClick={()=>doAction('APPLY_LATE_PENALTIES')} disabled={saving}
                style={{ padding:'6px 14px',background:'rgba(255,255,255,0.15)',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',cursor:'pointer' }}>⚠️ Apply Late Penalties</button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex',borderBottom:'1px solid #E2E8F0',flexShrink:0,overflowX:'auto' }}>
          {[['dashboard','📊 Dashboard'],['members','👥 Members'],['contributions','💸 Contributions'],['loans','💳 Loans'],['disbursements','💰 Disbursements'],['settings','⚙️ Settings']].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id as any)}
              style={{ padding:'10px 16px',background:'none',border:'none',borderBottom:tab===id?`2px solid ${TEAL}`:'2px solid transparent',color:tab===id?TEAL:'#64748B',fontWeight:tab===id?'600':'400',fontSize:'13px',cursor:'pointer',marginBottom:'-1px',whiteSpace:'nowrap' }}>{label}</button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{ flex:1,overflowY:'auto',padding:'16px 20px' }}>

          {/* DASHBOARD */}
          {tab==='dashboard' && (
            <div style={{ display:'flex',flexDirection:'column',gap:'14px' }}>
              {club.status==='SETUP' && (
                <div style={{ background:'#EEF2FF',borderRadius:'12px',padding:'16px',border:'1px solid #C7D2FE' }}>
                  <div style={{ fontSize:'13px',fontWeight:'600',color:'#3730A3',marginBottom:'10px' }}>📋 Setup Checklist</div>
                  {[
                    [members.length>0, `Members enrolled (${members.length})`],
                    [!!club.adminId, 'Portfolio manager assigned'],
                    [!!club.treasurerId, 'Treasurer assigned'],
                  ].map(([done,label],i)=>(
                    <div key={i} style={{ display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:done?GREEN:'#64748B',marginBottom:'5px' }}>
                      <span>{done?'✅':'⬜'}</span><span>{label as string}</span>
                    </div>
                  ))}
                  {members.length>0 && (
                    <button onClick={()=>doAction('ACTIVATE')} disabled={saving}
                      style={{ marginTop:'10px',padding:'8px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer' }}>▶️ Activate Now</button>
                  )}
                </div>
              )}

              {/* Financial summary cards */}
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px' }}>
                {[
                  { icon:'💰', label:'Total Fund Value',    value:`$${fmt(club.totalFundValue)}`,  bg:'#F0FDF4', color:GREEN },
                  { icon:'📥', label:'Total Contributed',  value:`$${fmt(club.totalContributed)}`, bg:'#EEF2FF', color:PURPLE },
                  { icon:'💳', label:'Outstanding Loans',  value:`$${fmt(club.totalLoaned)}`,      bg:'#FEF9C3', color:AMBER },
                  { icon:'💸', label:'Total Disbursed',    value:`$${fmt(club.totalDisbursed)}`,   bg:'#FEE2E2', color:RED },
                ].map(c=>(
                  <div key={c.label} style={{ background:c.bg,borderRadius:'12px',padding:'16px' }}>
                    <div style={{ display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px' }}>
                      <span style={{ fontSize:'20px' }}>{c.icon}</span>
                      <span style={{ fontSize:'12px',color:'#64748B' }}>{c.label}</span>
                    </div>
                    <div style={{ fontSize:'24px',fontWeight:'800',color:c.color }}>{c.value}</div>
                  </div>
                ))}
              </div>

              {/* Top members by contribution */}
              {members.length>0 && (
                <div style={{ background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden' }}>
                  <div style={{ padding:'12px 16px',borderBottom:'1px solid #F1F5F9',fontSize:'13px',fontWeight:'600',color:NAVY }}>👥 Member Portfolio Summary</div>
                  <table style={{ width:'100%',borderCollapse:'collapse' }}>
                    <thead><tr style={{ background:'#F8FAFC' }}>
                      {['Member','Contributed','Loan Balance','Max Loan','Available to Loan','Loan Limit'].map(h=>(
                        <th key={h} style={{ padding:'8px 12px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase',whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {members.map((m:any)=>(
                        <tr key={m.userId} style={{ borderBottom:'1px solid #F8FAFC' }}>
                          <td style={{ padding:'10px 12px',fontSize:'13px',fontWeight:'500',color:NAVY }}>{m.fullName}</td>
                          <td style={{ padding:'10px 12px',fontSize:'13px',fontWeight:'600',color:TEAL }}>${fmt(m.totalContributed)}</td>
                          <td style={{ padding:'10px 12px',fontSize:'13px',color:m.loanBalance>0?RED:'#64748B' }}>${fmt(m.loanBalance)}</td>
                          <td style={{ padding:'10px 12px',fontSize:'13px',color:PURPLE }}>${fmt(m.maxLoanAllowed)}</td>
                          <td style={{ padding:'10px 12px',fontSize:'13px',fontWeight:'600',color:m.availableToLoan>0?GREEN:RED }}>${fmt(m.availableToLoan)}</td>
                          <td style={{ padding:'10px 12px' }}><span style={{ background:'#EEF2FF',color:PURPLE,fontSize:'11px',fontWeight:'600',padding:'2px 8px',borderRadius:'999px' }}>{club.loanLimitPctDisplay}%</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* MEMBERS */}
          {tab==='members' && (
            <div style={{ display:'flex',flexDirection:'column',gap:'12px' }}>
              {nonMembers.length>0 && club.status!=='CLOSED' && (
                <div style={{ background:'#F0FDF4',borderRadius:'10px',padding:'12px 14px',border:'1px solid #BBF7D0',display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center' }}>
                  <span style={{ fontSize:'12px',color:GREEN,fontWeight:'500' }}>Add member:</span>
                  {nonMembers.map((m:any)=>{
                    const uid = m.userId||m.id
                    return <button key={uid} onClick={()=>doAction('ADD_MEMBER',{userId:uid})} style={{ padding:'4px 10px',background:'white',color:NAVY,border:'1px solid #BBF7D0',borderRadius:'5px',fontSize:'12px',cursor:'pointer' }}>+ {m.fullName}</button>
                  })}
                </div>
              )}
              {members.length===0 ? (
                <div style={{ textAlign:'center',padding:'48px',color:'#94A3B8' }}>
                  <div style={{ fontSize:'40px',marginBottom:'10px' }}>👥</div>
                  <p>No members yet. Add members to the investment club.</p>
                </div>
              ) : (
                <table style={{ width:'100%',borderCollapse:'collapse',background:'white',borderRadius:'10px',overflow:'hidden',border:'1px solid #E2E8F0' }}>
                  <thead><tr style={{ background:'#F8FAFC' }}>
                    {['Member','Tier','Contributed','Loan Balance','Max Loan','Available','Actions'].map(h=>(
                      <th key={h} style={{ padding:'9px 12px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase',whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {members.map((m:any,i:number)=>(
                      <tr key={m.userId} style={{ borderBottom:'1px solid #F8FAFC',background:i%2===0?'white':'#FAFAFA' }}>
                        <td style={{ padding:'10px 12px' }}>
                          <div style={{ display:'flex',alignItems:'center',gap:'8px' }}>
                            <div style={{ width:'28px',height:'28px',borderRadius:'50%',background:'#E1F5EE',color:TEAL,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700' }}>
                              {(m.fullName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                            </div>
                            <span style={{ fontSize:'13px',fontWeight:'500',color:NAVY }}>{m.fullName}</span>
                          </div>
                        </td>
                        <td style={{ padding:'10px 12px' }}><Pill custom={{ bg:'#EEF2FF',color:PURPLE,label:m.tier||'MEMBER',icon:'' }}/></td>
                        <td style={{ padding:'10px 12px',fontWeight:'600',color:TEAL }}>${fmt(m.totalContributed)}</td>
                        <td style={{ padding:'10px 12px',color:m.loanBalance>0?RED:'#64748B' }}>${fmt(m.loanBalance)}</td>
                        <td style={{ padding:'10px 12px',color:PURPLE }}>${fmt(m.maxLoanAllowed)}</td>
                        <td style={{ padding:'10px 12px',fontWeight:'600',color:m.availableToLoan>0?GREEN:RED }}>${fmt(m.availableToLoan)}</td>
                        <td style={{ padding:'10px 12px' }}>
                          <button onClick={()=>doAction('REMOVE_MEMBER',{userId:m.userId})}
                            style={{ padding:'3px 8px',background:'#FEF2F2',color:RED,border:'1px solid #FECACA',borderRadius:'4px',fontSize:'10px',cursor:'pointer' }}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* CONTRIBUTIONS */}
          {tab==='contributions' && (
            <div style={{ display:'flex',flexDirection:'column',gap:'10px' }}>
              <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px' }}>
                <div style={{ display:'flex',gap:'12px',flexWrap:'wrap',fontSize:'12px' }}>
                  {[['Total',(club.contributions||[]).length,'#64748B'],['Paid',(club.contributions||[]).filter((c:any)=>c.status==='PAID').length,GREEN],
                    ['Late',(club.contributions||[]).filter((c:any)=>c.status==='LATE').length,RED],
                    ['Overdue',(club.contributions||[]).filter((c:any)=>c.isOverdue).length,AMBER]].map(([l,v,c])=>(
                    <span key={l as string} style={{ color:c as string,fontWeight:'600' }}>{l}: {v as number}</span>
                  ))}
                </div>
                <input placeholder="Search member..." value={search} onChange={e=>setSearch(e.target.value)}
                  style={{ padding:'6px 12px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none' }}/>
              </div>

              {Object.keys(byPeriod).length === 0 ? (
                <div style={{ textAlign:'center',padding:'48px',color:'#94A3B8' }}>
                  <div style={{ fontSize:'32px',marginBottom:'8px' }}>💸</div>
                  <p>{club.status==='SETUP'?'Activate the club to generate contribution schedules.':'No contributions yet.'}</p>
                </div>
              ) : (
                Object.entries(byPeriod).map(([period,cs]:[string,any])=>{
                  const allPaid = cs.every((c:any)=>c.status==='PAID')
                  const hasLate = cs.some((c:any)=>c.status==='LATE'||c.isOverdue)
                  return (
                    <div key={period} style={{ background:'white',borderRadius:'10px',border:`1px solid ${hasLate?'#FECACA':allPaid?'#BBF7D0':'#E2E8F0'}`,overflow:'hidden' }}>
                      <div style={{ background:hasLate?'#FEF2F2':allPaid?'#F0FDF4':'#F8FAFC',padding:'8px 14px',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                        <div style={{ display:'flex',alignItems:'center',gap:'10px' }}>
                          <span style={{ fontSize:'13px',fontWeight:'700',color:NAVY }}>Period #{period}</span>
                          <span style={{ fontSize:'12px',color:'#64748B' }}>Due {new Date(cs[0]?.dueDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
                          {hasLate && <span style={{ fontSize:'11px',color:RED,fontWeight:'600' }}>⚠️ OVERDUE</span>}
                          {allPaid && <span style={{ fontSize:'11px',color:GREEN,fontWeight:'600' }}>✅ ALL PAID</span>}
                        </div>
                        <span style={{ fontSize:'11px',color:'#64748B' }}>{cs.filter((c:any)=>c.status==='PAID').length}/{cs.length} paid</span>
                      </div>
                      <table style={{ width:'100%',borderCollapse:'collapse' }}>
                        <tbody>
                          {cs.map((c:any)=>(
                            <tr key={c.id} style={{ borderTop:'1px solid #F8FAFC' }}>
                              <td style={{ padding:'8px 14px',fontSize:'13px',color:NAVY }}>{c.memberName}</td>
                              <td style={{ padding:'8px 14px' }}>
                                <div style={{ fontSize:'11px',color:'#94A3B8' }}>Contrib</div>
                                <div style={{ fontSize:'13px',fontWeight:'600',color:NAVY }}>${fmt(c.amountDue)}</div>
                              </td>
                              {c.loanRepaymentDue>0 && <td style={{ padding:'8px 14px' }}>
                                <div style={{ fontSize:'11px',color:'#94A3B8' }}>Loan Repay</div>
                                <div style={{ fontSize:'13px',fontWeight:'600',color:AMBER }}>${fmt(c.loanRepaymentDue)}</div>
                              </td>}
                              {c.penaltyDue>0 && <td style={{ padding:'8px 14px' }}>
                                <div style={{ fontSize:'11px',color:'#94A3B8' }}>Penalty</div>
                                <div style={{ fontSize:'13px',fontWeight:'600',color:RED }}>${fmt(c.penaltyDue)}</div>
                              </td>}
                              <td style={{ padding:'8px 14px',fontWeight:'700',color:NAVY }}>Total: ${fmt(c.totalDue)}</td>
                              <td style={{ padding:'8px 14px' }}><Pill status={c.status}/></td>
                              <td style={{ padding:'8px 14px' }}>
                                {c.status!=='PAID' && c.status!=='WAIVED' && club.status==='ACTIVE' && (
                                  <div style={{ display:'flex',gap:'4px' }}>
                                    <button onClick={()=>doAction('WAIVE_CONTRIBUTION',{contributionId:c.id})}
                                      style={{ padding:'3px 7px',background:'#F1F5F9',color:'#475569',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer' }}>Waive</button>
                                    <button onClick={()=>doAction('PAY_CONTRIBUTION',{contributionId:c.id,amountPaid:c.totalDue,paymentMethod:'BANK_TRANSFER'})}
                                      style={{ padding:'3px 7px',background:TEAL,color:'white',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer',fontWeight:'600' }}>Pay ✓</button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* LOANS */}
          {tab==='loans' && (
            <div style={{ display:'flex',flexDirection:'column',gap:'14px' }}>
              {/* Apply for loan form */}
              {club.status==='ACTIVE' && (
                <div style={{ background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px' }}>
                  <div style={{ fontSize:'13px',fontWeight:'600',color:NAVY,marginBottom:'12px' }}>💳 Apply for Loan</div>
                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'10px',marginBottom:'10px' }}>
                    <div>
                      <label style={{ display:'block',fontSize:'11px',fontWeight:'600',color:'#64748B',marginBottom:'4px',textTransform:'uppercase' }}>Borrower *</label>
                      <select value={loanForm.borrowerId} onChange={e=>setLoanForm(f=>({...f,borrowerId:e.target.value}))}
                        style={{ width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',background:'white',boxSizing:'border-box' }}>
                        <option value="">Select member...</option>
                        {members.map((m:any)=><option key={m.userId} value={m.userId}>{m.fullName} (avail: ${fmt(m.availableToLoan)})</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ display:'block',fontSize:'11px',fontWeight:'600',color:'#64748B',marginBottom:'4px',textTransform:'uppercase' }}>Amount ($) *</label>
                      <input type="number" step="0.01" min="1" value={loanForm.amount} onChange={e=>setLoanForm(f=>({...f,amount:e.target.value}))}
                        placeholder="0.00" style={{ width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box' }}/>
                    </div>
                    <div>
                      <label style={{ display:'block',fontSize:'11px',fontWeight:'600',color:'#64748B',marginBottom:'4px',textTransform:'uppercase' }}>Term (months) *</label>
                      <input type="number" min="1" max="60" value={loanForm.termMonths} onChange={e=>setLoanForm(f=>({...f,termMonths:e.target.value}))}
                        style={{ width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box' }}/>
                    </div>
                    <div>
                      <label style={{ display:'block',fontSize:'11px',fontWeight:'600',color:'#64748B',marginBottom:'4px',textTransform:'uppercase' }}>Purpose</label>
                      <input type="text" value={loanForm.purpose} onChange={e=>setLoanForm(f=>({...f,purpose:e.target.value}))}
                        placeholder="Loan purpose..." style={{ width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box' }}/>
                    </div>
                  </div>
                  {loanForm.amount && loanForm.termMonths && (
                    <div style={{ background:'#EEF2FF',borderRadius:'8px',padding:'8px 12px',marginBottom:'10px',fontSize:'12px',color:PURPLE }}>
                      Est. monthly repayment: <strong>${fmt(
                        (() => { const r=Number(club.loanInterestRatePa)/12; const P=parseFloat(loanForm.amount||'0'); const n=parseInt(loanForm.termMonths||'1'); return r>0?(P*r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1):P/n })()
                      )}</strong> · Interest rate: {club.loanInterestDisplay}% p.a.
                    </div>
                  )}
                  <button onClick={()=>{ doAction('REQUEST_LOAN',{...loanForm,amount:parseFloat(loanForm.amount),termMonths:parseInt(loanForm.termMonths)}); setLoanForm({borrowerId:'',amount:'',termMonths:'12',purpose:''}) }}
                    disabled={!loanForm.borrowerId||!loanForm.amount||saving}
                    style={{ padding:'8px 18px',background:TEAL,color:'white',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer' }}>
                    Submit Loan Application
                  </button>
                </div>
              )}

              {/* Loan list */}
              {loans.length===0 ? (
                <div style={{ textAlign:'center',padding:'40px',color:'#94A3B8' }}>
                  <div style={{ fontSize:'32px',marginBottom:'8px' }}>💳</div>
                  <p>No loans yet.</p>
                </div>
              ) : (
                <div style={{ display:'flex',flexDirection:'column',gap:'8px' }}>
                  {loans.map((l:any)=>(
                    <div key={l.id} style={{ background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'14px 16px' }}>
                      <div style={{ display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap' }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',flexWrap:'wrap' }}>
                            <span style={{ fontSize:'14px',fontWeight:'600',color:NAVY }}>{l.borrowerName}</span>
                            <Pill status={l.status}/>
                          </div>
                          <div style={{ fontSize:'12px',color:'#64748B' }}>
                            Amount: <strong>${fmt(l.amount)}</strong> ·
                            Outstanding: <strong style={{ color:l.outstandingBalance>0?RED:GREEN }}>${fmt(l.outstandingBalance)}</strong> ·
                            Monthly: <strong>${fmt(l.monthlyRepayment)}</strong> ·
                            {l.termMonths}mo · {l.interestDisplay}% p.a.
                            {l.purpose && <span> · {l.purpose}</span>}
                          </div>
                          {/* Progress bar */}
                          <div style={{ marginTop:'6px',height:'4px',background:'#F1F5F9',borderRadius:'2px',overflow:'hidden' }}>
                            <div style={{ height:'100%',background:TEAL,borderRadius:'2px',width:`${l.repaymentProgress}%` }}/>
                          </div>
                          <div style={{ fontSize:'10px',color:'#94A3B8',marginTop:'2px' }}>{l.repaymentProgress}% repaid</div>
                        </div>
                        <div style={{ display:'flex',gap:'6px',flexWrap:'wrap' }}>
                          {l.status==='PENDING_APPROVAL' && <>
                            <button onClick={()=>doAction('APPROVE_LOAN',{loanId:l.id})} disabled={saving}
                              style={{ padding:'5px 10px',background:'#DCFCE7',color:GREEN,border:'none',borderRadius:'5px',fontSize:'11px',fontWeight:'600',cursor:'pointer' }}>✅ Approve</button>
                            <button onClick={()=>doAction('REJECT_LOAN',{loanId:l.id,reason:'Rejected by admin'})} disabled={saving}
                              style={{ padding:'5px 10px',background:'#FEF2F2',color:RED,border:'1px solid #FECACA',borderRadius:'5px',fontSize:'11px',cursor:'pointer' }}>❌ Reject</button>
                          </>}
                          {l.status==='APPROVED' && (
                            <button onClick={()=>doAction('DISBURSE_LOAN',{loanId:l.id})} disabled={saving}
                              style={{ padding:'5px 10px',background:TEAL,color:'white',border:'none',borderRadius:'5px',fontSize:'11px',fontWeight:'600',cursor:'pointer' }}>💳 Disburse</button>
                          )}
                          {l.status==='ACTIVE' && (
                            <button onClick={()=>doAction('REPAY_LOAN',{loanId:l.id,amountPaid:l.monthlyRepayment})} disabled={saving}
                              style={{ padding:'5px 10px',background:'#EEF2FF',color:PURPLE,border:'none',borderRadius:'5px',fontSize:'11px',fontWeight:'600',cursor:'pointer' }}>💰 Record Payment</button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* DISBURSEMENTS */}
          {tab==='disbursements' && (
            <div style={{ display:'flex',flexDirection:'column',gap:'14px' }}>
              {/* Request disbursement form */}
              {club.status==='ACTIVE' && (
                <div style={{ background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px' }}>
                  <div style={{ fontSize:'13px',fontWeight:'600',color:NAVY,marginBottom:'12px' }}>💰 Request Disbursement</div>
                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px',marginBottom:'10px' }}>
                    <div>
                      <label style={{ display:'block',fontSize:'11px',fontWeight:'600',color:'#64748B',marginBottom:'4px',textTransform:'uppercase' }}>Member *</label>
                      <select value={disbForm.userId} onChange={e=>setDisbForm(f=>({...f,userId:e.target.value}))}
                        style={{ width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',background:'white',boxSizing:'border-box' }}>
                        <option value="">Select member...</option>
                        {members.map((m:any)=><option key={m.userId} value={m.userId}>{m.fullName} (${fmt(m.totalContributed - m.loanBalance)} available)</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ display:'block',fontSize:'11px',fontWeight:'600',color:'#64748B',marginBottom:'4px',textTransform:'uppercase' }}>Amount ($) *</label>
                      <input type="number" step="0.01" min="1" value={disbForm.amount} onChange={e=>setDisbForm(f=>({...f,amount:e.target.value}))}
                        placeholder="0.00" style={{ width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box' }}/>
                    </div>
                    <div>
                      <label style={{ display:'block',fontSize:'11px',fontWeight:'600',color:'#64748B',marginBottom:'4px',textTransform:'uppercase' }}>Reason</label>
                      <input type="text" value={disbForm.reason} onChange={e=>setDisbForm(f=>({...f,reason:e.target.value}))}
                        placeholder="Reason for disbursement..." style={{ width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box' }}/>
                    </div>
                  </div>
                  <div style={{ background:'#FEF9C3',borderRadius:'8px',padding:'8px 12px',marginBottom:'10px',fontSize:'12px',color:AMBER }}>
                    ⚠️ Members can disburse their contributed balance minus any outstanding loans. This reduces their fund balance permanently.
                  </div>
                  <button onClick={()=>{ doAction('REQUEST_DISBURSEMENT',{...disbForm,amount:parseFloat(disbForm.amount)}); setDisbForm({userId:'',amount:'',reason:''}) }}
                    disabled={!disbForm.userId||!disbForm.amount||saving}
                    style={{ padding:'8px 18px',background:TEAL,color:'white',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer' }}>
                    Submit Request
                  </button>
                </div>
              )}

              {/* Disbursement list */}
              {disbs.length===0 ? (
                <div style={{ textAlign:'center',padding:'40px',color:'#94A3B8' }}>
                  <div style={{ fontSize:'32px',marginBottom:'8px' }}>💰</div>
                  <p>No disbursements yet.</p>
                </div>
              ) : (
                <div style={{ display:'flex',flexDirection:'column',gap:'8px' }}>
                  {disbs.map((d:any)=>(
                    <div key={d.id} style={{ background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'14px 16px',display:'flex',alignItems:'center',gap:'12px' }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',flexWrap:'wrap' }}>
                          <span style={{ fontSize:'14px',fontWeight:'600',color:NAVY }}>{d.memberName}</span>
                          <Pill status={d.status}/>
                          <span style={{ fontSize:'15px',fontWeight:'700',color:RED }}>-${fmt(d.amount)}</span>
                        </div>
                        <div style={{ fontSize:'12px',color:'#64748B' }}>
                          Balance before: ${fmt(d.balanceBefore)} → after: ${fmt(d.balanceAfter)}
                          {d.reason && <span> · {d.reason}</span>}
                        </div>
                      </div>
                      <div style={{ display:'flex',gap:'6px' }}>
                        {d.status==='PENDING' && <>
                          <button onClick={()=>doAction('APPROVE_DISBURSEMENT',{disbursementId:d.id})} disabled={saving}
                            style={{ padding:'5px 10px',background:'#DCFCE7',color:GREEN,border:'none',borderRadius:'5px',fontSize:'11px',fontWeight:'600',cursor:'pointer' }}>✅ Approve</button>
                        </>}
                        {d.status==='APPROVED' && (
                          <button onClick={()=>doAction('PAY_DISBURSEMENT',{disbursementId:d.id})} disabled={saving}
                            style={{ padding:'5px 10px',background:TEAL,color:'white',border:'none',borderRadius:'5px',fontSize:'11px',fontWeight:'600',cursor:'pointer' }}>💸 Mark Paid</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SETTINGS */}
          {tab==='settings' && (
            <SettingsForm club={club} groupMembers={groupMembers} onSave={(p:any)=>doAction('UPDATE_CLUB',p)} saving={saving}
              onClose={()=>doAction('CLOSE',{notes:'Closed by admin'})}/>
          )}
        </div>
      </div>
    </div>
  )
}

function SettingsForm({ club, groupMembers, onSave, saving, onClose }: any) {
  const [form, setForm] = useState({
    name: club.name, description: club.description||'',
    adminId: club.adminId||'', treasurerId: club.treasurerId||'', secretaryId: club.secretaryId||'', notes: club.notes||'',
  })
  const INPUT: React.CSSProperties = { width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' }
  const LABEL: React.CSSProperties = { display:'block',fontSize:'11px',fontWeight:'600',color:'#64748B',marginBottom:'4px',textTransform:'uppercase',letterSpacing:'0.04em' }
  const set = (k:string) => (v:string) => setForm(p=>({...p,[k]:v}))

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:'14px' }}>
      <div style={{ background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px' }}>
        <div style={{ fontSize:'13px',fontWeight:'600',color:NAVY,marginBottom:'12px' }}>⚙️ Club Settings</div>
        <div style={{ display:'flex',flexDirection:'column',gap:'12px' }}>
          <div><label style={LABEL}>Club Name</label><input type="text" value={form.name} onChange={e=>set('name')(e.target.value)} style={INPUT}/></div>
          <div><label style={LABEL}>Description</label><textarea value={form.description} onChange={e=>set('description')(e.target.value)} rows={2} style={{...INPUT,resize:'vertical' as any}}/></div>
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px' }}>
            {[['adminId','Portfolio Manager'],['treasurerId','Treasurer'],['secretaryId','Secretary']].map(([k,l])=>(
              <div key={k}>
                <label style={LABEL}>{l}</label>
                <select value={(form as any)[k]} onChange={e=>set(k)(e.target.value)} style={{...INPUT,background:'white'}}>
                  <option value="">None</option>
                  {groupMembers.map((m:any)=><option key={m.userId||m.id} value={m.userId||m.id}>{m.fullName}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px',fontSize:'12px',color:'#64748B' }}>
            ℹ️ Contribution amount, loan limit, interest rate and penalty rate cannot be changed after activation to protect member expectations. Close and create a new club to change these.
          </div>
          <div><label style={LABEL}>Notes</label><textarea value={form.notes} onChange={e=>set('notes')(e.target.value)} rows={2} style={{...INPUT,resize:'vertical' as any}}/></div>
          <button onClick={()=>onSave({...form,clubId:club.id})} disabled={saving}
            style={{ padding:'9px 20px',background:saving?'#94A3B8':TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer' }}>
            {saving?'⏳ Saving...':'Save Settings'}
          </button>
        </div>
      </div>

      {club.status!=='CLOSED' && (
        <div style={{ background:'white',borderRadius:'12px',border:'1.5px solid #FECACA',padding:'16px' }}>
          <div style={{ fontSize:'13px',fontWeight:'600',color:RED,marginBottom:'8px' }}>🔒 Close Investment Club</div>
          <p style={{ fontSize:'13px',color:'#64748B',margin:'0 0 12px' }}>Closes the club. No new contributions or loans will be accepted. Existing loans must still be settled.</p>
          <button onClick={onClose} disabled={saving}
            style={{ padding:'9px 20px',background:'#FEF2F2',color:RED,border:'1.5px solid #FECACA',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer' }}>
            🔒 Close Club
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────
export default function InvestmentPanel({ groupId, groupMembers }: { groupId:string; groupMembers:any[] }) {
  const [clubs, setClubs]       = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string|null>(null)
  const [toast, setToast]       = useState<any>(null)

  const showToast = (msg:string, type='success') => setToast({msg,type})

  const fetchClubs = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/investment?groupId=${groupId}`)
      const data = await res.json()
      if (data.success) setClubs(data.data)
    } catch {} finally { setLoading(false) }
  }, [groupId])

  useEffect(() => { fetchClubs() }, [fetchClubs])

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:'16px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
      {showCreate && <CreateClubModal groupId={groupId} groupMembers={groupMembers}
        onClose={()=>setShowCreate(false)}
        onSuccess={(msg:string)=>{ showToast(msg); fetchClubs() }}/>}
      {selectedId && <ClubDetail clubId={selectedId} groupMembers={groupMembers}
        onClose={()=>setSelectedId(null)}
        onAction={(msg:string,type='success')=>{ showToast(msg,type); fetchClubs() }}/>}

      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
        <div>
          <h3 style={{ fontSize:'16px',fontWeight:'700',color:NAVY,margin:'0 0 2px' }}>📈 Investment Clubs</h3>
          <p style={{ fontSize:'12px',color:'#64748B',margin:0 }}>Fixed contributions, indefinite term — members borrow and disburse on demand</p>
        </div>
        <div style={{ display:'flex',gap:'8px' }}>
          <button onClick={fetchClubs} style={{ padding:'7px 12px',background:'#F1F5F9',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',cursor:'pointer',color:'#475569' }}>↻</button>
          <button onClick={()=>setShowCreate(true)} style={{ padding:'8px 16px',background:TEAL,color:'white',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer' }}>+ New Club</button>
        </div>
      </div>

      {loading ? <div style={{ padding:'40px',textAlign:'center',color:'#94A3B8' }}>⏳ Loading...</div>
      : clubs.length===0 ? (
        <div style={{ background:'white',borderRadius:'12px',border:'1.5px dashed #E2E8F0',padding:'48px',textAlign:'center' }}>
          <div style={{ fontSize:'48px',marginBottom:'12px' }}>📈</div>
          <h4 style={{ fontSize:'15px',fontWeight:'600',color:NAVY,margin:'0 0 8px' }}>No Investment Clubs yet</h4>
          <p style={{ fontSize:'13px',color:'#64748B',margin:'0 0 16px' }}>Create an investment portfolio for this group. Members contribute fixed amounts and can borrow or disburse their balance anytime.</p>
          <button onClick={()=>setShowCreate(true)} style={{ padding:'9px 20px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer' }}>+ Create First Club</button>
        </div>
      ) : (
        <div style={{ display:'flex',flexDirection:'column',gap:'10px' }}>
          {clubs.map((c:any)=>{
            const sm = STATUS_COLORS[c.status]||STATUS_COLORS.SETUP
            return (
              <div key={c.id} onClick={()=>setSelectedId(c.id)}
                style={{ background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px 20px',cursor:'pointer',display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap' }}
                onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.boxShadow='0 4px 16px rgba(0,0,0,0.08)'}}
                onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.boxShadow='none'}}>
                <div style={{ width:'42px',height:'42px',borderRadius:'10px',background:`linear-gradient(135deg,${NAVY},#1E3A5F)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',flexShrink:0 }}>📈</div>
                <div style={{ flex:1,minWidth:'200px' }}>
                  <div style={{ display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'2px' }}>
                    <span style={{ fontSize:'14px',fontWeight:'700',color:NAVY }}>{c.name}</span>
                    <Pill custom={{ bg:sm.bg,color:sm.color,label:sm.label,icon:sm.icon }}/>
                  </div>
                  <div style={{ fontSize:'12px',color:'#64748B' }}>
                    {c.contributionFrequency} · ${fmt(c.contributionAmount)}/period · {c.memberCount} members
                    · Loan limit: {c.loanLimitPctDisplay}% · Interest: {c.loanInterestDisplay}% p.a.
                  </div>
                </div>
                <div style={{ display:'flex',gap:'16px',flexWrap:'wrap',flexShrink:0 }}>
                  {[{l:'Fund Value',v:`$${fmt(c.totalFundValue)}`},{l:'Contributed',v:`$${fmt(c.totalContributed)}`},{l:'Loaned',v:`$${fmt(c.totalLoaned)}`}].map(s=>(
                    <div key={s.l} style={{ textAlign:'center' }}>
                      <div style={{ fontSize:'13px',fontWeight:'700',color:NAVY }}>{s.v}</div>
                      <div style={{ fontSize:'10px',color:'#94A3B8' }}>{s.l}</div>
                    </div>
                  ))}
                </div>
                <span style={{ fontSize:'18px',color:'#CBD5E1',flexShrink:0 }}>→</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
