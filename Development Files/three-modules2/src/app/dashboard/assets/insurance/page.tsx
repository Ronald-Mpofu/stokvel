'use client'
import { useState, useEffect, useCallback } from 'react'
const TEAL='#0F6E56';const NAVY='#0D2137'
const fmt=(n:number)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)

const POLICY_TYPES=['COMPREHENSIVE','THIRD_PARTY','FIRE_THEFT','ALL_RISK','OTHER']
const CLAIM_STATUSES={SUBMITTED:{bg:'#DBEAFE',color:'#1E40AF'},UNDER_REVIEW:{bg:'#FEF9C3',color:'#854D0E'},APPROVED:{bg:'#DCFCE7',color:'#166534'},REJECTED:{bg:'#FEE2E2',color:'#991B1B'},PAID:{bg:'#F0FDF4',color:'#166534'}}

function Toast({msg,type,onClose}:any){useEffect(()=>{const t=setTimeout(onClose,4500);return()=>clearTimeout(t)},[onClose]);return<div style={{position:'fixed',top:'20px',right:'20px',zIndex:9999,padding:'12px 20px',borderRadius:'10px',fontWeight:'500',fontSize:'13px',boxShadow:'0 8px 25px rgba(0,0,0,0.15)',background:type==='success'?'#166534':'#991B1B',color:'white',display:'flex',alignItems:'center',gap:'10px'}}><span>{type==='success'?'✅':'❌'}</span><span>{msg}</span><button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'18px'}}>×</button></div>}
function Field({label,value,onChange,type='text',placeholder='',required=false}:any){return<div style={{marginBottom:'13px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>{label}{required&&<span style={{color:'#DC2626'}}> *</span>}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} required={required} style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/></div>}

function AddPolicyModal({asset,onClose,onSuccess}:any){
  const [form,setForm]=useState({insurer:'',policyNumber:'',policyType:'COMPREHENSIVE',coverAmount:'',premiumAmount:'',premiumFrequency:'ANNUAL',startDate:new Date().toISOString().split('T')[0],expiryDate:'',contactName:'',contactPhone:'',notes:''})
  const [saving,setSaving]=useState(false);const [error,setError]=useState('')
  const set=(k:string)=>(v:string)=>setForm(p=>({...p,[k]:v}))
  async function handleSubmit(e:React.FormEvent){e.preventDefault();setSaving(true);setError('')
    try{const res=await fetch('/api/assets/insurance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,assetId:asset.id,coverAmount:parseFloat(form.coverAmount),premiumAmount:parseFloat(form.premiumAmount)})})
      const data=await res.json();if(data.success){onSuccess(data.message);onClose()}else setError(data.error||'Failed')}catch{setError('Network error')}finally{setSaving(false)}
  }
  return(<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
    <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'520px',boxShadow:'0 25px 50px rgba(0,0,0,0.25)',maxHeight:'90vh',overflowY:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}><h3 style={{fontSize:'16px',fontWeight:'700',color:NAVY,margin:0}}>🛡️ Add Insurance Policy</h3><button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px'}}>×</button></div>
      <form onSubmit={handleSubmit}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
          <div style={{gridColumn:'1/-1'}}><Field label="Insurer / Insurance Company" value={form.insurer} onChange={set('insurer')} placeholder="e.g. Old Mutual, First Mutual" required/></div>
          <Field label="Policy Number" value={form.policyNumber} onChange={set('policyNumber')} placeholder="Policy reference" required/>
          <div style={{marginBottom:'13px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Policy Type *</label>
            <select value={form.policyType} onChange={e=>set('policyType')(e.target.value)} style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as any}}>
              {POLICY_TYPES.map(t=><option key={t} value={t}>{t.replace('_',' ')}</option>)}
            </select>
          </div>
          <Field label="Cover Amount ($)" value={form.coverAmount} onChange={set('coverAmount')} type="number" placeholder="50000" required/>
          <Field label="Premium Amount ($)" value={form.premiumAmount} onChange={set('premiumAmount')} type="number" placeholder="1200" required/>
          <div style={{marginBottom:'13px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Premium Frequency</label>
            <select value={form.premiumFrequency} onChange={e=>set('premiumFrequency')(e.target.value)} style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as any}}>
              {['MONTHLY','QUARTERLY','ANNUAL'].map(f=><option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <Field label="Start Date" value={form.startDate} onChange={set('startDate')} type="date" required/>
          <Field label="Expiry Date" value={form.expiryDate} onChange={set('expiryDate')} type="date" required/>
          <Field label="Contact Name" value={form.contactName} onChange={set('contactName')} placeholder="Agent name"/>
          <Field label="Contact Phone" value={form.contactPhone} onChange={set('contactPhone')} placeholder="+263..."/>
        </div>
        <Field label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any policy notes..."/>
        {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',marginBottom:'12px'}}>❌ {error}</div>}
        <div style={{display:'flex',gap:'10px'}}>
          <button type="button" onClick={onClose} style={{flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
          <button type="submit" disabled={saving} style={{flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white'}}>{saving?'⏳ Adding...':'✓ Add Policy'}</button>
        </div>
      </form>
    </div>
  </div>)
}

export default function InsurancePanel({asset,onClose}:{asset:any;onClose:()=>void}){
  const [data,setData]=useState<any>(null);const [loading,setLoading]=useState(true)
  const [toast,setToast]=useState<any>(null);const [showAdd,setShowAdd]=useState(false)
  const [showClaimForm,setShowClaimForm]=useState<string|null>(null)
  const [claimForm,setClaimForm]=useState({claimDate:new Date().toISOString().split('T')[0],description:'',claimAmount:'',referenceNo:''})
  const showToast=(msg:string,type='success')=>setToast({msg,type})
  const fetchData=useCallback(async()=>{setLoading(true);try{const res=await fetch(`/api/assets/insurance?assetId=${asset.id}`);const json=await res.json();if(json.success)setData(json.data)}catch{}finally{setLoading(false)}},[asset.id])
  useEffect(()=>{fetchData()},[fetchData])

  async function submitClaim(insuranceId:string){
    try{const res=await fetch('/api/assets/insurance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ADD_CLAIM',insuranceId,assetId:asset.id,...claimForm,claimAmount:parseFloat(claimForm.claimAmount)})})
      const json=await res.json();if(json.success){showToast('Claim submitted');setShowClaimForm(null);fetchData()}else showToast(json.error||'Failed','error')}catch{showToast('Network error','error')}
  }

  const {policies=[],summary={}}=data||{}
  const now=new Date()

  async function updateClaimStatus(claimId: string, status: string, settledAmount?: string) {
    try {
      const res = await fetch('/api/assets/insurance', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'UPDATE_CLAIM', claimId, status, settledAmount: settledAmount ? parseFloat(settledAmount) : undefined })
      })
      const json = await res.json()
      if (json.success) { showToast(`Claim ${status.toLowerCase()}`); fetchData() }
      else showToast(json.error||'Failed','error')
    } catch { showToast('Network error','error') }
  }

  async function renewPolicy(policyId: string) {
    try {
      const res = await fetch('/api/assets/insurance', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ policyId, status:'ACTIVE' }) })
      const json = await res.json()
      if (json.success) { showToast('Policy marked as renewed/active'); fetchData() }
      else showToast(json.error||'Failed','error')
    } catch { showToast('Network error','error') }
  }

  return(<div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
    {toast&&<Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
    {showAdd&&<AddPolicyModal asset={asset} onClose={()=>setShowAdd(false)} onSuccess={(msg:string)=>{showToast(msg);fetchData()}}/>}
    <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
      <button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',padding:'8px 14px',cursor:'pointer',fontSize:'13px',color:'#475569'}}>← Back</button>
      <div style={{flex:1}}><h2 style={{fontSize:'18px',fontWeight:'700',color:NAVY,margin:0}}>🛡️ Insurance Tracking</h2><p style={{fontSize:'12px',color:'#64748B',margin:'2px 0 0'}}>{asset.name}</p></div>
      <button onClick={()=>setShowAdd(true)} style={{padding:'9px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Add Policy</button>
    </div>
    {/* KPI */}
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px'}}>
      {[{label:'Active Policies',value:loading?'—':summary.activePolicies||0,color:TEAL},{label:'Expiring Soon',value:loading?'—':summary.expiringSOon||0,color:summary.expiringSOon>0?'#854D0E':NAVY},{label:'Total Cover',value:loading?'—':`$${fmt(summary.totalCover||0)}`,color:'#166534'},{label:'Annual Premium',value:loading?'—':`$${fmt(summary.annualPremium||0)}`,color:'#1A5EA8'}].map(s=>(
        <div key={s.label} style={{background:'white',borderRadius:'10px',padding:'14px',border:'1px solid #E2E8F0'}}><div style={{fontSize:'11px',color:'#64748B',marginBottom:'4px'}}>{s.label}</div><div style={{fontSize:'20px',fontWeight:'700',color:s.color}}>{s.value}</div></div>
      ))}
    </div>
    {/* Expiry alert */}
    {summary.expiringSOon>0&&<div style={{background:'#FEF9C3',border:'1px solid #FCD34D',borderRadius:'10px',padding:'12px 16px',fontSize:'13px',color:'#854D0E',display:'flex',alignItems:'center',gap:'10px'}}>⚠️ <strong>{summary.expiringSOon} policy/policies expire within 30 days.</strong> Renew immediately to avoid coverage gaps.</div>}
    {/* Policies */}
    {loading?<div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}><div style={{fontSize:'28px',marginBottom:'10px'}}>⏳</div><p style={{color:'#64748B'}}>Loading policies...</p></div>
    :policies.length===0?<div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}>
      <div style={{fontSize:'40px',marginBottom:'12px'}}>🛡️</div><h3 style={{fontSize:'16px',fontWeight:'600',color:NAVY,margin:'0 0 8px'}}>No insurance policies</h3>
      <p style={{color:'#64748B',fontSize:'13px',marginBottom:'20px'}}>Track all insurance policies for this asset.</p>
      <button onClick={()=>setShowAdd(true)} style={{padding:'10px 20px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Add First Policy</button>
    </div>
    :(
      <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
        {policies.map((p:any)=>{
          const daysLeft=p.daysToExpiry;const isExpiring=daysLeft<=30&&daysLeft>=0;const isExpired=daysLeft<0
          return(<div key={p.id} style={{background:'white',borderRadius:'12px',border:`1px solid ${isExpired?'#FECACA':isExpiring?'#FCD34D':'#E2E8F0'}`,overflow:'hidden'}}>
            <div style={{background:isExpired?'#FEE2E2':isExpiring?'#FEF9C3':'#F8FAFC',padding:'14px 18px',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'15px',fontWeight:'700',color:NAVY}}>{p.insurer}</span>
                  <span style={{background:'#DBEAFE',color:'#1E40AF',fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px'}}>{p.policyType.replace('_',' ')}</span>
                  <span style={{background:isExpired?'#FEE2E2':isExpiring?'#FEF9C3':'#DCFCE7',color:isExpired?'#991B1B':isExpiring?'#854D0E':'#166534',fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px'}}>
                    {isExpired?'EXPIRED':isExpiring?`Expires in ${daysLeft}d`:'ACTIVE'}
                  </span>
                </div>
                <div style={{fontSize:'11px',color:'#94A3B8',marginTop:'3px'}}>Policy #{p.policyNumber} · {p.contactName||'No contact'}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:'11px',color:'#64748B'}}>Cover / Annual Premium</div>
                <div style={{fontSize:'15px',fontWeight:'700',color:TEAL}}>${fmt(p.coverAmount)} / ${fmt(p.premiumAmount)}</div>
                <div style={{fontSize:'11px',color:'#94A3B8'}}>Expires: {new Date(p.expiryDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
              </div>
            </div>
            <div style={{padding:'12px 18px',display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
              {p.claims.length>0&&<div style={{flex:1,fontSize:'12px',color:'#64748B'}}>{p.claims.length} claim{p.claims.length!==1?'s':''} · Latest: {(CLAIM_STATUSES as any)[p.claims[0].status]&&<span style={{background:(CLAIM_STATUSES as any)[p.claims[0].status].bg,color:(CLAIM_STATUSES as any)[p.claims[0].status].color,padding:'1px 6px',borderRadius:'4px',fontSize:'11px',fontWeight:'600'}}>{p.claims[0].status}</span>}</div>}
              {p.documentUrl&&<a href={p.documentUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:'12px',color:'#1A5EA8',textDecoration:'none'}}>📄 View Policy</a>}
              {(isExpired||isExpiring)&&<button onClick={()=>renewPolicy(p.id)} style={{padding:'6px 12px',background:'#DCFCE7',color:'#166534',border:'1px solid #86EFAC',borderRadius:'6px',fontSize:'11px',cursor:'pointer',fontWeight:'600'}}>↻ Renew</button>}
              <button onClick={()=>setShowClaimForm(showClaimForm===p.id?null:p.id)} style={{padding:'6px 12px',background:'#FEF9C3',color:'#854D0E',border:'1px solid #FCD34D',borderRadius:'6px',fontSize:'11px',cursor:'pointer',fontWeight:'500'}}>
                {showClaimForm===p.id?'Close':'+ Add Claim'}
              </button>
            </div>
            {/* Existing claims list */}
            {p.claims.length>0&&(
              <div style={{padding:'10px 18px',borderTop:'1px solid #F1F5F9',background:'#FAFAFA'}}>
                <div style={{fontSize:'11px',color:'#94A3B8',fontWeight:'600',marginBottom:'8px'}}>CLAIMS HISTORY</div>
                {p.claims.map((c:any)=>{
                  const cs=(CLAIM_STATUSES as any)[c.status]||{bg:'#F1F5F9',color:'#475569'}
                  return(<div key={c.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'7px 0',borderBottom:'1px solid #F1F5F9',flexWrap:'wrap'}}>
                    <div style={{flex:1,minWidth:'180px'}}>
                      <div style={{fontSize:'12px',fontWeight:'500',color:NAVY}}>{c.description}</div>
                      <div style={{fontSize:'11px',color:'#94A3B8'}}>{new Date(c.claimDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})} {c.referenceNo&&`· Ref: ${c.referenceNo}`}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:'13px',fontWeight:'700',color:'#854D0E'}}>${fmt(c.claimAmount)}</div>
                      {c.settledAmount&&<div style={{fontSize:'11px',color:TEAL}}>Settled: ${fmt(c.settledAmount)}</div>}
                    </div>
                    <span style={{background:cs.bg,color:cs.color,fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px'}}>{c.status}</span>
                    {c.status==='SUBMITTED'&&<button onClick={()=>updateClaimStatus(c.id,'UNDER_REVIEW')} style={{padding:'3px 8px',background:'#FEF9C3',color:'#854D0E',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Under Review</button>}
                    {c.status==='UNDER_REVIEW'&&<><button onClick={()=>updateClaimStatus(c.id,'APPROVED')} style={{padding:'3px 8px',background:'#DCFCE7',color:'#166534',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Approve</button><button onClick={()=>updateClaimStatus(c.id,'REJECTED')} style={{padding:'3px 8px',background:'#FEE2E2',color:'#991B1B',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Reject</button></>}
                    {c.status==='APPROVED'&&<button onClick={()=>updateClaimStatus(c.id,'PAID',String(c.claimAmount))} style={{padding:'3px 8px',background:'#DCFCE7',color:'#166534',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer',fontWeight:'600'}}>Mark Paid</button>}
                  </div>)
                })}
              </div>
            )}
            {showClaimForm===p.id&&(
              <div style={{padding:'14px 18px',borderTop:'1px solid #F1F5F9',background:'#FFFBEB'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
                  <Field label="Claim Date" value={claimForm.claimDate} onChange={(v:string)=>setClaimForm(f=>({...f,claimDate:v}))} type="date" required/>
                  <Field label="Claim Amount ($)" value={claimForm.claimAmount} onChange={(v:string)=>setClaimForm(f=>({...f,claimAmount:v}))} type="number" required/>
                  <div style={{gridColumn:'1/-1'}}><Field label="Description" value={claimForm.description} onChange={(v:string)=>setClaimForm(f=>({...f,description:v}))} placeholder="Describe the incident..." required/></div>
                  <Field label="Reference No." value={claimForm.referenceNo} onChange={(v:string)=>setClaimForm(f=>({...f,referenceNo:v}))} placeholder="Insurer ref no."/>
                </div>
                <button onClick={()=>submitClaim(p.id)} style={{padding:'8px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>Submit Claim</button>
              </div>
            )}
          </div>)
        })}
      </div>
    )}
  </div>)
}
