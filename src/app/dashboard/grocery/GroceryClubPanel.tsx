'use client'
// src/app/dashboard/grocery/GroceryClubPanel.tsx — v1.0
import { useState, useEffect, useCallback } from 'react'

const TEAL = '#0F6E56'; const NAVY = '#0D2137'; const GOLD = '#854D0E'
const GREEN = '#166534'; const RED = '#991B1B'; const PURPLE = '#7C3AED'

const STATUS_META: Record<string, any> = {
  SETUP:        { bg:'#EEF2FF', color:'#3730A3', icon:'⚙️',  label:'Setup'       },
  ACTIVE:       { bg:'#DCFCE7', color:GREEN,      icon:'▶️',  label:'Active'      },
  PURCHASING:   { bg:'#FEF9C3', color:GOLD,       icon:'🛒',  label:'Purchasing'  },
  DISTRIBUTED:  { bg:'#F0FDF4', color:GREEN,      icon:'📦',  label:'Distributed' },
  CLOSED:       { bg:'#F1F5F9', color:'#475569',  icon:'✅',  label:'Closed'      },
  CANCELLED:    { bg:'#FEE2E2', color:RED,        icon:'🚫',  label:'Cancelled'   },
}

const ITEM_STATUS: Record<string, any> = {
  PENDING:     { bg:'#F1F5F9', color:'#475569', icon:'⏳', label:'Pending'     },
  ASSIGNED:    { bg:'#EEF2FF', color:PURPLE,    icon:'👤', label:'Assigned'    },
  PURCHASED:   { bg:'#DCFCE7', color:GREEN,     icon:'✅', label:'Purchased'   },
  DISTRIBUTED: { bg:'#F0FDF4', color:GREEN,     icon:'📦', label:'Distributed' },
}

const FREQ: Record<string,string> = { WEEKLY:'Weekly', FORTNIGHTLY:'Fortnightly', MONTHLY:'Monthly' }

const fmt = (n: number) => new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)

function Toast({ msg, type, onClose }: any) {
  useEffect(()=>{ const t=setTimeout(onClose,4000); return()=>clearTimeout(t) },[onClose])
  return <div style={{position:'fixed',top:'20px',right:'20px',zIndex:9999,padding:'12px 20px',borderRadius:'10px',fontSize:'13px',fontWeight:'500',boxShadow:'0 8px 25px rgba(0,0,0,0.15)',background:type==='success'?'#166534':'#991B1B',color:'white',display:'flex',alignItems:'center',gap:'10px',maxWidth:'420px'}}>
    <span>{type==='success'?'✅':'❌'}</span><span style={{flex:1}}>{msg}</span>
    <button onClick={onClose} style={{background:'none',border:'none',color:'white',cursor:'pointer',fontSize:'18px'}}>×</button>
  </div>
}

function Pill({ bg, color, children }: any) {
  return <span style={{background:bg,color,fontSize:'11px',fontWeight:'600',padding:'3px 9px',borderRadius:'999px',whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:'4px'}}>{children}</span>
}

