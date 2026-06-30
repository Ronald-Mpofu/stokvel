'use client'
import { useState, useEffect, useCallback } from 'react'

const TEAL = '#0F6E56'; const NAVY = '#0D2137'; const PURPLE = '#7C3AED'

const STATUS_META: Record<string, any> = {
  DRAFT:              { bg:'#F1F5F9', color:'#475569', icon:'📝', label:'Draft'            },
  PENDING_REVIEW:     { bg:'#DBEAFE', color:'#1E40AF', icon:'🔍', label:'Pending Review'   },
  PENDING_APPROVAL:   { bg:'#FEF9C3', color:'#854D0E', icon:'⏳', label:'Pending Approval' },
  APPROVED:           { bg:'#F3E8FF', color:'#6B21A8', icon:'✅', label:'Approved'         },
  ACTIVE:             { bg:'#DCFCE7', color:'#166534', icon:'💰', label:'Active'            },
  DISBURSED:          { bg:'#DCFCE7', color:'#166534', icon:'💸', label:'Disbursed'        },
  SETTLED:            { bg:'#F0FDF4', color:'#14532D', icon:'🏆', label:'Settled'          },
  DEFAULTED:          { bg:'#FEE2E2', color:'#991B1B', icon:'⚠️', label:'Defaulted'       },
  REJECTED:           { bg:'#FEE2E2', color:'#7F1D1D', icon:'❌', label:'Rejected'         },
  CANCELLED:          { bg:'#F1F5F9', color:'#475569', icon:'🚫', label:'Cancelled'        },
}

const TYPE_META: Record<string, any> = {
  STANDARD:  { bg:'#EEF2FF', color:'#3730A3', label:'Standard'  },
  EMERGENCY: { bg:'#FEF2F2', color:'#991B1B', label:'Emergency' },
  BUSINESS:  { bg:'#F0FDF4', color:'#166534', label:'Business'  },
}

const TIER_COLORS: Record<string, [string,string]> = {
  PLATINUM: ['#E9D5FF','#5B21B6'], GOLD: ['#FEF3C7','#92400E'],
  SILVER:   ['#F1F5F9','#475569'], BRONZE: ['#FEE2E2','#7F1D1D'],
}

const fmt = (n: number) => new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)

function Toast({ msg, type, onClose }: any) {
  useEffect(() => { const t = setTimeout(onClose, 5000); return () => clearTimeout(t) }, [onClose])
  return <div style={{ position:'fixed',top:'20px',right:'20px',zIndex:9999,padding:'12px 20px',borderRadius:'10px',fontWeight:'500',fontSize:'13px',boxShadow:'0 8px 25px rgba(0,0,0,0.15)',background:type==='success'?'#166534':'#991B1B',color:'white',display:'flex',alignItems:'center',gap:'10px',maxWidth:'420px' }}>
    <span>{type==='success'?'✅':'❌'}</span><span style={{flex:1}}>{msg}</span>
    <button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'18px'}}>×</button>
  </div>
}

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.DRAFT
  return <span style={{ background:m.bg, color:m.color, fontSize:'11px', fontWeight:'600', padding:'3px 9px', borderRadius:'999px', display:'inline-flex', alignItems:'center', gap:'4px', whiteSpace:'nowrap' }}>{m.icon} {m.label}</span>
}

function TierBadge({ tier }: any) {
  const [bg, color] = TIER_COLORS[tier] || TIER_COLORS.BRONZE
  return <span style={{ background:bg, color, fontSize:'10px', fontWeight:'700', padding:'2px 7px', borderRadius:'4px' }}>{tier}</span>
}

