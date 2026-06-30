'use client'
import { useState, useEffect, useCallback } from 'react'
const TEAL='#0F6E56';const NAVY='#0D2137';const BLUE='#1A5EA8'
const fmt=(n:number)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)

const MAINT_TYPES=[{value:'SERVICE',icon:'🔧',label:'Routine Service'},{value:'REPAIR',icon:'🔩',label:'Repair'},{value:'INSPECTION',icon:'🔍',label:'Inspection'},{value:'OVERHAUL',icon:'⚙️',label:'Major Overhaul'},{value:'OTHER',icon:'📦',label:'Other'}]
const STATUS_META:Record<string,any>={SCHEDULED:{bg:'#DBEAFE',color:'#1E40AF'},COMPLETED:{bg:'#DCFCE7',color:'#166534'},OVERDUE:{bg:'#FEE2E2',color:'#991B1B'},CANCELLED:{bg:'#F1F5F9',color:'#475569'}}

function Toast({msg,type,onClose}:any){useEffect(()=>{const t=setTimeout(onClose,4500);return()=>clearTimeout(t)},[onClose]);return<div style={{position:'fixed',top:'20px',right:'20px',zIndex:9999,padding:'12px 20px',borderRadius:'10px',fontWeight:'500',fontSize:'13px',boxShadow:'0 8px 25px rgba(0,0,0,0.15)',background:type==='success'?'#166534':'#991B1B',color:'white',display:'flex',alignItems:'center',gap:'10px'}}><span>{type==='success'?'✅':'❌'}</span><span>{msg}</span><button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'18px'}}>×</button></div>}
function Field({label,value,onChange,type='text',placeholder='',required=false}:any){return<div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>{label}{required&&<span style={{color:'#DC2626'}}> *</span>}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} required={required} style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/></div>}

