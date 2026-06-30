'use client'
import { useState, useEffect, useCallback } from 'react'
const TEAL='#0F6E56';const NAVY='#0D2137';const BLUE='#1A5EA8'
const fmt=(n:number)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)

const CATEGORIES=['MACHINERY','VEHICLES','ELECTRONICS','PROPERTY','SERVICES','OTHER']
const INCOTERMS=['FOB','CIF','EXW','DDP','CFR','FCA','DAP']
const QUOTE_STATUS_META:Record<string,any>={RECEIVED:{bg:'#DBEAFE',color:'#1E40AF'},SHORTLISTED:{bg:'#FEF9C3',color:'#854D0E'},ACCEPTED:{bg:'#DCFCE7',color:'#166534'},REJECTED:{bg:'#FEE2E2',color:'#991B1B'},EXPIRED:{bg:'#F1F5F9',color:'#475569'}}

function Toast({msg,type,onClose}:any){useEffect(()=>{const t=setTimeout(onClose,4500);return()=>clearTimeout(t)},[onClose]);return<div style={{position:'fixed',top:'20px',right:'20px',zIndex:9999,padding:'12px 20px',borderRadius:'10px',fontWeight:'500',fontSize:'13px',boxShadow:'0 8px 25px rgba(0,0,0,0.15)',background:type==='success'?'#166534':'#991B1B',color:'white',display:'flex',alignItems:'center',gap:'10px'}}><span>{type==='success'?'✅':'❌'}</span><span>{msg}</span><button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'18px'}}>×</button></div>}
function Field({label,value,onChange,type='text',placeholder='',required=false}:any){return<div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>{label}{required&&<span style={{color:'#DC2626'}}> *</span>}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} required={required} style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/></div>}