// ── Apply for Loan Modal ──────────────────────────────────────
function ApplyModal({ groups, members, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ groupId:'', borrowerId:'', type:'STANDARD', amount:'', interestRatePa:'0.24', termMonths:'12', purpose:'', isEmergency:false, guarantors:[] as {fullName:string;email:string;phone:string}[] })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k: string) => (v: any) => setForm(p => ({ ...p, [k]: v }))

  const monthlyRate = parseFloat(form.interestRatePa) / 12
  const monthlyAmt  = monthlyRate > 0 && parseFloat(form.amount) > 0 && parseInt(form.termMonths) > 0
    ? (parseFloat(form.amount) * monthlyRate * Math.pow(1+monthlyRate,parseInt(form.termMonths))) / (Math.pow(1+monthlyRate,parseInt(form.termMonths))-1)
    : parseFloat(form.amount||'0') / Math.max(1, parseInt(form.termMonths||'1'))
  const totalRepay  = monthlyAmt * parseInt(form.termMonths||'1')
  const totalInt    = totalRepay - parseFloat(form.amount||'0')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const res  = await fetch('/api/loans', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...form, amount:parseFloat(form.amount), interestRatePa:parseFloat(form.interestRatePa), termMonths:parseInt(form.termMonths), guarantorIds:[] }) })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error || 'Failed')
    } catch { setError('Network error') } finally { setSaving(false) }
  }

  const groupMembers = members.filter((m: any) => m.groupId === form.groupId)
  // Guarantors are external — no need to filter members

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px' }}>
      <div style={{ background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'580px',maxHeight:'92vh',overflowY:'auto',boxShadow:'0 25px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px' }}>
          <h3 style={{ fontSize:'17px',fontWeight:'700',color:NAVY,margin:0 }}>💰 New Loan Application</h3>
          <button onClick={onClose} style={{ background:'#F1F5F9',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px' }}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          {/* Group + Borrower */}
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'14px' }}>
            <div>
              <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Group *</label>
              <select value={form.groupId} onChange={e=>set('groupId')(e.target.value)} required style={{ width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as any }}>
                <option value="">Select group...</option>
                {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Borrower *</label>
              <select value={form.borrowerId} onChange={e=>set('borrowerId')(e.target.value)} required disabled={!form.groupId} style={{ width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as any }}>
                <option value="">Select member...</option>
                {groupMembers.map((m: any) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}
              </select>
            </div>
          </div>

          {/* Loan type */}
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'6px' }}>Loan Type</label>
            <div style={{ display:'flex',gap:'8px' }}>
              {['STANDARD','EMERGENCY','BUSINESS'].map(t => {
                const tm = TYPE_META[t]
                return <div key={t} onClick={() => set('type')(t)}
                  style={{ flex:1,padding:'9px 8px',borderRadius:'8px',cursor:'pointer',border:`2px solid ${form.type===t?NAVY:'#E2E8F0'}`,background:form.type===t?tm.bg:'white',fontSize:'12px',fontWeight:'500',color:NAVY,textAlign:'center' }}>
                  {t}
                </div>
              })}
            </div>
          </div>

          {/* Financial details */}
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px',marginBottom:'14px' }}>
            <div>
              <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Amount ($) *</label>
              <div style={{ position:'relative' }}>
                <span style={{ position:'absolute',left:'10px',top:'50%',transform:'translateY(-50%)',color:'#64748B' }}>$</span>
                <input type="number" step="0.01" value={form.amount} onChange={e=>set('amount')(e.target.value)} required placeholder="0.00"
                  style={{ width:'100%',padding:'9px 10px 9px 24px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'14px',fontWeight:'600',outline:'none',boxSizing:'border-box' as any }} />
              </div>
            </div>
            <div>
              <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Interest Rate (p.a.)</label>
              <div style={{ position:'relative' }}>
                <input type="number" step="0.01" value={(parseFloat(form.interestRatePa)*100).toFixed(0)} onChange={e=>set('interestRatePa')((parseFloat(e.target.value)/100).toString())} placeholder="24"
                  style={{ width:'100%',padding:'9px 28px 9px 10px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any }} />
                <span style={{ position:'absolute',right:'10px',top:'50%',transform:'translateY(-50%)',color:'#64748B',fontSize:'12px' }}>%</span>
              </div>
            </div>
            <div>
              <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Term (months) *</label>
              <select value={form.termMonths} onChange={e=>set('termMonths')(e.target.value)} style={{ width:'100%',padding:'9px 10px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as any }}>
                {[1,2,3,6,9,12,18,24,36,48,60].map(m => <option key={m} value={m}>{m} month{m!==1?'s':''}</option>)}
              </select>
            </div>
          </div>

          {/* Live calculator */}
          {parseFloat(form.amount||'0') > 0 && (
            <div style={{ background:'#F0FDF4',borderRadius:'10px',padding:'14px',marginBottom:'14px',border:'1px solid #BBF7D0' }}>
              <div style={{ fontSize:'12px',fontWeight:'600',color:'#166534',marginBottom:'8px' }}>📊 Loan Calculator</div>
              <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px' }}>
                {[['Monthly Instalment',`$${fmt(monthlyAmt)}`],['Total Repayment',`$${fmt(totalRepay)}`],['Total Interest',`$${fmt(Math.max(0,totalInt))}`]].map(([l,v])=>(
                  <div key={l} style={{ background:'white',borderRadius:'6px',padding:'8px 10px' }}>
                    <div style={{ fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em' }}>{l}</div>
                    <div style={{ fontSize:'14px',fontWeight:'700',color:l==='Total Interest'?'#854D0E':'#166534' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Purpose */}
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Purpose *</label>
            <textarea value={form.purpose} onChange={e=>set('purpose')(e.target.value)} required rows={2} placeholder="Describe how the loan will be used..."
              style={{ width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any,resize:'vertical' as any }} />
          </div>

          {/* Guarantors — external, optional */}
          <div style={{ marginBottom:'14px' }}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px' }}>
              <label style={{ fontSize:'12px',fontWeight:'600',color:'#374151' }}>Guarantors <span style={{ color:'#94A3B8',fontWeight:'400' }}>(optional — they will receive an email to approve)</span></label>
              <button type="button" onClick={()=>set('guarantors')([...form.guarantors,{fullName:'',email:'',phone:''}])}
                style={{ fontSize:'11px',color:TEAL,background:'none',border:'none',cursor:'pointer',fontWeight:'600' }}>+ Add Guarantor</button>
            </div>
            {form.guarantors.map((g: any, i: number) => (
              <div key={i} style={{ background:'#F8FAFC',borderRadius:'10px',padding:'12px',marginBottom:'8px',border:'1px solid #E2E8F0' }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px' }}>
                  <span style={{ fontSize:'12px',fontWeight:'600',color:NAVY }}>Guarantor #{i+1}</span>
                  <button type="button" onClick={()=>set('guarantors')(form.guarantors.filter((_:any,j:number)=>j!==i))}
                    style={{ fontSize:'11px',color:'#991B1B',background:'none',border:'none',cursor:'pointer' }}>Remove</button>
                </div>
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px' }}>
                  {[['fullName','Full Name','John Moyo'],['email','Email','john@email.com'],['phone','Phone','+263 77...']].map(([k,l,p])=>(
                    <div key={k}>
                      <label style={{ display:'block',fontSize:'10px',fontWeight:'600',color:'#64748B',marginBottom:'3px',textTransform:'uppercase' }}>{l} *</label>
                      <input type={k==='email'?'email':'text'} value={g[k]} required
                        onChange={e=>{ const arr=[...form.guarantors]; arr[i]={...arr[i],[k]:e.target.value}; set('guarantors')(arr) }}
                        placeholder={p}
                        style={{ width:'100%',padding:'7px 10px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none',boxSizing:'border-box' as any }} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {form.guarantors.length===0&&<p style={{ fontSize:'12px',color:'#94A3B8',margin:0 }}>No guarantors added. Click "+ Add Guarantor" to add one.</p>}
          </div>

          {/* Emergency toggle */}
          <div onClick={() => set('isEmergency')(!form.isEmergency)} style={{ display:'flex',alignItems:'center',gap:'10px',marginBottom:'16px',cursor:'pointer',background:'#FEF9C3',borderRadius:'8px',padding:'10px 14px',border:`1px solid ${form.isEmergency?'#FCD34D':'#E2E8F0'}` }}>
            <div style={{ width:'20px',height:'20px',borderRadius:'4px',border:`2px solid ${form.isEmergency?'#854D0E':'#CBD5E1'}`,background:form.isEmergency?'#854D0E':'white',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
              {form.isEmergency&&<span style={{ color:'white',fontSize:'13px',fontWeight:'700' }}>✓</span>}
            </div>
            <span style={{ fontSize:'12px',color:'#854D0E',fontWeight:'500' }}>🚨 Emergency loan — skips treasurer review, goes directly to admin approval</span>
          </div>

          {error && <div style={{ background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',marginBottom:'12px' }}>❌ {error}</div>}

          <div style={{ display:'flex',gap:'10px' }}>
            <button type="button" onClick={onClose} style={{ flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white' }}>
              {saving?'⏳ Submitting...':'💰 Submit Application'}
            </button>
          </div>
        </form>
      </div>
    </div></>
  )
}


// ── Guarantor Management Panel ────────────────────────────────
function GuarantorPanel({ loanId, onMessage }: { loanId: string; onMessage: (msg: string, type?: string) => void }) {
  const [guarantors, setGuarantors] = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [showAdd, setShowAdd]       = useState(false)
  const [form, setForm]             = useState({ fullName:'', email:'', phone:'' })
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  const fetchGuarantors = useCallback(async () => {
    const res  = await fetch(`/api/loans/guarantor?loanId=${loanId}`)
    const data = await res.json()
    if (data.success) setGuarantors(data.data)
    setLoading(false)
  }, [loanId])

  useEffect(() => { fetchGuarantors() }, [fetchGuarantors])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const res  = await fetch('/api/loans/guarantor', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ loanId, ...form }) })
      const data = await res.json()
      if (data.success) { onMessage(data.message); setForm({ fullName:'', email:'', phone:'' }); setShowAdd(false); fetchGuarantors() }
      else setError(data.error || 'Failed')
    } catch { setError('Network error') } finally { setSaving(false) }
  }

  async function handleAction(action: string, guarantorId: string) {
    try {
      const res  = await fetch('/api/loans/guarantor', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action, guarantorId }) })
      const data = await res.json()
      if (data.success) { onMessage(data.message); fetchGuarantors() }
      else onMessage(data.error || 'Failed', 'error')
    } catch { onMessage('Network error', 'error') }
  }

  const STATUS_COLORS: Record<string,any> = {
    PENDING:  { bg:'#FEF9C3', color:'#854D0E', icon:'⏳' },
    APPROVED: { bg:'#DCFCE7', color:'#166534', icon:'✅' },
    DECLINED: { bg:'#FEE2E2', color:'#991B1B', icon:'❌' },
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
        <span style={{ fontSize:'13px', fontWeight:'600', color:NAVY }}>Guarantors ({guarantors.length})</span>
        <button onClick={() => setShowAdd(s => !s)} style={{ fontSize:'12px', color:TEAL, background:'none', border:'none', cursor:'pointer', fontWeight:'600' }}>
          {showAdd ? '✕ Cancel' : '+ Add Guarantor'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} style={{ background:'#F8FAFC', borderRadius:'10px', padding:'14px', marginBottom:'12px', border:'1px solid #E2E8F0' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px', marginBottom:'10px' }}>
            {[['fullName','Full Name','John Moyo'],['email','Email','john@example.com'],['phone','Phone','+263 77...']].map(([k,l,p]) => (
              <div key={k}>
                <label style={{ display:'block', fontSize:'10px', fontWeight:'600', color:'#64748B', marginBottom:'3px', textTransform:'uppercase' as any }}>{l} *</label>
                <input type={k==='email'?'email':'text'} value={(form as any)[k]} required
                  onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} placeholder={p}
                  style={{ width:'100%', padding:'7px 10px', border:'1.5px solid #E2E8F0', borderRadius:'6px', fontSize:'12px', outline:'none', boxSizing:'border-box' as any }} />
              </div>
            ))}
          </div>
          {error && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'6px', padding:'8px', color:'#991B1B', fontSize:'12px', marginBottom:'8px' }}>❌ {error}</div>}
          <button type="submit" disabled={saving} style={{ padding:'7px 18px', background:saving?'#94A3B8':TEAL, color:'white', border:'none', borderRadius:'6px', fontSize:'12px', fontWeight:'600', cursor:saving?'not-allowed':'pointer' }}>
            {saving ? '⏳ Sending...' : '✉️ Send Guarantee Request'}
          </button>
        </form>
      )}

      {loading ? <div style={{ fontSize:'12px', color:'#94A3B8', padding:'8px 0' }}>Loading...</div>
      : guarantors.length === 0 ? (
        <div style={{ fontSize:'12px', color:'#94A3B8', textAlign:'center', padding:'16px 0' }}>
          No guarantors added. Click "+ Add Guarantor" to request a guarantee.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
          {guarantors.map((g: any) => {
            const sm = STATUS_COLORS[g.status] || STATUS_COLORS.PENDING
            return (
              <div key={g.id} style={{ background:'#F8FAFC', borderRadius:'10px', padding:'12px 14px', border:'1px solid #E2E8F0', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                <div style={{ width:'36px', height:'36px', borderRadius:'50%', background:'#E1F5EE', color:TEAL, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:'700', flexShrink:0 }}>
                  {g.fullName.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'13px', fontWeight:'500', color:NAVY }}>{g.fullName}</div>
                  <div style={{ fontSize:'11px', color:'#94A3B8' }}>{g.email} · {g.phone}</div>
                  {g.rejectedReason && <div style={{ fontSize:'11px', color:'#991B1B', marginTop:'2px' }}>Reason: {g.rejectedReason}</div>}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', flexShrink:0 }}>
                  <span style={{ background:sm.bg, color:sm.color, fontSize:'10px', fontWeight:'600', padding:'2px 7px', borderRadius:'4px' }}>{sm.icon} {g.status}</span>
                  {g.status === 'PENDING' && (
                    <>
                      <span style={{ fontSize:'10px', color:'#94A3B8' }}>{g.daysLeft}d left</span>
                      <button onClick={() => handleAction('RESEND', g.id)} title="Resend email"
                        style={{ padding:'3px 8px', background:'#EEF2FF', color:'#3730A3', border:'none', borderRadius:'4px', fontSize:'10px', cursor:'pointer' }}>↻ Resend</button>
                    </>
                  )}
                  {g.emailSentAt && <span title={`Email sent ${new Date(g.emailSentAt).toLocaleDateString()}`} style={{ fontSize:'12px' }}>📧</span>}
                  <button onClick={() => handleAction('REMOVE', g.id)} title="Remove guarantor"
                    style={{ padding:'3px 8px', background:'#FEF2F2', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'4px', fontSize:'10px', cursor:'pointer' }}>Remove</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Loan Detail Panel ─────────────────────────────────────────
function LoanDetail({ loanId, adminId, onClose, onAction }: any) {
  const [loan, setLoan]         = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<'overview'|'schedule'|'review'>('overview')
  const [repayModal, setRepayModal] = useState<any>(null)
  const [reviewForm, setReviewForm] = useState({ notes:'', rejectionReason:'', disbursementRef:'' })
  const [actioning, setActioning] = useState(false)

  const fetchLoan = useCallback(async () => {
    const res  = await fetch(`/api/loans?loanId=${loanId}`)
    const data = await res.json()
    if (data.success) setLoan(data.data)
    setLoading(false)
  }, [loanId])

  useEffect(() => { fetchLoan() }, [fetchLoan])

  async function handleAction(action: string) {
    setActioning(true)
    try {
      const res  = await fetch('/api/loans', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'REVIEW', loanId, action, reviewerId: adminId, ...reviewForm }) })
      const data = await res.json()
      if (data.success) { onAction(data.message); fetchLoan() }
      else onAction(data.error || 'Failed', 'error')
    } catch { onAction('Network error', 'error') } finally { setActioning(false) }
  }

  async function recordRepayment(repaymentId: string, amount: number, method: string, ref: string) {
    try {
      const res  = await fetch('/api/loans/repayments', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ loanId, repaymentId, amountPaid:amount, paymentMethod:method, paymentRef:ref }) })
      const data = await res.json()
      if (data.success) { onAction(data.message); fetchLoan(); setRepayModal(null) }
      else onAction(data.error || 'Failed', 'error')
    } catch { onAction('Network error', 'error') }
  }

  if (loading) return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 }}>
      <div style={{ background:'white',borderRadius:'16px',padding:'40px',textAlign:'center' }}><div style={{ fontSize:'32px',marginBottom:'12px' }}>⏳</div>Loading...</div>
    </div>
  )

  if (!loan) return null

  const sm = STATUS_META[loan.status] || STATUS_META.DRAFT
  const canApprove  = ['PENDING_REVIEW','PENDING_APPROVAL'].includes(loan.status)
  const canTreasurer = loan.status === 'PENDING_REVIEW'
  const canDisburse = loan.status === 'APPROVED'
  const canReject   = ['PENDING_REVIEW','PENDING_APPROVAL','APPROVED'].includes(loan.status)
  const canRepay    = ['ACTIVE','DISBURSED'].includes(loan.status)

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px' }}>
      <div style={{ background:'white',borderRadius:'16px',width:'100%',maxWidth:'680px',maxHeight:'92vh',display:'flex',flexDirection:'column',boxShadow:'0 25px 60px rgba(0,0,0,0.3)',overflow:'hidden' }}>

        {/* Header */}
        <div style={{ background:NAVY,padding:'20px 24px',flexShrink:0 }}>
          <div style={{ display:'flex',alignItems:'flex-start',gap:'14px' }}>
            <div style={{ width:'44px',height:'44px',borderRadius:'50%',background:TEAL,color:'white',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px',fontWeight:'700',flexShrink:0 }}>
              {loan.borrowerName?.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'3px' }}>
                <span style={{ fontSize:'16px',fontWeight:'700',color:'white' }}>{loan.borrowerName}</span>
                <StatusPill status={loan.status} />
                <span style={{ background:TYPE_META[loan.type]?.bg,color:TYPE_META[loan.type]?.color,fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px' }}>{loan.type}</span>
                {loan.isEmergency && <span style={{ background:'#FEE2E2',color:'#991B1B',fontSize:'10px',fontWeight:'700',padding:'2px 7px',borderRadius:'4px' }}>🚨 EMERGENCY</span>}
              </div>
              <div style={{ fontSize:'12px',color:'rgba(255,255,255,0.6)' }}>{loan.groupName} · Applied {new Date(loan.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
            </div>
            <button onClick={onClose} style={{ width:'32px',height:'32px',background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'18px',color:'white' }}>×</button>
          </div>
          {/* Financial strip */}
          <div style={{ display:'flex',gap:'20px',marginTop:'14px',paddingTop:'14px',borderTop:'1px solid rgba(255,255,255,0.1)',flexWrap:'wrap' }}>
            {[
              {l:'Loan Amount',      v:`$${fmt(loan.amount)}`              },
              {l:'Outstanding',      v:`$${fmt(loan.outstandingBalance)}`  },
              {l:'Monthly Instalment',v:`$${fmt(parseFloat(loan.monthlyInstalment))}`},
              {l:'Term',             v:`${loan.termMonths} months`         },
              {l:'Rate',             v:`${loan.interestRatePct}% p.a.`    },
            ].map(s => (
              <div key={s.l}>
                <div style={{ fontSize:'10px',color:'rgba(255,255,255,0.5)',textTransform:'uppercase',letterSpacing:'0.04em' }}>{s.l}</div>
                <div style={{ fontSize:'15px',fontWeight:'700',color:'white',marginTop:'2px' }}>{s.v}</div>
              </div>
            ))}
          </div>
          {/* Repayment progress bar */}
          {canRepay && (
            <div style={{ marginTop:'12px' }}>
              <div style={{ display:'flex',justifyContent:'space-between',fontSize:'11px',color:'rgba(255,255,255,0.6)',marginBottom:'4px' }}>
                <span>Repayment progress</span>
                <span style={{ fontWeight:'600',color:'rgba(255,255,255,0.9)' }}>{loan.repaymentProgress}%</span>
              </div>
              <div style={{ height:'8px',background:'rgba(255,255,255,0.15)',borderRadius:'4px',overflow:'hidden' }}>
                <div style={{ height:'100%',background:'rgba(255,255,255,0.8)',borderRadius:'4px',width:`${loan.repaymentProgress}%`,transition:'width 0.5s' }} />
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        {(canApprove || canDisburse || canReject || canRepay) && (
          <div style={{ padding:'10px 20px',background:'#F8FAFC',borderBottom:'1px solid #E2E8F0',display:'flex',gap:'8px',flexWrap:'wrap',flexShrink:0 }}>
            {canTreasurer && <button onClick={()=>handleAction('TREASURER_REVIEW')} disabled={actioning} style={{ padding:'7px 14px',background:'#DBEAFE',color:'#1E40AF',border:'1px solid #93C5FD',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer' }}>🔍 Treasurer Review</button>}
            {canApprove   && <button onClick={()=>handleAction('APPROVE')}  disabled={actioning} style={{ padding:'7px 14px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer' }}>✅ Approve</button>}
            {canDisburse  && <button onClick={()=>{setTab('review')}} style={{ padding:'7px 14px',background:PURPLE,color:'white',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer' }}>💸 Disburse</button>}
            {canReject    && <button onClick={()=>handleAction('REJECT')}   disabled={actioning} style={{ padding:'7px 14px',background:'#FEF2F2',color:'#991B1B',border:'1px solid #FECACA',borderRadius:'8px',fontSize:'12px',cursor:'pointer' }}>❌ Reject</button>}
            {canRepay     && <button onClick={()=>setRepayModal(loan.repayments?.find((r:any)=>r.status!=='PAID'&&r.status!=='WAIVED'))} style={{ padding:'7px 14px',background:'#F0FDF4',color:'#166534',border:'1px solid #86EFAC',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer' }}>💳 Record Payment</button>}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display:'flex',borderBottom:'1px solid #E2E8F0',flexShrink:0 }}>
          {[['overview','📋 Overview'],['schedule','📅 Repayment Schedule'],['review','📝 Review Notes']].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id as any)} style={{ padding:'10px 16px',background:'none',border:'none',borderBottom:tab===id?`2px solid ${TEAL}`:'2px solid transparent',color:tab===id?TEAL:'#64748B',fontWeight:tab===id?'600':'400',fontSize:'13px',cursor:'pointer',marginBottom:'-1px' }}>{label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex:1,overflowY:'auto',padding:'18px 22px' }}>

          {/* Overview tab */}
          {tab === 'overview' && (
            <div style={{ display:'flex',flexDirection:'column',gap:'14px' }}>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px' }}>
                {[
                  ['Borrower',    loan.borrowerName],
                  ['Email',       loan.borrowerEmail],
                  ['Tier',        loan.borrowerTier],
                  ['Score',       `${Number(loan.borrowerScore).toFixed(0)} pts`],
                  ['Purpose',     loan.purpose],
                  ['Group',       loan.groupName],
                  ['Applied',     new Date(loan.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})],
                  ['Settlement',  loan.settlementDate ? new Date(loan.settlementDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'],
                  ['Disbursed',   loan.disbursedAt ? new Date(loan.disbursedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'],
                  ['Settled',     loan.settledAt ? new Date(loan.settledAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'],
                ].map(([l,v])=>(
                  <div key={l} style={{ background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px' }}>
                    <div style={{ fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'3px' }}>{l}</div>
                    <div style={{ fontSize:'13px',fontWeight:'500',color:NAVY }}>{v}</div>
                  </div>
                ))}
              </div>
              {/* Guarantors */}
              <div style={{ background:'#F8FAFC',borderRadius:'10px',padding:'14px',border:'1px solid #E2E8F0' }}>
                <GuarantorPanel loanId={loan.id} onMessage={onAction} />
              </div>
              {/* Overdue alert */}
              {loan.overdueCount > 0 && (
                <div style={{ background:'#FEE2E2',border:'1px solid #FECACA',borderRadius:'10px',padding:'12px 14px',fontSize:'13px',color:'#991B1B' }}>
                  ⚠️ <strong>{loan.overdueCount} overdue instalment{loan.overdueCount!==1?'s':''}</strong> — immediate action required.
                </div>
              )}
            </div>
          )}

          {/* Schedule tab */}
          {tab === 'schedule' && (
            <div>
              {loan.repayments?.length === 0 ? (
                <div style={{ textAlign:'center',padding:'40px',color:'#94A3B8' }}>No repayment schedule generated yet.</div>
              ) : (
                <table style={{ width:'100%',borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ background:'#F8FAFC' }}>
                      {['#','Due Date','Principal','Interest','Total Due','Paid','Status','Action'].map(h=>(
                        <th key={h} style={{ padding:'8px 10px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase',whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loan.repayments.map((r: any)=>{
                      const isPaid   = r.status === 'PAID'
                      const isOverdue = r.isOverdue && !isPaid
                      return (
                        <tr key={r.id} style={{ borderBottom:'1px solid #F8FAFC',background:isPaid?'#F0FDF4':isOverdue?'#FFF5F5':'white' }}>
                          <td style={{ padding:'9px 10px',fontSize:'12px',fontWeight:'700',color:NAVY }}>#{r.installmentNo}</td>
                          <td style={{ padding:'9px 10px',fontSize:'12px',color:isOverdue?'#991B1B':'#475569',whiteSpace:'nowrap',fontWeight:isOverdue?'600':'400' }}>
                            {new Date(r.dueDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'})}
                            {isOverdue && <span style={{ marginLeft:'4px',fontSize:'10px' }}>⚠️</span>}
                          </td>
                          <td style={{ padding:'9px 10px',fontSize:'12px',color:'#475569' }}>${fmt(r.principalDue)}</td>
                          <td style={{ padding:'9px 10px',fontSize:'12px',color:'#854D0E' }}>${fmt(r.interestDue)}</td>
                          <td style={{ padding:'9px 10px',fontSize:'13px',fontWeight:'600',color:NAVY }}>${fmt(r.totalDue)}</td>
                          <td style={{ padding:'9px 10px',fontSize:'13px',fontWeight:'600',color:TEAL }}>${fmt(r.amountPaid)}</td>
                          <td style={{ padding:'9px 10px' }}>
                            <span style={{ background:isPaid?'#DCFCE7':isOverdue?'#FEE2E2':'#F1F5F9',color:isPaid?'#166534':isOverdue?'#991B1B':'#475569',fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px' }}>
                              {isPaid ? '✓ PAID' : isOverdue ? '⚠️ OVERDUE' : 'PENDING'}
                            </span>
                          </td>
                          <td style={{ padding:'9px 10px' }}>
                            {canRepay && !isPaid && (
                              <button onClick={()=>setRepayModal(r)} style={{ padding:'3px 8px',background:TEAL,color:'white',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer',fontWeight:'600' }}>Pay</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'#F8FAFC',borderTop:'2px solid #E2E8F0' }}>
                      <td colSpan={4} style={{ padding:'10px',fontSize:'12px',fontWeight:'600',color:NAVY }}>Totals</td>
                      <td style={{ padding:'10px',fontSize:'13px',fontWeight:'700',color:NAVY }}>${fmt(loan.repayments.reduce((s:number,r:any)=>s+r.totalDue,0))}</td>
                      <td style={{ padding:'10px',fontSize:'13px',fontWeight:'700',color:TEAL }}>${fmt(loan.repayments.reduce((s:number,r:any)=>s+r.amountPaid,0))}</td>
                      <td colSpan={2} style={{ padding:'10px',fontSize:'12px',color:'#64748B' }}>Outstanding: <strong style={{ color:'#991B1B' }}>${fmt(loan.outstandingBalance)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* Review / Disburse tab */}
          {tab === 'review' && (
            <div style={{ display:'flex',flexDirection:'column',gap:'14px' }}>
              {loan.treasurerNotes && (
                <div style={{ background:'#DBEAFE',borderRadius:'8px',padding:'12px 14px',border:'1px solid #93C5FD' }}>
                  <div style={{ fontSize:'11px',fontWeight:'600',color:'#1E40AF',marginBottom:'4px' }}>TREASURER NOTES</div>
                  <div style={{ fontSize:'13px',color:'#1E3A5F' }}>{loan.treasurerNotes}</div>
                </div>
              )}
              {loan.adminNotes && (
                <div style={{ background:'#F0FDF4',borderRadius:'8px',padding:'12px 14px',border:'1px solid #86EFAC' }}>
                  <div style={{ fontSize:'11px',fontWeight:'600',color:'#166534',marginBottom:'4px' }}>ADMIN NOTES</div>
                  <div style={{ fontSize:'13px',color:'#14532D' }}>{loan.adminNotes}</div>
                </div>
              )}
              {loan.rejectionReason && (
                <div style={{ background:'#FEF2F2',borderRadius:'8px',padding:'12px 14px',border:'1px solid #FECACA' }}>
                  <div style={{ fontSize:'11px',fontWeight:'600',color:'#991B1B',marginBottom:'4px' }}>REJECTION REASON</div>
                  <div style={{ fontSize:'13px',color:'#7F1D1D' }}>{loan.rejectionReason}</div>
                </div>
              )}
              {(canApprove || canDisburse || canTreasurer) && (
                <>
                  <div>
                    <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Review Notes</label>
                    <textarea value={reviewForm.notes} onChange={e=>setReviewForm(f=>({...f,notes:e.target.value}))} rows={3} placeholder="Add notes about this loan application..."
                      style={{ width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any,resize:'vertical' as any }} />
                  </div>
                  {canDisburse && (
                    <div>
                      <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Disbursement Reference</label>
                      <input type="text" value={reviewForm.disbursementRef} onChange={e=>setReviewForm(f=>({...f,disbursementRef:e.target.value}))} placeholder="Bank ref / EcoCash ref..."
                        style={{ width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any }} />
                    </div>
                  )}
                  {canReject && (
                    <div>
                      <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Rejection Reason (if rejecting)</label>
                      <input type="text" value={reviewForm.rejectionReason} onChange={e=>setReviewForm(f=>({...f,rejectionReason:e.target.value}))} placeholder="Reason for rejection..."
                        style={{ width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any }} />
                    </div>
                  )}
                  <div style={{ display:'flex',gap:'8px',flexWrap:'wrap' }}>
                    {canTreasurer && <button onClick={()=>handleAction('TREASURER_REVIEW')} disabled={actioning} style={{ padding:'9px 18px',background:'#DBEAFE',color:'#1E40AF',border:'1px solid #93C5FD',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer' }}>🔍 Submit Review</button>}
                    {canApprove   && <button onClick={()=>handleAction('APPROVE')}          disabled={actioning} style={{ padding:'9px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer' }}>✅ Approve Loan</button>}
                    {canDisburse  && <button onClick={()=>handleAction('DISBURSE')}         disabled={actioning} style={{ padding:'9px 18px',background:PURPLE,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer' }}>💸 Confirm Disbursement</button>}
                    {canReject    && <button onClick={()=>handleAction('REJECT')}           disabled={actioning} style={{ padding:'9px 18px',background:'#FEF2F2',color:'#991B1B',border:'1px solid #FECACA',borderRadius:'8px',fontSize:'13px',cursor:'pointer' }}>❌ Reject</button>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Repayment sub-modal */}
      {repayModal && <RepayModal repayment={repayModal} onClose={()=>setRepayModal(null)} onConfirm={recordRepayment} />}
    </div>
  )
}

// ── Repayment Modal ───────────────────────────────────────────
function RepayModal({ repayment, onClose, onConfirm }: any) {
  const [amount, setAmount]   = useState(repayment.totalDue.toFixed(2))
  const [method, setMethod]   = useState('ECOCASH')
  const [ref, setRef]         = useState('')
  const [saving, setSaving]   = useState(false)

  async function handle(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await onConfirm(repayment.id, parseFloat(amount), method, ref)
    setSaving(false)
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1100 }}>
      <div style={{ background:'white',borderRadius:'16px',padding:'28px',width:'420px',boxShadow:'0 25px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px' }}>
          <div>
            <h3 style={{ fontSize:'16px',fontWeight:'700',color:NAVY,margin:'0 0 2px' }}>💳 Record Repayment</h3>
            <p style={{ fontSize:'12px',color:'#64748B',margin:0 }}>Instalment #{repayment.installmentNo} · Due {new Date(repayment.dueDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</p>
          </div>
          <button onClick={onClose} style={{ background:'#F1F5F9',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px' }}>×</button>
        </div>
        <div style={{ background:'#F8FAFC',borderRadius:'8px',padding:'10px 14px',marginBottom:'14px',fontSize:'12px',color:'#64748B',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'6px' }}>
          <div><div style={{ fontSize:'10px',color:'#94A3B8' }}>PRINCIPAL</div><div style={{ fontWeight:'600',color:NAVY }}>${fmt(repayment.principalDue)}</div></div>
          <div><div style={{ fontSize:'10px',color:'#94A3B8' }}>INTEREST</div><div style={{ fontWeight:'600',color:'#854D0E' }}>${fmt(repayment.interestDue)}</div></div>
          <div><div style={{ fontSize:'10px',color:'#94A3B8' }}>TOTAL DUE</div><div style={{ fontWeight:'700',color:TEAL }}>${fmt(repayment.totalDue)}</div></div>
        </div>
        <form onSubmit={handle}>
          <div style={{ marginBottom:'12px' }}>
            <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Amount Paid ($) *</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute',left:'10px',top:'50%',transform:'translateY(-50%)',color:'#64748B' }}>$</span>
              <input type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required
                style={{ width:'100%',padding:'9px 10px 9px 24px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'14px',fontWeight:'600',outline:'none',boxSizing:'border-box' as any }} />
            </div>
            <button type="button" onClick={()=>setAmount(repayment.totalDue.toFixed(2))} style={{ marginTop:'4px',fontSize:'11px',color:TEAL,background:'none',border:'none',cursor:'pointer',padding:0 }}>
              Fill full amount: ${fmt(repayment.totalDue)}
            </button>
          </div>
          <div style={{ marginBottom:'12px' }}>
            <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Payment Method</label>
            <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'6px' }}>
              {[['ECOCASH','📱 EcoCash'],['BANK_TRANSFER','🏦 Bank'],['CARD','💳 Card'],['INTERNAL_TRANSFER','🔄 Internal']].map(([v,l])=>(
                <div key={v} onClick={()=>setMethod(v)} style={{ padding:'7px 4px',borderRadius:'6px',cursor:'pointer',border:`2px solid ${method===v?TEAL:'#E2E8F0'}`,background:method===v?'#F0FDF4':'white',fontSize:'11px',fontWeight:'500',color:NAVY,textAlign:'center' }}>{l}</div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px' }}>Reference <span style={{ color:'#94A3B8',fontWeight:'400' }}>(optional)</span></label>
            <input type="text" value={ref} onChange={e=>setRef(e.target.value)} placeholder="Transaction reference..."
              style={{ width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any }} />
          </div>
          <div style={{ display:'flex',gap:'10px' }}>
            <button type="button" onClick={onClose} style={{ flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white' }}>
              {saving?'⏳ Recording...':'✓ Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Version Badge (remove before production) ─────────────────
function VersionBadge() {
  return (
    <div style={{ position:'fixed', bottom:'12px', right:'12px', background:'rgba(13,33,55,0.85)', color:'white', fontSize:'10px', padding:'4px 10px', borderRadius:'999px', zIndex:9998, fontFamily:'monospace', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', gap:'6px' }}>
      <span style={{ opacity:0.5 }}>DEV</span>
      <span style={{ opacity:0.8 }}>💰 Loans</span>
      <span style={{ background:'#0F6E56', padding:'1px 6px', borderRadius:'999px', fontWeight:'700' }}>v1.2</span>
    </div>
  )
}

// ── Main Loans Page ───────────────────────────────────────────
export default function LoansPage() {
  const [data, setData]         = useState<any>(null)
  const [groups, setGroups]     = useState<any[]>([])
  const [members, setMembers]   = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [toast, setToast]       = useState<any>(null)
  const [showApply, setShowApply] = useState(false)
  const [selectedLoan, setSelectedLoan] = useState<string|null>(null)
  const [filterGroup, setFilterGroup]   = useState('ALL')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [search, setSearch]             = useState('')
  const ADMIN_ID = 'admin-placeholder'

  function showToast(msg: string, type = 'success') { setToast({ msg, type }) }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [lRes, gRes] = await Promise.all([fetch('/api/loans'), fetch('/api/groups')])
      const [lData, gData] = await Promise.all([lRes.json(), gRes.json()])
      if (lData.success) setData(lData.data)
      if (gData.success) {
        setGroups(gData.data)
        // Flatten members with groupId for the apply modal
        const allMembers: any[] = []
        for (const g of gData.data) {
          const mRes  = await fetch(`/api/members?groupId=${g.id}`)
          const mData = await mRes.json()
          if (mData.success) allMembers.push(...(mData.data || []).map((m: any) => ({ ...m, groupId: g.id })))
        }
        setMembers(allMembers)
      }
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const loans = data?.loans || []
  const filtered = loans.filter((l: any) => {
    const ms  = (l.borrowerName||'').toLowerCase().includes(search.toLowerCase()) || (l.purpose||'').toLowerCase().includes(search.toLowerCase())
    const mg  = filterGroup  === 'ALL' || l.groupId  === filterGroup
    const mst = filterStatus === 'ALL' || l.status   === filterStatus
    return ms && mg && mst
  })

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:'20px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)} />}
      {showApply && <ApplyModal groups={groups} members={members} onClose={()=>setShowApply(false)} onSuccess={(msg:string)=>{showToast(msg);fetchData()}} />}
      {selectedLoan && <LoanDetail loanId={selectedLoan} adminId={ADMIN_ID} onClose={()=>setSelectedLoan(null)} onAction={(msg:string,type='success')=>{showToast(msg,type);fetchData()}} />}

      {/* Header */}
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
        <div>
          <h2 style={{ fontSize:'20px',fontWeight:'700',color:NAVY,margin:'0 0 4px' }}>💰 Loans</h2>
          <p style={{ fontSize:'13px',color:'#64748B',margin:0 }}>Manage member loan applications, approvals, and repayments</p>
        </div>
        <div style={{ display:'flex',gap:'8px' }}>
          <button onClick={fetchData} style={{ padding:'8px 12px',background:'#F1F5F9',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'12px',cursor:'pointer',color:'#475569' }}>↻</button>
          <button onClick={()=>setShowApply(true)} style={{ padding:'10px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer' }}>+ New Application</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px' }}>
        {[
          {label:'Total Loans',   value:loading?'—':data?.summary?.total      ||0, color:NAVY    },
          {label:'Active',        value:loading?'—':data?.summary?.active      ||0, color:TEAL    },
          {label:'Pending',       value:loading?'—':data?.summary?.pending     ||0, color:'#1A5EA8'},
          {label:'Defaulted',     value:loading?'—':data?.summary?.defaulted   ||0, color:'#991B1B'},
          {label:'Outstanding',   value:loading?'—':`$${fmt(data?.summary?.totalOutstanding||0)}`, color:'#854D0E'},
        ].map(s=>(
          <div key={s.label} style={{ background:'white',borderRadius:'10px',padding:'14px',border:'1px solid #E2E8F0' }}>
            <div style={{ fontSize:'11px',color:'#64748B',marginBottom:'4px' }}>{s.label}</div>
            <div style={{ fontSize:'22px',fontWeight:'700',color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'center' }}>
        <input placeholder="Search borrower or purpose..." value={search} onChange={e=>setSearch(e.target.value)}
          style={{ padding:'8px 14px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',width:'240px',outline:'none' }} />
        <select value={filterGroup} onChange={e=>setFilterGroup(e.target.value)}
          style={{ padding:'8px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white' }}>
          <option value="ALL">All Groups</option>
          {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <div style={{ display:'flex',gap:'6px',flexWrap:'wrap' }}>
          {['ALL','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','ACTIVE','SETTLED','DEFAULTED','REJECTED'].map(s=>(
            <button key={s} onClick={()=>setFilterStatus(s)} style={{ padding:'5px 12px',borderRadius:'999px',fontSize:'11px',fontWeight:'500',cursor:'pointer',background:filterStatus===s?TEAL:'white',color:filterStatus===s?'white':'#64748B',border:filterStatus===s?'none':'1.5px solid #E2E8F0',whiteSpace:'nowrap' }}>
              {s==='ALL'?'All':STATUS_META[s]?.label||s}
            </button>
          ))}
        </div>
      </div>

      {/* Loans table */}
      {loading ? (
        <div style={{ background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center' }}>
          <div style={{ fontSize:'32px',marginBottom:'10px' }}>⏳</div><p style={{ color:'#64748B' }}>Loading loans...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center' }}>
          <div style={{ fontSize:'48px',marginBottom:'16px' }}>💰</div>
          <h3 style={{ fontSize:'16px',fontWeight:'600',color:NAVY,margin:'0 0 8px' }}>{loans.length===0?'No loans yet':'No loans match your filter'}</h3>
          {loans.length===0&&<button onClick={()=>setShowApply(true)} style={{ padding:'10px 20px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer',marginTop:'12px' }}>+ New Application</button>}
        </div>
      ) : (
        <div style={{ background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden' }}>
          <table style={{ width:'100%',borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#F8FAFC' }}>
                {['Borrower','Group','Type','Amount','Outstanding','Rate','Term','Status','Progress','Actions'].map(h=>(
                  <th key={h} style={{ padding:'10px 12px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase',whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((l: any,i: number)=>(
                <tr key={l.id} onClick={()=>setSelectedLoan(l.id)} style={{ borderBottom:'1px solid #F8FAFC',background:l.overdueCount>0?'#FFFBEB':i%2===0?'white':'#FAFAFA',cursor:'pointer' }}
                  onMouseEnter={e=>(e.currentTarget.style.background='#F0FDF4')}
                  onMouseLeave={e=>(e.currentTarget.style.background=l.overdueCount>0?'#FFFBEB':i%2===0?'white':'#FAFAFA')}>
                  <td style={{ padding:'11px 12px' }}>
                    <div style={{ display:'flex',alignItems:'center',gap:'8px' }}>
                      <div style={{ width:'30px',height:'30px',borderRadius:'50%',background:'#E1F5EE',color:TEAL,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',flexShrink:0 }}>
                        {(l.borrowerName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                      </div>
                      <div>
                        <div style={{ fontSize:'13px',fontWeight:'500',color:NAVY }}>{l.borrowerName}</div>
                        <TierBadge tier={l.borrowerTier||'BRONZE'} />
                      </div>
                    </div>
                  </td>
                  <td style={{ padding:'11px 12px',fontSize:'12px',color:'#475569' }}>{l.groupName}</td>
                  <td style={{ padding:'11px 12px' }}><span style={{ background:TYPE_META[l.type]?.bg,color:TYPE_META[l.type]?.color,fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px' }}>{l.type}</span></td>
                  <td style={{ padding:'11px 12px',fontSize:'13px',fontWeight:'600',color:NAVY }}>${fmt(l.amount)}</td>
                  <td style={{ padding:'11px 12px',fontSize:'13px',fontWeight:'600',color:l.outstandingBalance>0?'#854D0E':TEAL }}>${fmt(l.outstandingBalance)}</td>
                  <td style={{ padding:'11px 12px',fontSize:'12px',color:'#64748B' }}>{l.interestRatePct}%</td>
                  <td style={{ padding:'11px 12px',fontSize:'12px',color:'#64748B' }}>{l.termMonths}mo</td>
                  <td style={{ padding:'11px 12px' }}><StatusPill status={l.status} /></td>
                  <td style={{ padding:'11px 12px',minWidth:'80px' }}>
                    {['ACTIVE','DISBURSED','SETTLED'].includes(l.status) ? (
                      <div style={{ display:'flex',alignItems:'center',gap:'4px' }}>
                        <div style={{ flex:1,height:'5px',background:'#F1F5F9',borderRadius:'3px',overflow:'hidden',minWidth:'40px' }}>
                          <div style={{ height:'100%',background:l.repaymentProgress>=100?TEAL:'#1A5EA8',borderRadius:'3px',width:`${l.repaymentProgress}%` }} />
                        </div>
                        <span style={{ fontSize:'10px',fontWeight:'600',color:NAVY }}>{l.repaymentProgress}%</span>
                      </div>
                    ) : <span style={{ fontSize:'11px',color:'#94A3B8' }}>—</span>}
                  </td>
                  <td style={{ padding:'11px 12px' }} onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>setSelectedLoan(l.id)} style={{ padding:'4px 10px',background:'#F1F5F9',border:'none',borderRadius:'6px',fontSize:'11px',cursor:'pointer',color:'#475569',fontWeight:'500' }}>View</button>
                    {l.overdueCount>0 && <span style={{ marginLeft:'6px',fontSize:'10px',color:'#991B1B',fontWeight:'600' }}>⚠️{l.overdueCount}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding:'10px 16px',borderTop:'1px solid #F1F5F9',background:'#FAFAFA',fontSize:'12px',color:'#94A3B8',display:'flex',justifyContent:'space-between' }}>
            <span>Showing {filtered.length} of {loans.length} loans</span>
            {filtered.length < loans.length && <button onClick={()=>{setSearch('');setFilterStatus('ALL');setFilterGroup('ALL')}} style={{ fontSize:'12px',color:TEAL,background:'none',border:'none',cursor:'pointer' }}>Clear filters</button>}
          </div>
        </div>
      )}
    </div>
  )
}
