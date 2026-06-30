'use client'
import { useState, useEffect, useCallback } from 'react'

const TEAL = '#0F6E56'; const NAVY = '#0D2137'; const PURPLE = '#7C3AED'

const INCOME_TYPES = [
  { value:'RENTAL',        label:'🏠 Rental Income',     color:'#1A5EA8', bg:'#DBEAFE' },
  { value:'HIRE',          label:'🚜 Equipment Hire',    color:'#166534', bg:'#DCFCE7' },
  { value:'DIVIDEND',      label:'💹 Dividend',          color:PURPLE,    bg:'#F3E8FF' },
  { value:'SALE_PROCEEDS', label:'💰 Sale Proceeds',     color:'#854D0E', bg:'#FEF9C3' },
  { value:'OTHER',         label:'📦 Other Income',      color:'#475569', bg:'#F1F5F9' },
]

const fmt = (n: number) => new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)

function Toast({ msg, type, onClose }: any) {
  useEffect(()=>{ const t=setTimeout(onClose,4500); return ()=>clearTimeout(t) },[onClose])
  return <div style={{ position:'fixed',top:'20px',right:'20px',zIndex:9999,padding:'12px 20px',borderRadius:'10px',fontWeight:'500',fontSize:'13px',boxShadow:'0 8px 25px rgba(0,0,0,0.15)',background:type==='success'?'#166534':'#991B1B',color:'white',display:'flex',alignItems:'center',gap:'10px' }}>
    <span>{type==='success'?'✅':'❌'}</span><span>{msg}</span><button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'18px'}}>×</button>
  </div>
}

function Field({ label, value, onChange, type='text', placeholder='', required=false, hint='' }: any) {
  return <div style={{marginBottom:'13px'}}>
    <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>{label}{required&&<span style={{color:'#DC2626'}}> *</span>}</label>
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} required={required}
      style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/>
    {hint&&<p style={{fontSize:'11px',color:'#94A3B8',margin:'4px 0 0'}}>{hint}</p>}
  </div>
}