function AddSupplierModal({onClose,onSuccess}:any){
  const [form,setForm]=useState({name:'',tradingName:'',country:'',city:'',phone:'',email:'',website:'',contactPerson:'',contactPhone:'',contactEmail:'',category:'MACHINERY',paymentTerms:'',leadTimeDays:'',rating:'',notes:''})
  const [saving,setSaving]=useState(false);const [error,setError]=useState('')
  const set=(k:string)=>(v:string)=>setForm(p=>({...p,[k]:v}))
  async function handleSubmit(e:React.FormEvent){e.preventDefault();setSaving(true);setError('')
    try{const res=await fetch('/api/suppliers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,leadTimeDays:form.leadTimeDays?parseInt(form.leadTimeDays):undefined,rating:form.rating?parseInt(form.rating):undefined})})
      const data=await res.json();if(data.success){onSuccess(data.message);onClose()}else setError(data.error||'Failed')}catch{setError('Network error')}finally{setSaving(false)}
  }
  return(<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
    <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'580px',boxShadow:'0 25px 50px rgba(0,0,0,0.25)',maxHeight:'92vh',overflowY:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px'}}><h3 style={{fontSize:'16px',fontWeight:'700',color:NAVY,margin:0}}>🏭 Add Supplier</h3><button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px'}}>×</button></div>
      <form onSubmit={handleSubmit}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
          <div style={{gridColumn:'1/-1'}}><Field label="Company Name" value={form.name} onChange={set('name')} placeholder="e.g. John Deere Zimbabwe" required/></div>
          <Field label="Trading Name" value={form.tradingName} onChange={set('tradingName')} placeholder="If different from above"/>
          <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Category *</label>
            <select value={form.category} onChange={e=>set('category')(e.target.value)} style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as any}}>
              {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Field label="Country" value={form.country} onChange={set('country')} placeholder="e.g. Zimbabwe" required/>
          <Field label="City" value={form.city} onChange={set('city')} placeholder="e.g. Harare"/>
          <Field label="Phone" value={form.phone} onChange={set('phone')} placeholder="+263..."/>
          <Field label="Email" value={form.email} onChange={set('email')} type="email" placeholder="info@supplier.com"/>
          <Field label="Website" value={form.website} onChange={set('website')} placeholder="https://..."/>
          <Field label="Contact Person" value={form.contactPerson} onChange={set('contactPerson')} placeholder="Sales rep name"/>
          <Field label="Contact Phone" value={form.contactPhone} onChange={set('contactPhone')} placeholder="Direct line"/>
          <Field label="Contact Email" value={form.contactEmail} onChange={set('contactEmail')} type="email" placeholder="rep@supplier.com"/>
          <Field label="Payment Terms" value={form.paymentTerms} onChange={set('paymentTerms')} placeholder="e.g. 50% deposit, 50% on delivery"/>
          <Field label="Lead Time (days)" value={form.leadTimeDays} onChange={set('leadTimeDays')} type="number" placeholder="e.g. 90"/>
          <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Rating (1-5)</label>
            <div style={{display:'flex',gap:'6px'}}>
              {[1,2,3,4,5].map(n=><button key={n} type="button" onClick={()=>set('rating')(String(n))} style={{width:'36px',height:'36px',borderRadius:'50%',border:`2px solid ${parseInt(form.rating)>=n?'#F59E0B':'#E2E8F0'}`,background:parseInt(form.rating)>=n?'#FEF9C3':'white',cursor:'pointer',fontSize:'16px'}}>⭐</button>)}
            </div>
          </div>
        </div>
        <Field label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any additional notes about this supplier..."/>
        {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',marginBottom:'12px'}}>❌ {error}</div>}
        <div style={{display:'flex',gap:'10px'}}>
          <button type="button" onClick={onClose} style={{flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
          <button type="submit" disabled={saving} style={{flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white'}}>{saving?'⏳ Adding...':'✓ Add Supplier'}</button>
        </div>
      </form>
    </div>
  </div>)
}

function AddQuoteModal({supplier,onClose,onSuccess}:any){
  const [form,setForm]=useState({title:'',description:'',currency:'USD',unitPrice:'',quantity:'1',incoterms:'FOB',validUntil:'',leadTimeDays:String(supplier.leadTimeDays||''),paymentTerms:supplier.paymentTerms||'',includesFreight:false,includesInstall:false,notes:''})
  const [saving,setSaving]=useState(false);const [error,setError]=useState('')
  const set=(k:string)=>(v:any)=>setForm(p=>({...p,[k]:v}))
  const total=parseFloat(form.unitPrice||'0')*parseInt(form.quantity||'1')
  async function handleSubmit(e:React.FormEvent){e.preventDefault();setSaving(true);setError('')
    try{const res=await fetch('/api/suppliers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ADD_QUOTE',supplierId:supplier.id,...form,unitPrice:parseFloat(form.unitPrice),quantity:parseInt(form.quantity),leadTimeDays:form.leadTimeDays?parseInt(form.leadTimeDays):undefined})})
      const data=await res.json();if(data.success){onSuccess(`Quote added — Total: $${fmt(data.data.totalPrice)}`);onClose()}else setError(data.error||'Failed')}catch{setError('Network error')}finally{setSaving(false)}
  }
  return(<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
    <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'520px',boxShadow:'0 25px 50px rgba(0,0,0,0.25)',maxHeight:'92vh',overflowY:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px'}}><div><h3 style={{fontSize:'16px',fontWeight:'700',color:NAVY,margin:'0 0 2px'}}>📋 Add Quote</h3><p style={{fontSize:'12px',color:'#64748B',margin:0}}>{supplier.name}</p></div><button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px'}}>×</button></div>
      <form onSubmit={handleSubmit}>
        <Field label="Quote Title" value={form.title} onChange={set('title')} placeholder="e.g. John Deere 5055E — 10 units" required/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
          <Field label="Unit Price ($)" value={form.unitPrice} onChange={set('unitPrice')} type="number" placeholder="0.00" required/>
          <Field label="Quantity" value={form.quantity} onChange={set('quantity')} type="number" placeholder="1"/>
          <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Incoterms</label>
            <select value={form.incoterms} onChange={e=>set('incoterms')(e.target.value)} style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as any}}>
              {INCOTERMS.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Field label="Valid Until" value={form.validUntil} onChange={set('validUntil')} type="date"/>
          <Field label="Lead Time (days)" value={form.leadTimeDays} onChange={set('leadTimeDays')} type="number"/>
          <Field label="Payment Terms" value={form.paymentTerms} onChange={set('paymentTerms')} placeholder="e.g. 30% deposit"/>
        </div>
        <div style={{display:'flex',gap:'12px',marginBottom:'12px'}}>
          {[['includesFreight','🚢 Freight included'],['includesInstall','🔧 Installation included']].map(([k,l])=>(
            <label key={k} style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'13px',color:NAVY}}>
              <input type="checkbox" checked={(form as any)[k]} onChange={e=>set(k)(e.target.checked)}/>
              {l}
            </label>
          ))}
        </div>
        {total>0&&<div style={{background:'#F0FDF4',borderRadius:'8px',padding:'10px 14px',border:'1px solid #BBF7D0',marginBottom:'12px',fontSize:'13px',fontWeight:'600',color:TEAL}}>Total Quote Value: ${fmt(total)}</div>}
        <Field label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any additional quote notes..."/>
        {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',marginBottom:'12px'}}>❌ {error}</div>}
        <div style={{display:'flex',gap:'10px'}}>
          <button type="button" onClick={onClose} style={{flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
          <button type="submit" disabled={saving} style={{flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white'}}>{saving?'⏳ Adding...':'✓ Add Quote'}</button>
        </div>
      </form>
    </div>
  </div>)
}


// ── Quote Comparison ──────────────────────────────────────────
function QuoteComparisonModal({ quotes, onClose }: any) {
  if (quotes.length === 0) return null
  const best = quotes.reduce((a: any, b: any) => Number(a.totalPrice) < Number(b.totalPrice) ? a : b)

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px' }}>
      <div style={{ background:'white',borderRadius:'16px',width:'100%',maxWidth:'800px',maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 25px 50px rgba(0,0,0,0.3)',overflow:'hidden' }}>
        <div style={{ background:'#0D2137',padding:'18px 24px',flexShrink:0,display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div><h3 style={{ fontSize:'16px',fontWeight:'700',color:'white',margin:'0 0 2px' }}>⚖️ Quote Comparison</h3><p style={{ fontSize:'12px',color:'rgba(255,255,255,0.6)',margin:0 }}>{quotes.length} quotes compared</p></div>
          <button onClick={onClose} style={{ width:'32px',height:'32px',background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'18px',color:'white' }}>×</button>
        </div>
        <div style={{ flex:1,overflowX:'auto',overflowY:'auto' }}>
          <table style={{ width:'100%',borderCollapse:'collapse',minWidth:'600px' }}>
            <thead>
              <tr style={{ background:'#F8FAFC' }}>
                <th style={{ padding:'10px 14px',textAlign:'left',fontSize:'11px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase' }}>Criteria</th>
                {quotes.map((q: any) => (
                  <th key={q.id} style={{ padding:'10px 14px',textAlign:'center',fontSize:'11px',fontWeight:'600',color: q.id===best.id?'#0F6E56':'#64748B',borderBottom:'1px solid #E2E8F0',background:q.id===best.id?'#F0FDF4':'#F8FAFC',minWidth:'150px' }}>
                    {q.supplierName||'Supplier'} {q.id===best.id&&'🏆'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label:'Quote Title',    key:'title',            fmt:(v:any)=>v },
                { label:'Unit Price',     key:'unitPrice',        fmt:(v:any)=>`$${fmt(Number(v))}` },
                { label:'Quantity',       key:'quantity',         fmt:(v:any)=>v },
                { label:'Total Price',    key:'totalPrice',       fmt:(v:any)=>`$${fmt(Number(v))}`, bold:true },
                { label:'Incoterms',      key:'incoterms',        fmt:(v:any)=>v||'—' },
                { label:'Lead Time',      key:'leadTimeDays',     fmt:(v:any)=>v?`${v} days`:'—' },
                { label:'Payment Terms',  key:'paymentTerms',     fmt:(v:any)=>v||'—' },
                { label:'Freight Incl.', key:'includesFreight',  fmt:(v:any)=>v?'✅ Yes':'❌ No' },
                { label:'Install Incl.', key:'includesInstall',  fmt:(v:any)=>v?'✅ Yes':'❌ No' },
                { label:'Valid Until',    key:'validUntil',       fmt:(v:any)=>v?new Date(v).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—' },
                { label:'Status',         key:'status',           fmt:(v:any)=>v },
              ].map(row => (
                <tr key={row.key} style={{ borderBottom:'1px solid #F8FAFC' }}>
                  <td style={{ padding:'10px 14px',fontSize:'12px',fontWeight:'600',color:'#64748B',background:'#FAFAFA',whiteSpace:'nowrap' }}>{row.label}</td>
                  {quotes.map((q: any) => {
                    const val = row.fmt(q[row.key])
                    const isBest = q.id === best.id
                    const isPrice = row.key === 'totalPrice'
                    return (
                      <td key={q.id} style={{ padding:'10px 14px',textAlign:'center',fontSize: (row as any).bold?'14px':'13px',fontWeight:(row as any).bold?'700':'400',color:isBest&&isPrice?'#0F6E56':isBest?'#166534':'#374151',background:isBest?'#F0FDF4':'white' }}>
                        {val}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding:'14px 24px',borderTop:'1px solid #E2E8F0',background:'#F0FDF4',flexShrink:0,display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <div style={{ fontSize:'13px',color:'#166534' }}>🏆 Best price: <strong>{best.supplierName||'Best supplier'}</strong> at <strong>${fmt(Number(best.totalPrice))}</strong></div>
          <button onClick={onClose} style={{ padding:'8px 20px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

export default function SuppliersPage(){
  const [suppliers,setSuppliers]=useState<any[]>([]);const [loading,setLoading]=useState(true)
  const [toast,setToast]=useState<any>(null);const [showAdd,setShowAdd]=useState(false)
  const [selectedSupplier,setSelectedSupplier]=useState<any>(null);const [showQuote,setShowQuote]=useState(false)
  const [search,setSearch]=useState('');const [filterCat,setFilterCat]=useState('ALL')
  const [compareQuotes,setCompareQuotes]=useState<any[]>([]);const [showCompare,setShowCompare]=useState(false)
  const showToast=(msg:string,type='success')=>setToast({msg,type})

  const fetchSuppliers=useCallback(async()=>{setLoading(true)
    try{const params=new URLSearchParams();if(search)params.set('search',search);if(filterCat!=='ALL')params.set('category',filterCat)
      const res=await fetch(`/api/suppliers?${params}`);const json=await res.json();if(json.success)setSuppliers(json.data)}catch{}finally{setLoading(false)}
  },[search,filterCat])

  useEffect(()=>{fetchSuppliers()},[fetchSuppliers])

  async function updateQuoteStatus(quoteId:string,status:string){
    try{const res=await fetch('/api/suppliers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'UPDATE_QUOTE_STATUS',quoteId,status})})
      const json=await res.json();if(json.success){showToast(`Quote ${status.toLowerCase()}`);fetchSuppliers()}else showToast(json.error||'Failed','error')}catch{showToast('Network error','error')}
  }

  async function verifySupplier(id:string){
    try{const res=await fetch('/api/suppliers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'VERIFY',supplierId:id})})
      const json=await res.json();if(json.success){showToast('Supplier verified');fetchSuppliers()}else showToast(json.error||'Failed','error')}catch{showToast('Network error','error')}
  }

  return(<div style={{display:'flex',flexDirection:'column',gap:'20px'}}>
    {toast&&<Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
    {showCompare&&<QuoteComparisonModal quotes={compareQuotes} onClose={()=>setShowCompare(false)}/>}
    {showAdd&&<AddSupplierModal onClose={()=>setShowAdd(false)} onSuccess={(msg:string)=>{showToast(msg);fetchSuppliers()}}/>}
    {showQuote&&selectedSupplier&&<AddQuoteModal supplier={selectedSupplier} onClose={()=>{setShowQuote(false);setSelectedSupplier(null)}} onSuccess={(msg:string)=>{showToast(msg);fetchSuppliers()}}/>}

    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div><h2 style={{fontSize:'20px',fontWeight:'700',color:NAVY,margin:'0 0 4px'}}>🏭 Supplier Directory</h2><p style={{fontSize:'13px',color:'#64748B',margin:0}}>Manage suppliers and compare quotes for asset campaigns</p></div>
      <div style={{display:'flex',gap:'8px'}}>
      {suppliers.length>1&&(
        <button onClick={()=>{
          const allQuotes=suppliers.flatMap((s:any)=>s.recentQuotes.map((q:any)=>({...q,supplierName:s.name,supplierId:s.id})))
          setCompareQuotes(allQuotes);setShowCompare(true)
        }} style={{padding:'8px 14px',background:'#EEF2FF',color:'#3730A3',border:'1px solid #C7D2FE',borderRadius:'8px',fontSize:'12px',cursor:'pointer',fontWeight:'500'}}>⚖️ Compare Quotes</button>
      )}
      style={{padding:'8px 12px',background:'#F1F5F9',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'12px',cursor:'pointer',color:'#475569'}}>↻</button><button onClick={()=>setShowAdd(true)} style={{padding:'10px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Add Supplier</button></div>
    </div>

    {/* Filters */}
    <div style={{display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'center'}}>
      <input placeholder="Search suppliers..." value={search} onChange={e=>setSearch(e.target.value)} style={{padding:'8px 14px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',width:'220px',outline:'none'}}/>
      {['ALL',...CATEGORIES].map(c=>(
        <button key={c} onClick={()=>setFilterCat(c)} style={{padding:'6px 14px',borderRadius:'999px',fontSize:'12px',fontWeight:'500',cursor:'pointer',background:filterCat===c?TEAL:'white',color:filterCat===c?'white':'#64748B',border:filterCat===c?'none':'1.5px solid #E2E8F0'}}>{c}</button>
      ))}
    </div>

    {loading?<div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}><div style={{fontSize:'28px',marginBottom:'10px'}}>⏳</div><p style={{color:'#64748B'}}>Loading suppliers...</p></div>
    :suppliers.length===0?<div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}>
      <div style={{fontSize:'40px',marginBottom:'12px'}}>🏭</div><h3 style={{fontSize:'16px',fontWeight:'600',color:NAVY,margin:'0 0 8px'}}>{search||filterCat!=='ALL'?'No suppliers match your filter':'No suppliers yet'}</h3>
      {!search&&filterCat==='ALL'&&<button onClick={()=>setShowAdd(true)} style={{padding:'10px 20px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Add First Supplier</button>}
    </div>:(
      <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
        {suppliers.map((s:any)=>(
          <div key={s.id} style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
            <div style={{padding:'16px 20px',display:'flex',alignItems:'flex-start',gap:'14px',flexWrap:'wrap'}}>
              <div style={{width:'44px',height:'44px',borderRadius:'10px',background:'#F0FDF4',color:TEAL,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',flexShrink:0}}>🏭</div>
              <div style={{flex:1,minWidth:'200px'}}>
                <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'3px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'15px',fontWeight:'700',color:NAVY}}>{s.name}</span>
                  {s.tradingName&&<span style={{fontSize:'11px',color:'#94A3B8'}}>({s.tradingName})</span>}
                  {s.isVerified&&<span style={{background:'#DCFCE7',color:'#166534',fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px'}}>✓ Verified</span>}
                  <span style={{background:'#EEF2FF',color:'#3730A3',fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px'}}>{s.category}</span>
                </div>
                <div style={{fontSize:'12px',color:'#64748B'}}>📍 {s.city||''}{s.city&&', '}{s.country} {s.phone&&`· 📞 ${s.phone}`} {s.email&&`· ✉️ ${s.email}`}</div>
                {s.contactPerson&&<div style={{fontSize:'12px',color:'#94A3B8',marginTop:'2px'}}>Contact: {s.contactPerson} {s.contactPhone&&`· ${s.contactPhone}`}</div>}
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'6px',flexShrink:0}}>
                {s.rating&&<div style={{fontSize:'14px'}}>{Array(s.rating).fill('⭐').join('')}</div>}
                <div style={{fontSize:'11px',color:'#94A3B8'}}>{s.quoteCount} quote{s.quoteCount!==1?'s':''}</div>
                {s.leadTimeDays&&<div style={{fontSize:'11px',color:'#64748B'}}>Lead: {s.leadTimeDays}d</div>}
              </div>
              <div style={{display:'flex',gap:'6px',flexShrink:0,alignSelf:'flex-start'}}>
                {!s.isVerified&&<button onClick={()=>verifySupplier(s.id)} style={{padding:'6px 10px',background:'#DCFCE7',color:'#166534',border:'1px solid #86EFAC',borderRadius:'6px',fontSize:'11px',cursor:'pointer'}}>✓ Verify</button>}
                <button onClick={()=>{setSelectedSupplier(s);setShowQuote(true)}} style={{padding:'6px 12px',background:TEAL,color:'white',border:'none',borderRadius:'6px',fontSize:'11px',cursor:'pointer',fontWeight:'600'}}>+ Quote</button>
              </div>
            </div>
            {/* Recent quotes */}
            {s.recentQuotes.length>0&&(
              <div style={{borderTop:'1px solid #F1F5F9',padding:'10px 20px',background:'#FAFAFA'}}>
                <div style={{fontSize:'11px',color:'#94A3B8',fontWeight:'600',marginBottom:'6px'}}>RECENT QUOTES</div>
                <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                  {s.recentQuotes.map((q:any)=>{
                    const sm=QUOTE_STATUS_META[q.status]||QUOTE_STATUS_META.RECEIVED
                    return(<div key={q.id} style={{background:'white',borderRadius:'8px',border:'1px solid #E2E8F0',padding:'8px 12px',minWidth:'180px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'3px'}}>
                        <span style={{fontSize:'12px',fontWeight:'500',color:NAVY}}>{q.title.slice(0,25)}{q.title.length>25?'...':''}</span>
                        <span style={{background:sm.bg,color:sm.color,fontSize:'9px',fontWeight:'600',padding:'1px 5px',borderRadius:'4px'}}>{q.status}</span>
                      </div>
                      <div style={{fontSize:'13px',fontWeight:'700',color:TEAL}}>${fmt(q.totalPrice)} <span style={{fontSize:'10px',color:'#94A3B8',fontWeight:'400'}}>{q.currency}</span></div>
                      <div style={{display:'flex',gap:'4px',marginTop:'5px'}}>
                        {q.status==='RECEIVED'&&<button onClick={()=>updateQuoteStatus(q.id,'SHORTLISTED')} style={{padding:'2px 6px',background:'#FEF9C3',color:'#854D0E',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Shortlist</button>}
                        {q.status==='SHORTLISTED'&&<><button onClick={()=>updateQuoteStatus(q.id,'ACCEPTED')} style={{padding:'2px 6px',background:'#DCFCE7',color:'#166534',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Accept</button><button onClick={()=>updateQuoteStatus(q.id,'REJECTED')} style={{padding:'2px 6px',background:'#FEE2E2',color:'#991B1B',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Reject</button></>}
                      </div>
                    </div>)
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </div>)
}