// ── Create Club Modal ─────────────────────────────────────────
function CreateClubModal({ groupId, members, onClose, onSuccess }: any) {
  const [form, setForm] = useState({
    name:'', description:'', periodMonths:'3', contributionFrequency:'MONTHLY',
    startDate: new Date().toISOString().split('T')[0],
    coordinatorId:'', notes:'', memberIds:[] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k: string) => (v: any) => setForm(p=>({...p,[k]:v}))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const res  = await fetch('/api/grocery', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({...form, groupId, periodMonths:parseInt(form.periodMonths),
          memberIds: form.memberIds.filter(Boolean)}) })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error||'Failed')
    } catch { setError('Network error') } finally { setSaving(false) }
  }

  const allSelected = members.length > 0 && members.every((m:any) => form.memberIds.includes(m.userId||m.id))

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
      <div style={{background:'white',borderRadius:'16px',width:'100%',maxWidth:'560px',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 25px 50px rgba(0,0,0,0.3)'}}>
        <div style={{background:`linear-gradient(135deg,${NAVY},${TEAL})`,padding:'20px 24px',borderRadius:'16px 16px 0 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <h3 style={{fontSize:'16px',fontWeight:'700',color:'white',margin:'0 0 2px'}}>🛒 New Grocery Club</h3>
            <p style={{fontSize:'12px',color:'rgba(255,255,255,0.6)',margin:0}}>Pool contributions to buy groceries in bulk</p>
          </div>
          <button onClick={onClose} style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',width:'32px',height:'32px',cursor:'pointer',fontSize:'18px',color:'white'}}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{padding:'22px 24px'}}>
          <div style={{marginBottom:'13px'}}>
            <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Club Name *</label>
            <input type="text" value={form.name} onChange={e=>set('name')(e.target.value)} required placeholder="e.g. Q1 2025 Grocery Club"
              style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'13px'}}>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Period *</label>
              <select value={form.periodMonths} onChange={e=>set('periodMonths')(e.target.value)}
                style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box'}}>
                {[1,2,3,6,12].map(m=><option key={m} value={m}>{m} month{m>1?'s':''}</option>)}
              </select>
            </div>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Frequency *</label>
              <select value={form.contributionFrequency} onChange={e=>set('contributionFrequency')(e.target.value)}
                style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box'}}>
                <option value="WEEKLY">Weekly</option>
                <option value="FORTNIGHTLY">Fortnightly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>
            <div>
              <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Start Date *</label>
              <input type="date" value={form.startDate} onChange={e=>set('startDate')(e.target.value)} required
                style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
            </div>
          </div>

          <div style={{marginBottom:'13px'}}>
            <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Coordinator (Group Leader)</label>
            <select value={form.coordinatorId} onChange={e=>set('coordinatorId')(e.target.value)}
              style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box'}}>
              <option value="">Select coordinator...</option>
              {members.map((m:any)=><option key={m.userId||m.id} value={m.userId||m.id}>{m.fullName}</option>)}
            </select>
          </div>

          <div style={{marginBottom:'13px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151'}}>Members</label>
              <button type="button" onClick={()=>set('memberIds')(allSelected?[]:members.map((m:any)=>m.userId||m.id))}
                style={{fontSize:'11px',color:TEAL,background:'none',border:'none',cursor:'pointer',fontWeight:'600'}}>
                {allSelected?'Deselect all':'Select all'}
              </button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'5px',maxHeight:'160px',overflowY:'auto',border:'1.5px solid #E2E8F0',borderRadius:'8px',padding:'8px'}}>
              {members.map((m:any)=>{
                const uid = m.userId||m.id
                const sel = form.memberIds.includes(uid)
                return <div key={uid} onClick={()=>set('memberIds')(sel?form.memberIds.filter((id:string)=>id!==uid):[...form.memberIds,uid])}
                  style={{display:'flex',alignItems:'center',gap:'8px',padding:'6px 8px',borderRadius:'6px',cursor:'pointer',background:sel?'#F0FDF4':'white',border:`1px solid ${sel?TEAL:'transparent'}`}}>
                  <div style={{width:'16px',height:'16px',borderRadius:'4px',border:`2px solid ${sel?TEAL:'#CBD5E1'}`,background:sel?TEAL:'white',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {sel&&<span style={{color:'white',fontSize:'10px',fontWeight:'700'}}>✓</span>}
                  </div>
                  <span style={{fontSize:'13px',color:NAVY}}>{m.fullName}</span>
                </div>
              })}
            </div>
            <p style={{fontSize:'11px',color:'#94A3B8',margin:'4px 0 0'}}>{form.memberIds.length} selected · Contribution amount calculated after adding grocery items</p>
          </div>

          <div style={{marginBottom:'14px'}}>
            <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Notes</label>
            <textarea value={form.notes} onChange={e=>set('notes')(e.target.value)} rows={2} placeholder="Any additional notes..."
              style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box',resize:'vertical'}}/>
          </div>

          {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'8px',padding:'10px',color:'#991B1B',fontSize:'12px',marginBottom:'12px'}}>❌ {error}</div>}
          <div style={{display:'flex',gap:'10px'}}>
            <button type="button" onClick={onClose} style={{flex:1,padding:'10px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
            <button type="submit" disabled={saving} style={{flex:2,padding:'10px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`,color:'white'}}>
              {saving?'⏳ Creating...':'🛒 Create Grocery Club'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Item Form Modal ───────────────────────────────────────────
function ItemModal({ clubId, item, memberCount, onClose, onSuccess }: any) {
  const editing = !!item
  const [form, setForm] = useState({
    name:               item?.name || '',
    description:        item?.description || '',
    unit:               item?.unit || 'units',
    qtyPerMember:       item?.qtyPerMember?.toString() || '1',
    estimatedUnitPrice: item?.estimatedUnitPrice?.toString() || '',
    supplierName:       item?.supplierName || '',
    supplierContact:    item?.supplierContact || '',
    notes:              item?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k:string) => (v:string) => setForm(p=>({...p,[k]:v}))

  const totalQty  = parseFloat(form.qtyPerMember||'0') * memberCount
  const estTotal  = parseFloat(form.estimatedUnitPrice||'0') * totalQty

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const action = editing ? 'UPDATE_ITEM' : 'ADD_ITEM'
      const res    = await fetch('/api/grocery', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action, clubId, itemId:item?.id, ...form,
          qtyPerMember:parseFloat(form.qtyPerMember), estimatedUnitPrice:parseFloat(form.estimatedUnitPrice) }) })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error||'Failed')
    } catch { setError('Network error') } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1010,padding:'20px'}}>
      <div style={{background:'white',borderRadius:'14px',width:'100%',maxWidth:'480px',boxShadow:'0 25px 50px rgba(0,0,0,0.25)',overflow:'hidden'}}>
        <div style={{background:NAVY,padding:'16px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h3 style={{fontSize:'15px',fontWeight:'700',color:'white',margin:0}}>{editing?'✏️ Edit':'+ Add'} Grocery Item</h3>
          <button onClick={onClose} style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'6px',width:'28px',height:'28px',cursor:'pointer',fontSize:'16px',color:'white'}}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{padding:'18px 20px'}}>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:'10px',marginBottom:'10px'}}>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Item Name *</label>
              <input type="text" value={form.name} onChange={e=>set('name')(e.target.value)} required placeholder="e.g. Rice 5kg"
                style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Unit</label>
              <select value={form.unit} onChange={e=>set('unit')(e.target.value)}
                style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box'}}>
                {['units','kg','g','litres','ml','bags','boxes','cans','packs','bottles','dozen'].map(u=><option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px',marginBottom:'10px'}}>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Qty / Member *</label>
              <input type="number" step="0.5" min="0.5" value={form.qtyPerMember} onChange={e=>set('qtyPerMember')(e.target.value)} required
                style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Total Qty</label>
              <div style={{padding:'8px 10px',background:'#F8FAFC',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',color:'#64748B'}}>{totalQty} {form.unit}</div>
            </div>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Unit Price ($) *</label>
              <input type="number" step="0.01" min="0" value={form.estimatedUnitPrice} onChange={e=>set('estimatedUnitPrice')(e.target.value)} required placeholder="0.00"
                style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',fontWeight:'600',outline:'none',boxSizing:'border-box'}}/>
            </div>
          </div>

          {estTotal > 0 && <div style={{background:'#F0FDF4',borderRadius:'8px',padding:'8px 12px',marginBottom:'10px',display:'flex',justifyContent:'space-between',fontSize:'12px'}}>
            <span style={{color:'#64748B'}}>Estimated total for {memberCount} members:</span>
            <strong style={{color:TEAL}}>${fmt(estTotal)}</strong>
          </div>}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'10px'}}>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Supplier Name</label>
              <input type="text" value={form.supplierName} onChange={e=>set('supplierName')(e.target.value)} placeholder="e.g. FoodCorp Wholesale"
                style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Supplier Contact</label>
              <input type="text" value={form.supplierContact} onChange={e=>set('supplierContact')(e.target.value)} placeholder="+263 77..."
                style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
            </div>
          </div>

          <div style={{marginBottom:'14px'}}>
            <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Notes</label>
            <input type="text" value={form.notes} onChange={e=>set('notes')(e.target.value)} placeholder="Brand preference, quality notes..."
              style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
          </div>

          {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'7px',padding:'8px 10px',color:'#991B1B',fontSize:'12px',marginBottom:'10px'}}>❌ {error}</div>}
          <div style={{display:'flex',gap:'8px'}}>
            <button type="button" onClick={onClose} style={{flex:1,padding:'9px',background:'#F1F5F9',border:'none',borderRadius:'7px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
            <button type="submit" disabled={saving} style={{flex:2,padding:'9px',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:saving?'not-allowed':'pointer',background:saving?'#94A3B8':TEAL,color:'white'}}>
              {saving?'⏳ Saving...':(editing?'✓ Update Item':'+ Add to List')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Purchase Modal ────────────────────────────────────────────
function PurchaseModal({ item, members, clubId, onClose, onSuccess }: any) {
  const [form, setForm] = useState({
    actualUnitPrice:  item.estimatedUnitPrice?.toString() || '',
    purchasedById:    item.assignedToId || '',
    receiptUrl:       '',
    notes:            '',
  })
  const [saving, setSaving] = useState(false)

  const actualTotal = parseFloat(form.actualUnitPrice||'0') * item.totalQty

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const buyer = members.find((m:any)=>m.userId===form.purchasedById)
    const res   = await fetch('/api/grocery', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'MARK_PURCHASED', itemId:item.id, clubId,
        actualUnitPrice: parseFloat(form.actualUnitPrice),
        actualTotalPrice: actualTotal,
        purchasedById: form.purchasedById || null,
        purchasedByName: buyer?.fullName || null,
        receiptUrl: form.receiptUrl || null,
        notes: form.notes || null,
      }) })
    const data = await res.json()
    if (data.success) { onSuccess(data.message); onClose() }
    setSaving(false)
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1020,padding:'20px'}}>
      <div style={{background:'white',borderRadius:'14px',width:'100%',maxWidth:'420px',boxShadow:'0 20px 40px rgba(0,0,0,0.25)',overflow:'hidden'}}>
        <div style={{background:GREEN,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h3 style={{fontSize:'14px',fontWeight:'700',color:'white',margin:0}}>✅ Mark as Purchased — {item.name}</h3>
          <button onClick={onClose} style={{background:'rgba(255,255,255,0.2)',border:'none',borderRadius:'5px',width:'26px',height:'26px',cursor:'pointer',fontSize:'15px',color:'white'}}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{padding:'16px 18px'}}>
          <div style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px',marginBottom:'12px',fontSize:'12px',color:'#64748B',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
            <span>Total qty: <strong>{item.totalQty} {item.unit}</strong></span>
            <span>Est. price: <strong>${fmt(item.estimatedTotalPrice)}</strong></span>
          </div>
          <div style={{marginBottom:'10px'}}>
            <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Actual Unit Price ($) *</label>
            <input type="number" step="0.01" min="0" value={form.actualUnitPrice} onChange={e=>setForm(f=>({...f,actualUnitPrice:e.target.value}))} required
              style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'14px',fontWeight:'600',outline:'none',boxSizing:'border-box'}}/>
            {actualTotal>0&&<p style={{fontSize:'11px',color:TEAL,margin:'3px 0 0'}}>Total: ${fmt(actualTotal)} {item.estimatedTotalPrice>0&&`(${actualTotal>item.estimatedTotalPrice?'+':''} ${fmt(actualTotal-item.estimatedTotalPrice)} vs estimate)`}</p>}
          </div>
          <div style={{marginBottom:'10px'}}>
            <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Purchased By</label>
            <select value={form.purchasedById} onChange={e=>setForm(f=>({...f,purchasedById:e.target.value}))}
              style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',background:'white',boxSizing:'border-box'}}>
              <option value="">Select member...</option>
              {members.map((m:any)=><option key={m.userId} value={m.userId}>{m.fullName}</option>)}
            </select>
          </div>
          <div style={{marginBottom:'10px'}}>
            <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Receipt / Notes</label>
            <input type="text" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Receipt reference or notes..."
              style={{width:'100%',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
          </div>
          <div style={{display:'flex',gap:'8px'}}>
            <button type="button" onClick={onClose} style={{flex:1,padding:'9px',background:'#F1F5F9',border:'none',borderRadius:'7px',fontSize:'12px',cursor:'pointer'}}>Cancel</button>
            <button type="submit" disabled={saving} style={{flex:2,padding:'9px',background:saving?'#94A3B8':GREEN,color:'white',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
              {saving?'⏳ Saving...':'✅ Confirm Purchase'}
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
  const [tab, setTab]     = useState<'dashboard'|'items'|'members'|'contributions'|'settings'>('dashboard')
  const [showItemModal, setShowItemModal] = useState(false)
  const [editItem, setEditItem]           = useState<any>(null)
  const [purchaseItem, setPurchaseItem]   = useState<any>(null)
  const [saving, setSaving]               = useState(false)
  const [search, setSearch]               = useState('')

  const fetchClub = useCallback(async () => {
    const res  = await fetch(`/api/grocery?clubId=${clubId}`)
    const data = await res.json()
    if (data.success) setClub(data.data)
    setLoading(false)
  }, [clubId])

  useEffect(()=>{ fetchClub() },[fetchClub])

  async function doAction(action: string, payload: any = {}) {
    setSaving(true)
    try {
      const res  = await fetch('/api/grocery', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action, clubId, ...payload }) })
      const data = await res.json()
      if (data.success) { onAction(data.message); fetchClub() }
      else onAction(data.error||'Failed','error')
    } catch { onAction('Network error','error') } finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
      <div style={{background:'white',borderRadius:'16px',padding:'40px',textAlign:'center'}}><div style={{fontSize:'32px',marginBottom:'12px'}}>⏳</div>Loading...</div>
    </div>
  )
  if (!club) return null

  const sm        = STATUS_META[club.status] || STATUS_META.SETUP
  const members   = club.members || []
  const items     = club.items   || []
  const contribs  = club.contributions || []
  const nonMembers = groupMembers.filter((m:any) => !members.find((cm:any)=>cm.userId===(m.userId||m.id)))

  // Group contribs by period
  const byPeriod: Record<number,any[]> = {}
  contribs.filter((c:any) => !search || c.memberName?.toLowerCase().includes(search.toLowerCase()))
    .forEach((c:any) => { if (!byPeriod[c.periodNumber]) byPeriod[c.periodNumber]=[]; byPeriod[c.periodNumber].push(c) })

  const now = new Date()
  const canActivate = club.status==='SETUP' && members.length>0 && items.length>0

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'16px'}}>
      <div style={{background:'white',borderRadius:'16px',width:'100%',maxWidth:'820px',maxHeight:'95vh',display:'flex',flexDirection:'column',boxShadow:'0 25px 60px rgba(0,0,0,0.3)',overflow:'hidden'}}>
        {showItemModal&&<ItemModal clubId={clubId} item={editItem} memberCount={members.length||1}
          onClose={()=>{ setShowItemModal(false); setEditItem(null) }}
          onSuccess={(msg:string)=>{ onAction(msg); fetchClub() }}/>}
        {purchaseItem&&<PurchaseModal item={purchaseItem} members={members} clubId={clubId}
          onClose={()=>setPurchaseItem(null)}
          onSuccess={(msg:string)=>{ onAction(msg); fetchClub(); setPurchaseItem(null) }}/>}

        {/* Header */}
        <div style={{background:`linear-gradient(135deg,${NAVY},#1A4A2E)`,padding:'20px 24px',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:'12px'}}>
            <div style={{width:'44px',height:'44px',borderRadius:'10px',background:'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',flexShrink:0}}>🛒</div>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'2px'}}>
                <span style={{fontSize:'16px',fontWeight:'700',color:'white'}}>{club.name}</span>
                <Pill bg={sm.bg} color={sm.color}>{sm.icon} {sm.label}</Pill>
              </div>
              <div style={{fontSize:'12px',color:'rgba(255,255,255,0.6)'}}>
                {FREQ[club.contributionFrequency]} · {club.periodMonths} months · {members.length} members
                {club.coordinatorName&&<span style={{marginLeft:'8px'}}>· 👤 {club.coordinatorName}</span>}
              </div>
            </div>
            <button onClick={onClose} style={{width:'32px',height:'32px',background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'18px',color:'white'}}>×</button>
          </div>

          {/* KPI strip */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px',marginTop:'14px',paddingTop:'12px',borderTop:'1px solid rgba(255,255,255,0.1)'}}>
            {[
              {l:'Total Budget',  v:`$${fmt(club.totalBudget)}`,      c:'white'},
              {l:'Collected',     v:`$${fmt(club.totalContributed)}`,  c:'#9FE1CB'},
              {l:'Spent',         v:`$${fmt(club.totalSpent)}`,        c:'#FCD34D'},
              {l:'Remaining',     v:`$${fmt(club.remainingBudget)}`,   c:club.remainingBudget>=0?'#9FE1CB':'#FCA5A5'},
              {l:'Items',         v:`${items.filter((i:any)=>i.status==='PURCHASED').length}/${items.length}`,  c:'white'},
            ].map(s=><div key={s.l}>
              <div style={{fontSize:'9px',color:'rgba(255,255,255,0.5)',textTransform:'uppercase',letterSpacing:'0.04em'}}>{s.l}</div>
              <div style={{fontSize:'15px',fontWeight:'700',color:s.c,marginTop:'2px'}}>{s.v}</div>
            </div>)}
          </div>

          {/* Budget progress */}
          {club.totalBudget > 0 && <div style={{marginTop:'10px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
            <div>
              <div style={{fontSize:'10px',color:'rgba(255,255,255,0.5)',marginBottom:'3px'}}>Contributions: {club.fundingPct}% funded</div>
              <div style={{height:'5px',background:'rgba(255,255,255,0.15)',borderRadius:'3px',overflow:'hidden'}}>
                <div style={{height:'100%',background:'rgba(159,225,203,0.8)',borderRadius:'3px',width:`${club.fundingPct}%`}}/>
              </div>
            </div>
            <div>
              <div style={{fontSize:'10px',color:'rgba(255,255,255,0.5)',marginBottom:'3px'}}>Purchases: {club.spentPct}% spent</div>
              <div style={{height:'5px',background:'rgba(255,255,255,0.15)',borderRadius:'3px',overflow:'hidden'}}>
                <div style={{height:'100%',background:'rgba(252,211,77,0.8)',borderRadius:'3px',width:`${club.spentPct}%`}}/>
              </div>
            </div>
          </div>}

          {/* Action buttons */}
          <div style={{display:'flex',gap:'8px',marginTop:'12px',flexWrap:'wrap'}}>
            {canActivate&&<button onClick={()=>doAction('ACTIVATE')} disabled={saving}
              style={{padding:'6px 14px',background:TEAL,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>▶️ Activate Club</button>}
            {club.status==='ACTIVE'&&<button onClick={()=>setTab('items')}
              style={{padding:'6px 14px',background:'rgba(255,255,255,0.15)',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>🛒 Manage Items</button>}
            {['PURCHASING','ACTIVE'].includes(club.status)&&<button onClick={()=>doAction('MARK_DISTRIBUTED')} disabled={saving}
              style={{padding:'6px 14px',background:'rgba(255,255,255,0.15)',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>📦 Mark All Distributed</button>}
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',borderBottom:'1px solid #E2E8F0',flexShrink:0,overflowX:'auto'}}>
          {[['dashboard','📊 Dashboard'],['items','🛒 Grocery List'],['members','👥 Members'],['contributions','💸 Contributions'],['settings','⚙️ Settings']].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id as any)}
              style={{padding:'10px 16px',background:'none',border:'none',borderBottom:tab===id?`2px solid ${TEAL}`:'2px solid transparent',color:tab===id?TEAL:'#64748B',fontWeight:tab===id?'600':'400',fontSize:'13px',cursor:'pointer',marginBottom:'-1px',whiteSpace:'nowrap'}}>{label}</button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{flex:1,overflowY:'auto',padding:'16px 20px'}}>

          {/* DASHBOARD */}
          {tab==='dashboard'&&<div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
            {club.status==='SETUP'&&<div style={{background:'#EEF2FF',borderRadius:'12px',padding:'16px',border:'1px solid #C7D2FE'}}>
              <div style={{fontSize:'13px',fontWeight:'600',color:'#3730A3',marginBottom:'10px'}}>📋 Setup Checklist</div>
              {[[members.length>0,`Members enrolled (${members.length})`],[items.length>0,`Grocery items added (${items.length})`],[club.coordinatorId,'Coordinator assigned']].map(([done,label],i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:done?GREEN:'#64748B',marginBottom:'5px'}}>
                  <span>{done?'✅':'⬜'}</span><span>{label as string}</span>
                </div>
              ))}
              {canActivate&&<button onClick={()=>doAction('ACTIVATE')} disabled={saving}
                style={{marginTop:'8px',padding:'8px 18px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>▶️ Activate Now</button>}
              {!canActivate&&<p style={{fontSize:'12px',color:'#64748B',margin:'8px 0 0'}}>Add at least one member and one grocery item to activate.</p>}
            </div>}

            {/* Item status summary */}
            {items.length>0&&<div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px'}}>
              <div style={{fontSize:'13px',fontWeight:'600',color:NAVY,marginBottom:'12px'}}>🛒 Grocery List Summary</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px',marginBottom:'12px'}}>
                {['PENDING','ASSIGNED','PURCHASED','DISTRIBUTED'].map(s=>{
                  const cnt = items.filter((i:any)=>i.status===s).length
                  const sm2 = ITEM_STATUS[s]
                  return <div key={s} style={{background:sm2.bg,borderRadius:'8px',padding:'10px',textAlign:'center'}}>
                    <div style={{fontSize:'18px',marginBottom:'4px'}}>{sm2.icon}</div>
                    <div style={{fontSize:'18px',fontWeight:'700',color:sm2.color}}>{cnt}</div>
                    <div style={{fontSize:'10px',color:sm2.color}}>{sm2.label}</div>
                  </div>
                })}
              </div>
              {/* Top 3 pending items */}
              {items.filter((i:any)=>i.status==='PENDING').slice(0,3).map((i:any)=>(
                <div key={i.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',borderTop:'1px solid #F1F5F9'}}>
                  <span style={{fontSize:'20px'}}>🧺</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:'13px',fontWeight:'500',color:NAVY}}>{i.name}</div>
                    <div style={{fontSize:'11px',color:'#94A3B8'}}>{i.totalQty} {i.unit} · ${fmt(i.estimatedTotalPrice)}</div>
                  </div>
                  <button onClick={()=>{ setEditItem(i); setShowItemModal(true) }} style={{padding:'4px 10px',background:'#EEF2FF',color:PURPLE,border:'none',borderRadius:'5px',fontSize:'11px',cursor:'pointer'}}>Assign →</button>
                </div>
              ))}
            </div>}

            {/* Club info */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              {[['Start Date',new Date(club.startDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})],
                ['End Date',new Date(club.endDate).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})],
                ['Frequency',FREQ[club.contributionFrequency]],
                ['Contribution/Member',`$${fmt(club.contributionAmount)}`],
                ['Coordinator',club.coordinatorName||'—'],
                ['Days Left',`${club.daysLeft} days`],
              ].map(([l,v])=><div key={l} style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px'}}>
                <div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'3px'}}>{l}</div>
                <div style={{fontSize:'13px',fontWeight:'500',color:NAVY}}>{v}</div>
              </div>)}
            </div>
          </div>}

          {/* GROCERY LIST */}
          {tab==='items'&&<div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}}>
              <div>
                <span style={{fontSize:'13px',fontWeight:'600',color:NAVY}}>{items.length} items</span>
                <span style={{fontSize:'12px',color:'#64748B',marginLeft:'8px'}}>· Total budget: ${fmt(club.totalBudget)} · Spent: ${fmt(club.totalSpent)}</span>
              </div>
              {['SETUP','ACTIVE','PURCHASING'].includes(club.status)&&<button onClick={()=>{ setEditItem(null); setShowItemModal(true) }}
                style={{padding:'7px 14px',background:TEAL,color:'white',border:'none',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>+ Add Item</button>}
            </div>

            {items.length===0?<div style={{textAlign:'center',padding:'48px',color:'#94A3B8'}}>
              <div style={{fontSize:'40px',marginBottom:'10px'}}>🧺</div>
              <p>No items yet. Add grocery items to build your shopping list.</p>
              <button onClick={()=>{ setEditItem(null); setShowItemModal(true) }} style={{padding:'9px 20px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Add First Item</button>
            </div>:(
              <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr style={{background:'#F8FAFC'}}>
                    {['Item','Unit','Qty/Member','Total Qty','Supplier','Est. Price','Actual','Status','Assigned To','Actions'].map(h=>(
                      <th key={h} style={{padding:'9px 10px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',whiteSpace:'nowrap',textTransform:'uppercase'}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {items.map((item:any, idx:number)=>{
                      const sm2 = ITEM_STATUS[item.status]||ITEM_STATUS.PENDING
                      return <tr key={item.id} style={{borderBottom:'1px solid #F8FAFC',background:idx%2===0?'white':'#FAFAFA'}}>
                        <td style={{padding:'9px 10px'}}>
                          <div style={{fontSize:'13px',fontWeight:'600',color:NAVY}}>{item.name}</div>
                          {item.notes&&<div style={{fontSize:'10px',color:'#94A3B8'}}>{item.notes}</div>}
                        </td>
                        <td style={{padding:'9px 10px',fontSize:'12px',color:'#64748B'}}>{item.unit}</td>
                        <td style={{padding:'9px 10px',fontSize:'13px',color:NAVY,fontWeight:'500'}}>{item.qtyPerMember}</td>
                        <td style={{padding:'9px 10px',fontSize:'13px',color:NAVY}}>{item.totalQty}</td>
                        <td style={{padding:'9px 10px',fontSize:'12px',color:'#475569'}}>
                          {item.supplierName||'—'}
                          {item.supplierContact&&<div style={{fontSize:'10px',color:'#94A3B8'}}>{item.supplierContact}</div>}
                        </td>
                        <td style={{padding:'9px 10px',fontSize:'13px',color:NAVY,fontWeight:'500'}}>${fmt(item.estimatedTotalPrice)}</td>
                        <td style={{padding:'9px 10px'}}>
                          {item.actualTotalPrice!=null
                            ? <div>
                                <div style={{fontSize:'13px',fontWeight:'600',color:item.actualTotalPrice>item.estimatedTotalPrice?RED:GREEN}}>${fmt(item.actualTotalPrice)}</div>
                                {item.priceDiff!=null&&<div style={{fontSize:'10px',color:item.priceDiff>0?RED:GREEN}}>{item.priceDiff>0?'+':''}{fmt(item.priceDiff)}</div>}
                              </div>
                            : <span style={{color:'#94A3B8',fontSize:'12px'}}>—</span>}
                        </td>
                        <td style={{padding:'9px 10px'}}>
                          <Pill bg={sm2.bg} color={sm2.color}>{sm2.icon} {sm2.label}</Pill>
                        </td>
                        <td style={{padding:'9px 10px',fontSize:'12px',color:'#475569'}}>{item.assignedToName||'—'}</td>
                        <td style={{padding:'9px 10px'}}>
                          <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
                            {item.status==='PENDING'&&<>
                              <button onClick={()=>{ setEditItem(item); setShowItemModal(true) }}
                                style={{padding:'3px 7px',background:'#EEF2FF',color:PURPLE,border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Edit</button>
                              <button onClick={()=>{ const m=members[0]; if(m) doAction('ASSIGN_ITEM',{itemId:item.id,assignedToId:m.userId,assignedToName:m.fullName}) }}
                                style={{padding:'3px 7px',background:'#FEF9C3',color:GOLD,border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Assign</button>
                            </>}
                            {['PENDING','ASSIGNED'].includes(item.status)&&<button onClick={()=>setPurchaseItem(item)}
                              style={{padding:'3px 7px',background:'#DCFCE7',color:GREEN,border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer',fontWeight:'600'}}>Buy ✓</button>}
                            {item.status==='PURCHASED'&&<button onClick={()=>doAction('MARK_DISTRIBUTED',{itemId:item.id})}
                              style={{padding:'3px 7px',background:'#F0FDF4',color:GREEN,border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>📦 Dist.</button>}
                            {['PENDING','ASSIGNED'].includes(item.status)&&<button onClick={()=>doAction('DELETE_ITEM',{itemId:item.id})}
                              style={{padding:'3px 7px',background:'#FEF2F2',color:RED,border:'1px solid #FECACA',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>✕</button>}
                          </div>
                        </td>
                      </tr>
                    })}
                  </tbody>
                  <tfoot><tr style={{background:'#F8FAFC',borderTop:'2px solid #E2E8F0'}}>
                    <td colSpan={5} style={{padding:'10px',fontSize:'12px',fontWeight:'600',color:NAVY}}>Totals</td>
                    <td style={{padding:'10px',fontSize:'13px',fontWeight:'700',color:NAVY}}>${fmt(items.reduce((s:number,i:any)=>s+i.estimatedTotalPrice,0))}</td>
                    <td style={{padding:'10px',fontSize:'13px',fontWeight:'700',color:TEAL}}>${fmt(items.filter((i:any)=>i.actualTotalPrice!=null).reduce((s:number,i:any)=>s+(i.actualTotalPrice||0),0))}</td>
                    <td colSpan={3}/>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </div>}

          {/* MEMBERS */}
          {tab==='members'&&<div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            {nonMembers.length>0&&club.status!=='CLOSED'&&<div style={{background:'#F0FDF4',borderRadius:'10px',padding:'12px 14px',border:'1px solid #BBF7D0',display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontSize:'12px',color:GREEN,fontWeight:'500'}}>Add member:</span>
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                {nonMembers.map((m:any)=>{
                  const uid = m.userId||m.id
                  return <button key={uid} onClick={()=>doAction('ADD_MEMBER',{userId:uid})}
                    style={{padding:'4px 10px',background:'white',color:NAVY,border:'1px solid #BBF7D0',borderRadius:'5px',fontSize:'12px',cursor:'pointer'}}>+ {m.fullName}</button>
                })}
              </div>
            </div>}

            {members.length===0?<div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}>No members yet.</div>:(
              <table style={{width:'100%',borderCollapse:'collapse',background:'white',borderRadius:'10px',overflow:'hidden',border:'1px solid #E2E8F0'}}>
                <thead><tr style={{background:'#F8FAFC'}}>
                  {['Member','Contributed','Share %','Status','Actions'].map(h=>(
                    <th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {members.map((m:any,i:number)=>(
                    <tr key={m.userId} style={{borderBottom:'1px solid #F8FAFC',background:i%2===0?'white':'#FAFAFA'}}>
                      <td style={{padding:'10px 12px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                          <div style={{width:'30px',height:'30px',borderRadius:'50%',background:'#E1F5EE',color:TEAL,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700'}}>
                            {(m.fullName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                          </div>
                          <div>
                            <div style={{fontSize:'13px',fontWeight:'500',color:NAVY}}>{m.fullName}</div>
                            {m.userId===club.coordinatorId&&<div style={{fontSize:'10px',color:TEAL,fontWeight:'600'}}>👤 Coordinator</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'600',color:TEAL}}>${fmt(m.totalContributed)}</td>
                      <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'700',color:PURPLE}}>{Number(m.sharePercentage).toFixed(1)}%</td>
                      <td style={{padding:'10px 12px'}}><Pill bg="#DCFCE7" color={GREEN}>Active</Pill></td>
                      <td style={{padding:'10px 12px'}}>
                        <button onClick={()=>doAction('REMOVE_MEMBER',{userId:m.userId})}
                          style={{padding:'3px 8px',background:'#FEF2F2',color:RED,border:'1px solid #FECACA',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>}

          {/* CONTRIBUTIONS */}
          {tab==='contributions'&&<div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
              <div style={{display:'flex',gap:'12px',flexWrap:'wrap',fontSize:'12px'}}>
                {[['Total',contribs.length,'#64748B'],['Paid',contribs.filter((c:any)=>c.status==='PAID').length,GREEN],
                  ['Pending',contribs.filter((c:any)=>c.status==='PENDING').length,'#1A5EA8'],
                  ['Overdue',contribs.filter((c:any)=>c.isOverdue).length,RED]].map(([l,v,c])=>(
                  <span key={l as string} style={{color:c as string,fontWeight:'600'}}>{l}: {v}</span>
                ))}
              </div>
              <input placeholder="Search member..." value={search} onChange={e=>setSearch(e.target.value)}
                style={{padding:'6px 12px',border:'1.5px solid #E2E8F0',borderRadius:'6px',fontSize:'12px',outline:'none'}}/>
            </div>

            {Object.keys(byPeriod).length===0?<div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}>
              <div style={{fontSize:'32px',marginBottom:'8px'}}>💸</div>
              <p>{club.status==='SETUP'?'Activate the club to generate the contribution schedule.':'No contributions yet.'}</p>
            </div>:(
              <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                {Object.entries(byPeriod).map(([period, cs]: [string,any])=>{
                  const allPaid = cs.every((c:any)=>c.status==='PAID')
                  const isOver  = cs.some((c:any)=>c.isOverdue)
                  return <div key={period} style={{background:'white',borderRadius:'10px',border:`1px solid ${isOver?'#FECACA':allPaid?'#BBF7D0':'#E2E8F0'}`,overflow:'hidden'}}>
                    <div style={{background:isOver?'#FEF2F2':allPaid?'#F0FDF4':'#F8FAFC',padding:'8px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <span style={{fontSize:'13px',fontWeight:'700',color:NAVY}}>Period #{period}</span>
                        <span style={{fontSize:'12px',color:'#64748B'}}>Due {new Date(cs[0]?.dueDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
                        {isOver&&<span style={{fontSize:'11px',color:RED,fontWeight:'600'}}>⚠️ OVERDUE</span>}
                        {allPaid&&<span style={{fontSize:'11px',color:GREEN,fontWeight:'600'}}>✅ ALL PAID</span>}
                      </div>
                      <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                        <span style={{fontSize:'11px',color:'#64748B'}}>{cs.filter((c:any)=>c.status==='PAID').length}/{cs.length} paid</span>
                        {!allPaid&&club.status==='ACTIVE'&&<button onClick={()=>doAction('MARK_PERIOD_PAID',{periodNumber:parseInt(period)})} disabled={saving}
                          style={{padding:'3px 8px',background:TEAL,color:'white',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer',fontWeight:'600'}}>Mark All Paid</button>}
                      </div>
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                      <tbody>
                        {cs.map((c:any)=>(
                          <tr key={c.id} style={{borderTop:'1px solid #F8FAFC'}}>
                            <td style={{padding:'8px 14px',fontSize:'13px',color:NAVY}}>{c.memberName}</td>
                            <td style={{padding:'8px 14px',fontSize:'13px',fontWeight:'600',color:TEAL}}>${fmt(c.amountDue)}</td>
                            <td style={{padding:'8px 14px'}}>
                              <span style={{background:c.status==='PAID'?'#DCFCE7':c.isOverdue?'#FEE2E2':'#F1F5F9',color:c.status==='PAID'?GREEN:c.isOverdue?RED:'#475569',fontSize:'10px',fontWeight:'600',padding:'2px 7px',borderRadius:'4px'}}>
                                {c.status==='PAID'?'✓ PAID':c.isOverdue?'⚠️ OVERDUE':c.status}
                              </span>
                            </td>
                            <td style={{padding:'8px 14px',fontSize:'11px',color:'#94A3B8'}}>{c.paidAt?new Date(c.paidAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'—'}</td>
                            <td style={{padding:'8px 14px'}}>
                              {c.status!=='PAID'&&club.status==='ACTIVE'&&<>
                                <button onClick={()=>doAction('WAIVE_CONTRIBUTION',{contributionId:c.id})}
                                  style={{marginRight:'4px',padding:'3px 7px',background:'#F1F5F9',color:'#475569',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Waive</button>
                                <button onClick={()=>doAction('PAY_CONTRIBUTION',{contributionId:c.id,amountPaid:c.amountDue,paymentMethod:'BANK_TRANSFER'})}
                                  style={{padding:'3px 7px',background:TEAL,color:'white',border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer',fontWeight:'600'}}>Pay</button>
                              </>}
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

          {/* SETTINGS */}
          {tab==='settings'&&<div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
            <SettingsForm club={club} members={members} onSave={(payload:any)=>doAction('UPDATE_CLUB',payload)} saving={saving}/>
            {['DISTRIBUTED','ACTIVE','PURCHASING'].includes(club.status)&&<div style={{background:'#FEF9C3',borderRadius:'10px',padding:'14px',border:'1px solid #FCD34D'}}>
              <div style={{fontSize:'13px',fontWeight:'600',color:GOLD,marginBottom:'8px'}}>💰 Surplus / Deficit Notes</div>
              <div style={{fontSize:'12px',color:'#475569',marginBottom:'8px'}}>Total budget: ${fmt(club.totalBudget)} · Total spent: ${fmt(club.totalSpent)} · Difference: <strong style={{color:club.totalBudget-club.totalSpent>=0?GREEN:RED}}>{club.totalBudget-club.totalSpent>=0?'+':''}{fmt(club.totalBudget-club.totalSpent)}</strong></div>
              <textarea defaultValue={club.surplusNotes||''} rows={3} placeholder="Record how any surplus or deficit was handled by the coordinator..."
                onChange={e=>{ /* debounce if needed */ }}
                id="surplus-notes"
                style={{width:'100%',padding:'9px 12px',border:'1.5px solid #FCD34D',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box',resize:'vertical',background:'white'}}/>
              <button onClick={()=>{
                const notes = (document.getElementById('surplus-notes') as HTMLTextAreaElement)?.value
                doAction('UPDATE_CLUB',{name:club.name,description:club.description,coordinatorId:club.coordinatorId,surplusNotes:notes,notes:club.notes})
              }} style={{marginTop:'8px',padding:'7px 16px',background:GOLD,color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>Save Notes</button>
            </div>}
            {club.status!=='CLOSED'&&<button onClick={()=>doAction('CLOSE')}
              style={{padding:'10px',background:'#F1F5F9',color:'#475569',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>Close Club</button>}
          </div>}
        </div>
      </div>
    </div>
  )
}

function SettingsForm({ club, members, onSave, saving }: any) {
  const [form, setForm] = useState({ name:club.name, description:club.description||'', coordinatorId:club.coordinatorId||'', notes:club.notes||'' })
  const set = (k:string) => (v:string) => setForm(p=>({...p,[k]:v}))
  return (
    <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px'}}>
      <h4 style={{fontSize:'14px',fontWeight:'600',color:NAVY,margin:'0 0 14px'}}>⚙️ Club Settings</h4>
      <div style={{marginBottom:'12px'}}>
        <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Club Name</label>
        <input type="text" value={form.name} onChange={e=>set('name')(e.target.value)}
          style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
      </div>
      <div style={{marginBottom:'12px'}}>
        <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Coordinator</label>
        <select value={form.coordinatorId} onChange={e=>set('coordinatorId')(e.target.value)}
          style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box'}}>
          <option value="">None</option>
          {members.map((m:any)=><option key={m.userId} value={m.userId}>{m.fullName}</option>)}
        </select>
      </div>
      <div style={{marginBottom:'14px'}}>
        <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Notes</label>
        <textarea value={form.notes} onChange={e=>set('notes')(e.target.value)} rows={2}
          style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box',resize:'vertical'}}/>
      </div>
      <button onClick={()=>onSave({...form, clubId:club.id})} disabled={saving}
        style={{padding:'9px 20px',background:saving?'#94A3B8':TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
        {saving?'⏳ Saving...':'Save Settings'}
      </button>
    </div>
  )
}

// ── Main Grocery Club Panel ───────────────────────────────────
export default function GroceryClubPanel({ groupId, groupMembers }: { groupId: string; groupMembers: any[] }) {
  const [clubs, setClubs]     = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast]     = useState<any>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string|null>(null)

  const showToast = (msg: string, type='success') => setToast({msg,type})

  const fetchClubs = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/grocery?groupId=${groupId}`)
      const data = await res.json()
      if (data.success) setClubs(data.data)
    } catch {} finally { setLoading(false) }
  }, [groupId])

  useEffect(()=>{ fetchClubs() },[fetchClubs])

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
      {toast&&<Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
      {showCreate&&<CreateClubModal groupId={groupId} members={groupMembers}
        onClose={()=>setShowCreate(false)}
        onSuccess={(msg:string)=>{ showToast(msg); fetchClubs() }}/>}
      {selectedId&&<ClubDetail clubId={selectedId} groupMembers={groupMembers}
        onClose={()=>setSelectedId(null)}
        onAction={(msg:string,type='success')=>{ showToast(msg,type); fetchClubs() }}/>}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <h3 style={{fontSize:'16px',fontWeight:'700',color:NAVY,margin:'0 0 2px'}}>🛒 Grocery Clubs</h3>
          <p style={{fontSize:'12px',color:'#64748B',margin:0}}>Pool contributions to buy groceries in bulk at better prices</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button onClick={fetchClubs} style={{padding:'7px 12px',background:'#F1F5F9',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'12px',cursor:'pointer',color:'#475569'}}>↻</button>
          <button onClick={()=>setShowCreate(true)} style={{padding:'8px 16px',background:TEAL,color:'white',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ New Club</button>
        </div>
      </div>

      {loading?<div style={{padding:'40px',textAlign:'center',color:'#94A3B8'}}>⏳ Loading...</div>
      :clubs.length===0?<div style={{background:'white',borderRadius:'12px',border:'1px dashed #E2E8F0',padding:'48px',textAlign:'center'}}>
        <div style={{fontSize:'48px',marginBottom:'12px'}}>🛒</div>
        <h4 style={{fontSize:'15px',fontWeight:'600',color:NAVY,margin:'0 0 8px'}}>No Grocery Clubs yet</h4>
        <p style={{fontSize:'13px',color:'#64748B',marginBottom:'16px'}}>Start a grocery club to pool members' contributions and buy in bulk.</p>
        <button onClick={()=>setShowCreate(true)} style={{padding:'9px 20px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Create First Club</button>
      </div>:(
        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          {clubs.map((c:any)=>{
            const sm2 = STATUS_META[c.status]||STATUS_META.SETUP
            return (
              <div key={c.id} onClick={()=>setSelectedId(c.id)}
                style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px 20px',cursor:'pointer',display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap',transition:'all 0.15s'}}
                onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.boxShadow='0 4px 16px rgba(0,0,0,0.08)'}}
                onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.boxShadow='none'}}>
                <div style={{width:'42px',height:'42px',borderRadius:'10px',background:`linear-gradient(135deg,${NAVY},#1A4A2E)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',flexShrink:0}}>🛒</div>
                <div style={{flex:1,minWidth:'200px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'2px'}}>
                    <span style={{fontSize:'14px',fontWeight:'700',color:NAVY}}>{c.name}</span>
                    <Pill bg={sm2.bg} color={sm2.color}>{sm2.icon} {sm2.label}</Pill>
                  </div>
                  <div style={{fontSize:'12px',color:'#64748B'}}>
                    {FREQ[c.contributionFrequency]} · {c.periodMonths}mo · {c.memberCount} members · {c.purchasedCount}/{c.itemCount} items purchased
                    {c.coordinatorName&&<span style={{marginLeft:'6px'}}>· 👤 {c.coordinatorName}</span>}
                  </div>
                </div>
                <div style={{display:'flex',gap:'16px',flexWrap:'wrap',flexShrink:0}}>
                  {[{l:'Budget',v:`$${c.totalBudget>0?fmt(c.totalBudget):'TBD'}`},{l:'Collected',v:`$${fmt(c.totalContributed)}`},{l:'Spent',v:`$${fmt(c.totalSpent)}`}].map(s=>(
                    <div key={s.l} style={{textAlign:'center'}}>
                      <div style={{fontSize:'13px',fontWeight:'700',color:NAVY}}>{s.v}</div>
                      <div style={{fontSize:'10px',color:'#94A3B8'}}>{s.l}</div>
                    </div>
                  ))}
                </div>
                {c.totalBudget>0&&<div style={{flexShrink:0,width:'80px'}}>
                  <div style={{fontSize:'10px',color:'#94A3B8',marginBottom:'3px',textAlign:'right'}}>{c.fundingPct}% funded</div>
                  <div style={{height:'6px',background:'#F1F5F9',borderRadius:'3px',overflow:'hidden'}}>
                    <div style={{height:'100%',background:TEAL,borderRadius:'3px',width:`${c.fundingPct}%`}}/>
                  </div>
                </div>}
                <span style={{fontSize:'18px',color:'#CBD5E1',flexShrink:0}}>→</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