function AddMaintenanceModal({asset,onClose,onSuccess}:any){
  const [form,setForm]=useState({type:'SERVICE',description:'',performedBy:'',vendor:'',cost:'0',scheduledDate:new Date().toISOString().split('T')[0],nextDueDate:'',mileageAtService:'',notes:''})
  const [saving,setSaving]=useState(false);const [error,setError]=useState('')
  const set=(k:string)=>(v:string)=>setForm(p=>({...p,[k]:v}))
  async function handleSubmit(e:React.FormEvent){e.preventDefault();setSaving(true);setError('')
    try{const res=await fetch('/api/assets/maintenance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,assetId:asset.id,cost:parseFloat(form.cost||'0'),mileageAtService:form.mileageAtService?parseInt(form.mileageAtService):undefined,status:'SCHEDULED'})})
      const data=await res.json();if(data.success){onSuccess(data.message);onClose()}else setError(data.error||'Failed')}catch{setError('Network error')}finally{setSaving(false)}
  }
  return(<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
    <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'500px',boxShadow:'0 25px 50px rgba(0,0,0,0.25)',maxHeight:'90vh',overflowY:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px'}}><h3 style={{fontSize:'16px',fontWeight:'700',color:NAVY,margin:0}}>🔧 Schedule Maintenance</h3><button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px'}}>×</button></div>
      <form onSubmit={handleSubmit}>
        <div style={{marginBottom:'13px'}}>
          <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'6px'}}>Type</label>
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'6px'}}>
            {MAINT_TYPES.map(t=><div key={t.value} onClick={()=>set('type')(t.value)} style={{padding:'8px 4px',borderRadius:'8px',cursor:'pointer',border:`2px solid ${form.type===t.value?TEAL:'#E2E8F0'}`,background:form.type===t.value?'#F0FDF4':'white',textAlign:'center',fontSize:'11px',fontWeight:'500',color:NAVY}}><div style={{fontSize:'18px'}}>{t.icon}</div><div>{t.label}</div></div>)}
          </div>
        </div>
        <div style={{gridColumn:'1/-1'}}><Field label="Description" value={form.description} onChange={set('description')} placeholder="Describe the maintenance work..." required/></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
          <Field label="Performed By" value={form.performedBy} onChange={set('performedBy')} placeholder="Technician name"/>
          <Field label="Vendor / Garage" value={form.vendor} onChange={set('vendor')} placeholder="Service centre name"/>
          <Field label="Estimated Cost ($)" value={form.cost} onChange={set('cost')} type="number" placeholder="0.00"/>
          <Field label="Mileage at Service" value={form.mileageAtService} onChange={set('mileageAtService')} type="number" placeholder="e.g. 45000"/>
          <Field label="Scheduled Date" value={form.scheduledDate} onChange={set('scheduledDate')} type="date" required/>
          <Field label="Next Due Date" value={form.nextDueDate} onChange={set('nextDueDate')} type="date"/>
        </div>
        <Field label="Notes" value={form.notes} onChange={set('notes')} placeholder="Any additional notes..."/>
        {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',marginBottom:'12px'}}>❌ {error}</div>}
        <div style={{display:'flex',gap:'10px'}}>
          <button type="button" onClick={onClose} style={{flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
          <button type="submit" disabled={saving} style={{flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white'}}>{saving?'⏳ Scheduling...':'✓ Schedule Maintenance'}</button>
        </div>
      </form>
    </div>
  </div>)
}

function DepreciationModal({asset,existing,onClose,onSuccess}:any){
  const [form,setForm]=useState({method:'STRAIGHT_LINE',usefulLifeYears:existing?.usefulLifeYears||'5',residualValue:existing?.residualValue||'0',acquisitionCost:existing?.acquisitionCost||String(asset.acquisitionCost||'')})
  const [saving,setSaving]=useState(false);const [error,setError]=useState('')
  const set=(k:string)=>(v:string)=>setForm(p=>({...p,[k]:v}))
  const annualDep=((parseFloat(form.acquisitionCost||'0')-parseFloat(form.residualValue||'0'))/Math.max(1,parseInt(form.usefulLifeYears||'5')))
  async function handleSubmit(e:React.FormEvent){e.preventDefault();setSaving(true);setError('')
    try{const res=await fetch('/api/assets/maintenance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'SET_DEPRECIATION',assetId:asset.id,...form,usefulLifeYears:parseInt(form.usefulLifeYears),residualValue:parseFloat(form.residualValue),acquisitionCost:parseFloat(form.acquisitionCost)})})
      const data=await res.json();if(data.success){onSuccess('Depreciation schedule set');onClose()}else setError(data.error||'Failed')}catch{setError('Network error')}finally{setSaving(false)}
  }
  return(<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
    <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'460px',boxShadow:'0 25px 50px rgba(0,0,0,0.25)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px'}}><h3 style={{fontSize:'16px',fontWeight:'700',color:NAVY,margin:0}}>📉 Set Depreciation Schedule</h3><button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px'}}>×</button></div>
      <form onSubmit={handleSubmit}>
        <div style={{marginBottom:'13px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Method</label>
          <div style={{display:'flex',gap:'8px'}}>
            {[['STRAIGHT_LINE','📏 Straight Line'],['DECLINING_BALANCE','📉 Declining Balance']].map(([v,l])=><div key={v} onClick={()=>set('method')(v)} style={{flex:1,padding:'10px',borderRadius:'8px',cursor:'pointer',border:`2px solid ${form.method===v?TEAL:'#E2E8F0'}`,background:form.method===v?'#F0FDF4':'white',fontSize:'12px',fontWeight:'500',color:NAVY,textAlign:'center'}}>{l}</div>)}
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
          <Field label="Acquisition Cost ($)" value={form.acquisitionCost} onChange={set('acquisitionCost')} type="number" required/>
          <Field label="Residual Value ($)" value={form.residualValue} onChange={set('residualValue')} type="number"/>
          <Field label="Useful Life (years)" value={form.usefulLifeYears} onChange={set('usefulLifeYears')} type="number" required/>
        </div>
        {parseFloat(form.acquisitionCost||'0')>0&&(
          <div style={{background:'#F0FDF4',borderRadius:'8px',padding:'12px 14px',border:'1px solid #BBF7D0',fontSize:'12px',color:'#166534',marginBottom:'14px'}}>
            📊 Annual depreciation: <strong>${fmt(annualDep)}</strong> / year &nbsp;·&nbsp; After 5 years: <strong>${fmt(parseFloat(form.acquisitionCost||'0')-annualDep*5)}</strong> book value
          </div>
        )}
        {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',marginBottom:'12px'}}>❌ {error}</div>}
        <div style={{display:'flex',gap:'10px'}}>
          <button type="button" onClick={onClose} style={{flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
          <button type="submit" disabled={saving} style={{flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white'}}>{saving?'⏳ Saving...':'✓ Set Schedule'}</button>
        </div>
      </form>
    </div>
  </div>)
}


function CompleteModal({record, onClose, onSubmit}: any){
  const [completedDate, setCompletedDate] = useState(new Date().toISOString().split('T')[0])
  const [actualCost, setActualCost]       = useState(String(record.cost||'0'))
  const [nextDueDate, setNextDueDate]     = useState('')
  const [notes, setNotes]                 = useState('')
  const [saving, setSaving]               = useState(false)

  async function handle(e: React.FormEvent){
    e.preventDefault(); setSaving(true)
    await onSubmit(record.id, completedDate, actualCost, nextDueDate, notes)
    setSaving(false)
  }

  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
      <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'440px',boxShadow:'0 25px 50px rgba(0,0,0,0.25)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px'}}>
          <div><h3 style={{fontSize:'16px',fontWeight:'700',color:'#0D2137',margin:'0 0 2px'}}>✅ Complete Maintenance</h3><p style={{fontSize:'12px',color:'#64748B',margin:0}}>{record.description}</p></div>
          <button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px'}}>×</button>
        </div>
        <form onSubmit={handle}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Completion Date *</label>
              <input type="date" value={completedDate} onChange={e=>setCompletedDate(e.target.value)} required style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/>
            </div>
            <div style={{marginBottom:'12px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Actual Cost ($)</label>
              <input type="number" value={actualCost} onChange={e=>setActualCost(e.target.value)} style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/>
            </div>
            <div style={{marginBottom:'12px',gridColumn:'1/-1'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Next Due Date</label>
              <input type="date" value={nextDueDate} onChange={e=>setNextDueDate(e.target.value)} style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any}}/>
            </div>
          </div>
          <div style={{marginBottom:'14px'}}><label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Completion Notes</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3} placeholder="What was done, parts replaced, observations..."
              style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box' as any,resize:'vertical' as any}}/>
          </div>
          <div style={{display:'flex',gap:'10px'}}>
            <button type="button" onClick={onClose} style={{flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
            <button type="submit" disabled={saving} style={{flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':'linear-gradient(135deg,#0D2137,#0F6E56)',color:'white'}}>
              {saving?'⏳ Saving...':'✅ Mark Complete'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function MaintenancePanel({asset,onClose}:{asset:any;onClose:()=>void}){
  const [data,setData]=useState<any>(null);const [loading,setLoading]=useState(true)
  const [toast,setToast]=useState<any>(null);const [showAdd,setShowAdd]=useState(false);const [showDep,setShowDep]=useState(false)
  const showToast=(msg:string,type='success')=>setToast({msg,type})
  const fetchData=useCallback(async()=>{setLoading(true);try{const res=await fetch(`/api/assets/maintenance?assetId=${asset.id}`);const json=await res.json();if(json.success)setData(json.data)}catch{}finally{setLoading(false)}},[asset.id])
  useEffect(()=>{fetchData()},[fetchData])

  const [completeModal, setCompleteModal] = useState<any>(null)

  async function markComplete(record: any){
    setCompleteModal(record)
  }

  async function submitComplete(recordId: string, completedDate: string, actualCost: string, nextDueDate: string, notes: string){
    try{
      const res=await fetch('/api/assets/maintenance',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'COMPLETE',recordId,completedDate,cost:actualCost?parseFloat(actualCost):undefined,nextDueDate:nextDueDate||undefined,notes:notes||undefined})})
      const json=await res.json()
      if(json.success){showToast('Maintenance completed ✓');setCompleteModal(null);fetchData()}
      else showToast(json.error||'Failed','error')
    }catch{showToast('Network error','error')}
  }

  const {records=[],depreciation=null,summary={}}=data||{}
  const now=new Date()

  return(<div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
    {toast&&<Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
    {showAdd&&<AddMaintenanceModal asset={asset} onClose={()=>setShowAdd(false)} onSuccess={(msg:string)=>{showToast(msg);fetchData()}}/>}
    {completeModal&&<CompleteModal record={completeModal} onClose={()=>setCompleteModal(null)} onSubmit={submitComplete}/>}
    {showDep&&<DepreciationModal asset={asset} existing={depreciation} onClose={()=>setShowDep(false)} onSuccess={(msg:string)=>{showToast(msg);fetchData()}}/>}

    <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
      <button onClick={onClose} style={{background:'#F1F5F9',border:'none',borderRadius:'8px',padding:'8px 14px',cursor:'pointer',fontSize:'13px',color:'#475569'}}>← Back</button>
      <div style={{flex:1}}><h2 style={{fontSize:'18px',fontWeight:'700',color:NAVY,margin:0}}>🔧 Maintenance & Depreciation</h2><p style={{fontSize:'12px',color:'#64748B',margin:'2px 0 0'}}>{asset.name}</p></div>
      <div style={{display:'flex',gap:'8px'}}>
        <button onClick={()=>setShowDep(true)} style={{padding:'8px 14px',background:'#EEF2FF',color:'#3730A3',border:'1px solid #C7D2FE',borderRadius:'8px',fontSize:'12px',cursor:'pointer',fontWeight:'500'}}>📉 Depreciation</button>
        <button onClick={()=>setShowAdd(true)} style={{padding:'9px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Schedule</button>
      </div>
    </div>

    {/* KPI */}
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px'}}>
      {[{label:'Total Records',value:loading?'—':summary.totalRecords||0,color:NAVY},{label:'Overdue',value:loading?'—':summary.overdue||0,color:summary.overdue>0?'#991B1B':TEAL},{label:'Upcoming',value:loading?'—':summary.upcoming||0,color:BLUE},{label:'Total Cost',value:loading?'—':`$${fmt(summary.totalMaintenanceCost||0)}`,color:'#854D0E'}].map(s=>(
        <div key={s.label} style={{background:'white',borderRadius:'10px',padding:'14px',border:'1px solid #E2E8F0'}}><div style={{fontSize:'11px',color:'#64748B',marginBottom:'4px'}}>{s.label}</div><div style={{fontSize:'20px',fontWeight:'700',color:s.color}}>{s.value}</div></div>
      ))}
    </div>

    {/* Depreciation card */}
    {depreciation&&(
      <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'18px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
          <h3 style={{fontSize:'14px',fontWeight:'600',color:NAVY,margin:0}}>📉 Depreciation Schedule</h3>
          <button onClick={()=>setShowDep(true)} style={{fontSize:'11px',color:TEAL,background:'none',border:'none',cursor:'pointer'}}>Edit →</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px',fontSize:'13px'}}>
          {[['Method',depreciation.method.replace('_',' ')],['Useful Life',`${depreciation.usefulLifeYears} years`],['Acquisition Cost',`$${fmt(depreciation.acquisitionCost)}`],['Residual Value',`$${fmt(depreciation.residualValue)}`]].map(([l,v])=>(
            <div key={l} style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px'}}><div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em'}}>{l}</div><div style={{fontSize:'13px',fontWeight:'600',color:NAVY,marginTop:'2px'}}>{v}</div></div>
          ))}
        </div>
        {depreciation.currentDepreciatedValue&&(
          <div style={{marginTop:'12px',background:'#F0FDF4',borderRadius:'8px',padding:'10px 14px',border:'1px solid #BBF7D0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:'13px',color:'#166534',fontWeight:'500'}}>Current Book Value (estimated)</span>
            <span style={{fontSize:'18px',fontWeight:'700',color:TEAL}}>${fmt(depreciation.currentDepreciatedValue)}</span>
          </div>
        )}
      </div>
    )}

    {/* Cost analysis */}
    {!loading&&records.filter((r:any)=>r.status==='COMPLETED').length>0&&(
      <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'18px'}}>
        <h3 style={{fontSize:'14px',fontWeight:'600',color:NAVY,margin:'0 0 14px'}}>📊 Cost Analysis</h3>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px',marginBottom:'14px'}}>
          {[
            {label:'Total Spent',value:`$${fmt(records.filter((r:any)=>r.status==='COMPLETED').reduce((s:number,r:any)=>s+r.cost,0))}`,color:'#854D0E'},
            {label:'Avg per Service',value:records.filter((r:any)=>r.status==='COMPLETED').length>0?`$${fmt(records.filter((r:any)=>r.status==='COMPLETED').reduce((s:number,r:any)=>s+r.cost,0)/records.filter((r:any)=>r.status==='COMPLETED').length)}`:'$0.00',color:BLUE},
            {label:'Most Expensive',value:records.filter((r:any)=>r.status==='COMPLETED').length>0?`$${fmt(Math.max(...records.filter((r:any)=>r.status==='COMPLETED').map((r:any)=>r.cost)))}`:'$0.00',color:'#991B1B'},
            {label:'Services Done',value:records.filter((r:any)=>r.status==='COMPLETED').length,color:TEAL},
          ].map(s=><div key={s.label} style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px'}}><div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em'}}>{s.label}</div><div style={{fontSize:'16px',fontWeight:'700',color:s.color,marginTop:'2px'}}>{s.value}</div></div>)}
        </div>
        <div style={{fontSize:'11px',color:'#94A3B8',borderTop:'1px solid #F1F5F9',paddingTop:'10px'}}>
          Maintenance cost breakdown by type:&nbsp;
          {Object.entries(records.filter((r:any)=>r.status==='COMPLETED').reduce((acc:any,r:any)=>{acc[r.type]=(acc[r.type]||0)+r.cost;return acc},{})).map(([type,cost]:any)=>(
            <span key={type} style={{marginRight:'12px'}}><strong style={{color:NAVY}}>{type}:</strong> ${fmt(cost)}</span>
          ))}
        </div>
      </div>
    )}
    {/* Overdue alert */}
    {summary.overdue>0&&<div style={{background:'#FEE2E2',border:'1px solid #FECACA',borderRadius:'10px',padding:'12px 16px',fontSize:'13px',color:'#991B1B',display:'flex',alignItems:'center',gap:'10px'}}>⚠️ <strong>{summary.overdue} maintenance record{summary.overdue!==1?'s':''} overdue.</strong> Schedule or complete these immediately.</div>}

    {/* Records */}
    {loading?<div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}><div style={{fontSize:'28px',marginBottom:'10px'}}>⏳</div><p style={{color:'#64748B'}}>Loading records...</p></div>
    :records.length===0?<div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'60px',textAlign:'center'}}>
      <div style={{fontSize:'40px',marginBottom:'12px'}}>🔧</div><h3 style={{fontSize:'16px',fontWeight:'600',color:NAVY,margin:'0 0 8px'}}>No maintenance records</h3>
      <p style={{color:'#64748B',fontSize:'13px',marginBottom:'20px'}}>Track all service, repair and inspection records for this asset.</p>
      <button onClick={()=>setShowAdd(true)} style={{padding:'10px 20px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Schedule First Maintenance</button>
    </div>:(
      <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:'#F8FAFC'}}>{['Type','Description','Vendor','Cost','Scheduled','Status','Action'].map(h=><th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
          <tbody>
            {records.map((r:any,i:number)=>{
              const sm=STATUS_META[r.isOverdue?'OVERDUE':r.status]||STATUS_META.SCHEDULED
              const ti=MAINT_TYPES.find(t=>t.value===r.type)||MAINT_TYPES[4]
              return(<tr key={r.id} style={{borderBottom:'1px solid #F8FAFC',background:r.isOverdue?'#FFF5F5':i%2===0?'white':'#FAFAFA'}}>
                <td style={{padding:'10px 14px'}}><span style={{fontSize:'16px'}}>{ti.icon}</span> <span style={{fontSize:'11px',color:'#475569'}}>{ti.label}</span></td>
                <td style={{padding:'10px 14px',fontSize:'13px',color:NAVY,fontWeight:'500',maxWidth:'200px'}}>{r.description}</td>
                <td style={{padding:'10px 14px',fontSize:'12px',color:'#64748B'}}>{r.vendor||r.performedBy||'—'}</td>
                <td style={{padding:'10px 14px',fontSize:'13px',fontWeight:'600',color:'#854D0E'}}>${fmt(r.cost)}</td>
                <td style={{padding:'10px 14px',fontSize:'11px',color:'#64748B',whiteSpace:'nowrap'}}>{r.scheduledDate?new Date(r.scheduledDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):'—'}</td>
                <td style={{padding:'10px 14px'}}><span style={{background:sm.bg,color:sm.color,fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'999px'}}>{r.isOverdue?'OVERDUE':r.status}</span></td>
                <td style={{padding:'10px 14px'}}>
                  {r.status==='SCHEDULED'&&<button onClick={()=>markComplete(r)} style={{padding:'4px 10px',background:'#DCFCE7',color:'#166534',border:'1px solid #86EFAC',borderRadius:'6px',fontSize:'11px',cursor:'pointer',fontWeight:'500'}}>✓ Complete</button>}
                  {r.status==='COMPLETED'&&r.nextDueDate&&<span style={{fontSize:'11px',color:'#94A3B8'}}>Next: {new Date(r.nextDueDate).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>}
                </td>
              </tr>)
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>)
}