// ── Income Statement Modal ────────────────────────────────────
function StatementModal({ stakeholder, incomes, onClose }: any) {
  const myShares = incomes.flatMap((i: any) =>
    i.distributions.filter((d: any) => d.userId === stakeholder.id || d.backerId === stakeholder.id)
      .map((d: any) => ({ ...d, incomeDate: i.incomeDate, incomeType: i.type, description: i.description }))
  )
  const total = myShares.reduce((s: number, d: any) => s + d.shareAmount, 0)

  function exportCSV() {
    const rows = [
      ['Date','Type','Description','Ownership %','Share Amount','Status'],
      ...myShares.map((d: any) => [
        new Date(d.incomeDate).toLocaleDateString('en-GB'),
        d.incomeType, d.description,
        `${d.ownershipPct.toFixed(4)}%`,
        `$${fmt(d.shareAmount)}`, d.status,
      ])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `Income-Statement-${stakeholder.name.replace(/\s/g,'-')}.csv`
    a.click()
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px' }}>
      <div style={{ background:'white',borderRadius:'16px',width:'100%',maxWidth:'600px',maxHeight:'88vh',display:'flex',flexDirection:'column',boxShadow:'0 25px 50px rgba(0,0,0,0.3)',overflow:'hidden' }}>
        <div style={{ background:NAVY,padding:'20px 24px',flexShrink:0 }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
            <div>
              <h3 style={{ fontSize:'16px',fontWeight:'700',color:'white',margin:'0 0 2px' }}>📄 Income Statement</h3>
              <p style={{ fontSize:'12px',color:'rgba(255,255,255,0.6)',margin:0 }}>{stakeholder.name} · {stakeholder.type}</p>
            </div>
            <div style={{ display:'flex',gap:'8px' }}>
              <button onClick={exportCSV} style={{ padding:'7px 14px',background:'rgba(255,255,255,0.15)',color:'white',border:'1px solid rgba(255,255,255,0.25)',borderRadius:'8px',fontSize:'12px',cursor:'pointer' }}>📥 Export CSV</button>
              <button onClick={onClose} style={{ width:'32px',height:'32px',background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'18px',color:'white' }}>×</button>
            </div>
          </div>
          <div style={{ display:'flex',gap:'20px',marginTop:'12px',paddingTop:'12px',borderTop:'1px solid rgba(255,255,255,0.1)' }}>
            <div><div style={{ fontSize:'10px',color:'rgba(255,255,255,0.5)',textTransform:'uppercase' }}>Total Earned</div><div style={{ fontSize:'20px',fontWeight:'700',color:TEAL === '#0F6E56' ? '#9FE1CB' : 'white' }}>${fmt(total)}</div></div>
            <div><div style={{ fontSize:'10px',color:'rgba(255,255,255,0.5)',textTransform:'uppercase' }}>Transactions</div><div style={{ fontSize:'20px',fontWeight:'700',color:'white' }}>{myShares.length}</div></div>
            <div><div style={{ fontSize:'10px',color:'rgba(255,255,255,0.5)',textTransform:'uppercase' }}>Ownership</div><div style={{ fontSize:'20px',fontWeight:'700',color:'white' }}>{stakeholder.ownershipPct?.toFixed(2)}%</div></div>
          </div>
        </div>
        <div style={{ flex:1,overflowY:'auto',padding:'16px 24px' }}>
          {myShares.length === 0 ? (
            <div style={{ textAlign:'center',padding:'40px',color:'#94A3B8' }}>No income distributions yet for this stakeholder.</div>
          ) : (
            <table style={{ width:'100%',borderCollapse:'collapse' }}>
              <thead><tr style={{ background:'#F8FAFC' }}>{['Date','Type','Description','Ownership','Amount','Status'].map(h=><th key={h} style={{ padding:'9px 12px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase' }}>{h}</th>)}</tr></thead>
              <tbody>
                {myShares.map((d: any, i: number) => (
                  <tr key={i} style={{ borderBottom:'1px solid #F8FAFC' }}>
                    <td style={{ padding:'10px 12px',fontSize:'12px',color:'#64748B',whiteSpace:'nowrap' }}>{new Date(d.incomeDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</td>
                    <td style={{ padding:'10px 12px',fontSize:'12px',color:'#475569' }}>{d.incomeType}</td>
                    <td style={{ padding:'10px 12px',fontSize:'12px',color:NAVY }}>{d.description}</td>
                    <td style={{ padding:'10px 12px',fontSize:'12px',color:'#64748B' }}>{Number(d.ownershipPct).toFixed(4)}%</td>
                    <td style={{ padding:'10px 12px',fontSize:'13px',fontWeight:'700',color:'#0F6E56' }}>${fmt(d.shareAmount)}</td>
                    <td style={{ padding:'10px 12px' }}><span style={{ background:d.status==='PAID'?'#DCFCE7':'#FEF9C3',color:d.status==='PAID'?'#166534':'#854D0E',fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px' }}>{d.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ padding:'12px 24px',borderTop:'1px solid #E2E8F0',background:'#F8FAFC',flexShrink:0,display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <span style={{ fontSize:'12px',color:'#64748B' }}>Total: <strong style={{ color:'#0F6E56' }}>${fmt(total)}</strong></span>
          <button onClick={onClose} style={{ padding:'8px 20px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

function AddIncomeModal({ asset, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ type:'RENTAL', amount:'', expenses:'0', description:'', incomeDate:new Date().toISOString().split('T')[0], reference:'', notes:'' })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k: string) => (v: string) => setForm(p=>({...p,[k]:v}))
  const net = parseFloat(form.amount||'0') - parseFloat(form.expenses||'0')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const res  = await fetch('/api/assets/income', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...form, assetId:asset.id, groupId:asset.groupId||'', amount:parseFloat(form.amount), expenses:parseFloat(form.expenses||'0') }) })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error||'Failed')
    } catch { setError('Network error') } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
      <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'480px',boxShadow:'0 25px 50px rgba(0,0,0,0.25)',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
          <h3 style={{fontSize:'16px',fontWeight:'700',color:NAVY,margin:0}}>💰 Record Asset Income</h3>
          <button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px'}}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{marginBottom:'14px'}}>
            <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'6px'}}>Income Type *</label>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
              {INCOME_TYPES.map(t=>(
                <div key={t.value} onClick={()=>set('type')(t.value)}
                  style={{padding:'9px 12px',borderRadius:'8px',cursor:'pointer',border:`2px solid ${form.type===t.value?t.color:'#E2E8F0'}`,background:form.type===t.value?t.bg:'white',fontSize:'12px',fontWeight:'500',color:NAVY}}>
                  {t.label}
                </div>
              ))}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <Field label="Gross Amount ($)" value={form.amount} onChange={set('amount')} type="number" placeholder="0.00" required />
            <Field label="Expenses ($)" value={form.expenses} onChange={set('expenses')} type="number" placeholder="0.00" hint="Costs deducted before distribution" />
          </div>
          {parseFloat(form.amount||'0')>0&&(
            <div style={{background:net>=0?'#F0FDF4':'#FEF2F2',borderRadius:'8px',padding:'10px 14px',marginBottom:'14px',border:`1px solid ${net>=0?'#BBF7D0':'#FECACA'}`,fontSize:'13px',fontWeight:'600',color:net>=0?TEAL:'#991B1B'}}>
              Net distributable: ${fmt(Math.max(0,net))}
            </div>
          )}
          <Field label="Description" value={form.description} onChange={set('description')} placeholder="e.g. June 2025 tractor hire — Chiedza Farm" required />
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <Field label="Income Date" value={form.incomeDate} onChange={set('incomeDate')} type="date" required />
            <Field label="Reference" value={form.reference} onChange={set('reference')} placeholder="Invoice / receipt ref" />
          </div>
          <Field label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any additional details..." />
          {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',marginBottom:'12px'}}>❌ {error}</div>}
          <div style={{display:'flex',gap:'10px'}}>
            <button type="button" onClick={onClose} style={{flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
            <button type="submit" disabled={saving} style={{flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white'}}>
              {saving?'⏳ Recording...':'✓ Record Income'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function IncomePanel({ asset, onClose }: { asset: any; onClose: () => void }) {
  const [data, setData]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast]     = useState<any>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [distributing, setDistributing] = useState<string|null>(null)
  const [statement, setStatement]         = useState<any>(null)

  const showToast = (msg: string, type='success') => setToast({msg,type})

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/assets/income?assetId=${asset.id}`)
      const json = await res.json()
      if (json.success) setData(json.data)
    } catch {} finally { setLoading(false) }
  }, [asset.id])

  useEffect(()=>{ fetchData() },[fetchData])

  async function handleDistribute(incomeId: string) {
    setDistributing(incomeId)
    try {
      const res  = await fetch('/api/assets/income',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'DISTRIBUTE',incomeId})})
      const json = await res.json()
      if (json.success) { showToast(json.message); fetchData() }
      else showToast(json.error||'Failed','error')
    } catch { showToast('Network error','error') } finally { setDistributing(null) }
  }

  const { incomes=[], stakeholders=[], summary={} } = data||{}

  function exportAllCSV() {
    const rows = [['Member','Type','Date','Description','Ownership%','Amount','Status']]
    incomes.forEach((i: any) => {
      i.distributions.forEach((d: any) => {
        const sh = stakeholders.find((s: any) => s.id === d.userId || s.id === d.backerId)
        rows.push([sh?.name||'Unknown', i.type, new Date(i.incomeDate).toLocaleDateString('en-GB'), i.description, `${d.ownershipPct}%`, `$${fmt(d.shareAmount)}`, d.status])
      })
    })
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv'})
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Income-Distribution-Report.csv'; a.click()
  }
  const typeInfo = (t: string) => INCOME_TYPES.find(x=>x.value===t)||INCOME_TYPES[4]

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      {toast&&<Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
      {statement&&<StatementModal stakeholder={statement} incomes={incomes} onClose={()=>setStatement(null)}/>}
  {showAdd&&<AddIncomeModal asset={asset} onClose={()=>setShowAdd(false)} onSuccess={(msg:string)=>{showToast(msg);fetchData()}}/>}

      <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
        <button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',padding:'8px 14px',cursor:'pointer',fontSize:'13px',color:'#475569'}}>← Back</button>
        <div style={{flex:1}}>
          <h2 style={{fontSize:'18px',fontWeight:'700',color:NAVY,margin:0}}>💵 Income Distribution</h2>
          <p style={{fontSize:'12px',color:'#64748B',margin:'2px 0 0'}}>{asset.name}</p>
        </div>
        {incomes.length>0&&<button onClick={exportAllCSV} style={{padding:'8px 14px',background:'#F1F5F9',color:'#475569',border:'1px solid #E2E8F0',borderRadius:'8px',fontSize:'12px',cursor:'pointer'}}>📥 Export All</button>}
  <button onClick={()=>setShowAdd(true)} style={{padding:'9px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Record Income</button>
      </div>

      {/* KPI */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
        {[
          {label:'Total Income',        value:`$${fmt(summary.totalIncome||0)}`,         color:TEAL},
          {label:'Total Distributed',   value:`$${fmt(summary.totalDistributed||0)}`,    color:'#166534'},
          {label:'Pending Distribution',value:`$${fmt(summary.pendingDistribution||0)}`, color:summary.pendingDistribution>0?'#854D0E':NAVY},
        ].map(s=>(
          <div key={s.label} style={{background:'white',borderRadius:'10px',padding:'16px',border:'1px solid #E2E8F0'}}>
            <div style={{fontSize:'11px',color:'#64748B',marginBottom:'4px'}}>{s.label}</div>
            <div style={{fontSize:'22px',fontWeight:'700',color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Stakeholders */}
      {stakeholders.length>0&&(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'18px'}}>
          <h3 style={{fontSize:'14px',fontWeight:'600',color:NAVY,margin:'0 0 12px'}}>👥 Distribution Stakeholders</h3>
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {stakeholders.map((s: any)=>(
              <div key={s.id} style={{display:'flex',alignItems:'center',gap:'10px'}}>
                <div style={{width:'28px',height:'28px',borderRadius:'50%',background:'#E1F5EE',color:TEAL,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',flexShrink:0}}>
                  {s.name.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                </div>
                <span style={{flex:1,fontSize:'13px',color:NAVY,fontWeight:'500'}}>{s.name}</span>
                <button onClick={()=>setStatement(s)} style={{padding:'3px 8px',background:'#F1F5F9',border:'none',borderRadius:'4px',fontSize:'11px',cursor:'pointer',color:'#475569',flexShrink:0}}>Statement</button>
                <span style={{fontSize:'11px',color:'#64748B',background:'#F1F5F9',padding:'2px 7px',borderRadius:'4px'}}>{s.type}</span>
                <div style={{width:'80px',height:'6px',background:'#F1F5F9',borderRadius:'3px',overflow:'hidden'}}>
                  <div style={{height:'100%',background:TEAL,borderRadius:'3px',width:`${s.ownershipPct}%`}}/>
                </div>
                <span style={{fontSize:'12px',fontWeight:'700',color:TEAL,minWidth:'45px',textAlign:'right'}}>{Number(s.ownershipPct).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Income records */}
      {loading?(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}>
          <div style={{fontSize:'28px',marginBottom:'10px'}}>⏳</div><p style={{color:'#64748B'}}>Loading income records...</p>
        </div>
      ):incomes.length===0?(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}>
          <div style={{fontSize:'40px',marginBottom:'12px'}}>💵</div>
          <h3 style={{fontSize:'16px',fontWeight:'600',color:NAVY,margin:'0 0 8px'}}>No income recorded yet</h3>
          <p style={{color:'#64748B',fontSize:'13px',marginBottom:'20px'}}>Record rental income, hire fees, or other earnings from this asset.</p>
          <button onClick={()=>setShowAdd(true)} style={{padding:'10px 20px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Record First Income</button>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          {incomes.map((income: any)=>{
            const ti = typeInfo(income.type)
            return (
              <div key={income.id} style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px 20px'}}>
                <div style={{display:'flex',alignItems:'flex-start',gap:'12px',flexWrap:'wrap'}}>
                  <div style={{width:'40px',height:'40px',borderRadius:'10px',background:ti.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',flexShrink:0}}>
                    {ti.label.split(' ')[0]}
                  </div>
                  <div style={{flex:1,minWidth:'200px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'3px',flexWrap:'wrap'}}>
                      <span style={{fontSize:'14px',fontWeight:'600',color:NAVY}}>{income.description}</span>
                      <span style={{background:ti.bg,color:ti.color,fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px'}}>{ti.label}</span>
                      <span style={{background:income.status==='DISTRIBUTED'?'#DCFCE7':'#FEF9C3',color:income.status==='DISTRIBUTED'?'#166534':'#854D0E',fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px'}}>
                        {income.status}
                      </span>
                    </div>
                    <div style={{fontSize:'11px',color:'#94A3B8'}}>
                      {new Date(income.incomeDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                      {income.reference&&` · Ref: ${income.reference}`}
                    </div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:'11px',color:'#94A3B8'}}>Gross / Expenses / Net</div>
                    <div style={{fontSize:'15px',fontWeight:'700',color:TEAL}}>${fmt(income.netAmount)}</div>
                    <div style={{fontSize:'11px',color:'#94A3B8'}}>${fmt(income.amount)} − ${fmt(income.expenses)}</div>
                  </div>
                  {income.status==='PENDING'&&(
                    <button onClick={()=>handleDistribute(income.id)} disabled={distributing===income.id}
                      style={{padding:'8px 16px',background:distributing===income.id?'#94A3B8':TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:distributing===income.id?'not-allowed':'pointer',flexShrink:0}}>
                      {distributing===income.id?'⏳':'📊 Distribute'}
                    </button>
                  )}
                </div>
                {/* Distribution shares */}
                {income.distributions.length>0&&(
                  <div style={{marginTop:'10px',paddingTop:'10px',borderTop:'1px solid #F1F5F9'}}>
                    <div style={{fontSize:'11px',color:'#94A3B8',marginBottom:'6px',fontWeight:'600'}}>DISTRIBUTED TO {income.distributions.length} STAKEHOLDERS</div>
                    <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                      {income.distributions.map((d: any,i: number)=>(
                        <div key={i} style={{background:'#F0FDF4',borderRadius:'6px',padding:'5px 10px',fontSize:'11px',color:'#166534',fontWeight:'500'}}>
                          {d.ownershipPct.toFixed(2)}% · ${fmt(d.shareAmount)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
