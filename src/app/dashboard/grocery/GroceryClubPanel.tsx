'use client'
// src/app/dashboard/grocery/GroceryClubPanel.tsx — v1.12
// v1.1: blocking BusyOverlay with elapsed counter for long-running actions.
// v1.2: Assign became a real member picker. The old button hard-coded
//       members[0] — it silently assigned whoever sorted first and did
//       nothing at all when the club had no members.
// v1.3: DISBURSEMENT MODEL. The club holds no pool. An assignment is a
//       member + a quantity + a cash advance; the member buys the goods,
//       keeps them, and the difference between advance and actual spend
//       follows them into the next cycle.
//         - AssignItemModal now captures quantity and advance, and shows
//           how much of the item is still unassigned and how much cash is
//           still uncommitted.
//         - AcquitModal records actual spend and previews the variance and
//           where it lands BEFORE it is committed.
//         - New Assignments tab: who holds what, against how much money.
//         - KPI strip reworded from pool language (Budget/Collected/Spent/
//           Remaining) to the disbursement position.
//       Requires api/grocery route v1.4 and sql/14-grocery-assignments.sql.
// v1.4: CYCLE STAGES + ROLL-CALL + SETTLEMENT. Matches the real meeting flow:
//         day 1    budget, pick items, set the target contribution
//         last day each member ticks that they HAVE their money (roll-call)
//         then     lock the roll-call — the pot is now known
//         then     assign items within the pot
//         then     lock the cycle and solve who pays whom
//       CycleBar drives the stage. RollCallPanel is the last-day screen.
//       SettlementPanel shows each payment with Mark Sent / Confirm Received,
//       and a buyer's funded bar counts ONLY confirmed money — a payer's
//       claim is not cash in the buyer's hand.
//       Requires api/grocery route v1.6.1 and sql/16-grocery-confirmation.sql.
// v1.5: PERIOD PURCHASES tab, sitting between Grocery List and Roll-call.
//       Grocery List is the CATALOGUE (the full hamper). Period Purchases is
//       what the group agrees to buy with this period's money, and that plan
//       sets the contribution members are told to bring.
//       Contributions tab now shows the current and previous cycle only —
//       a club running monthly for two years would otherwise render 24
//       periods x every member on one screen.
// v1.6: Period Purchases rebuilt as a catalogue SELECTION list. v1.5 added
//       items one at a time from a dropdown of whatever was not yet chosen,
//       which read as a dead screen once migration 17's backfill had already
//       seeded every catalogue item into period 1 — there was nothing left
//       in the dropdown to pick. The group now works down the catalogue
//       ticking items on and off with qty and price inline.
// v1.7: NO HORIZONTAL SCROLL. Nine top-level tabs needed ~1180px and
//       scrolled on any 1280 or 1440 laptop. The four cycle stages collapse
//       into one Cycle tab with a stepper, taking the bar to six tabs at
//       ~730px. The bar also wraps rather than scrolling, so it cannot
//       overflow at any width no matter what is added later.
// v1.8: ScheduleForm on the Settings tab. Dates, frequency and duration are
//       editable while the club has not started, and locked with a named
//       reason once it has.
// v1.9: Period Purchases edits locally and saves in ONE request. Every tick
//       previously wrote and then refetched the entire club — two Tokyo round
//       trips per checkbox. Ticking and typing are now instant.
// v1.10: Roll-call batched the same way, and answers can be cleared back to
//       no-answer so a mis-tap in front of the group is undoable.
// v1.11: Grocery List is CRUD + whole-period budget + purchase status only.
//       Supplier and Assigned To leave the catalogue: supplier moves onto the
//       Period Purchases line, assignment reads from the Assignments screen.
// v1.13: RESPONSIVE. The Dashboard surface now has a real phone layout.
//       Below 640px the club detail stops being an 820px centred modal and
//       becomes a full-screen sheet; the 5-across KPI strip (55px per cell on
//       a 380px phone, against figures needing ~75px) becomes a 2-column
//       card grid; the 6 tabs become a 3x2 grid; the 4-across item-status
//       strip becomes 2x2; and the club-info pairs become label/value rows.
//       Nothing is hidden and nothing scrolls sideways — same data, laid out
//       for the width that exists. Every control clears 44px.
// v1.12: Assign removed from the Grocery List entirely. Allocation happens
//       only under the Cycle umbrella, in stage order:
//         Period Purchases -> Roll-call -> Assignments -> Settlement
//       The Assignments screen now STARTS assignments as well as managing
//       them, driven off the period plan rather than the catalogue — so the
//       only things offerable are what the group agreed to buy this period,
//       and only while the cycle is FUNDED.
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

// ── Responsive ────────────────────────────────────────────────
// Declared here rather than imported from the shared mobile hook: this file
// had no mobile dependency and a wrong import path is a failed deploy, not a
// failed render. If the shared hook is wired in later, swap the three call
// sites (ClubDetail, CycleBar, GroceryClubPanel) and delete this.
//
// matchMedia, not a resize listener — resize fires on every keystroke that
// opens the soft keyboard on Android, and each one would re-render the whole
// club detail.
const NARROW_QUERY = '(max-width: 640px)'

function useIsNarrow() {
  // Defaults false so the desktop layout is what server-renders; the effect
  // corrects it before paint on a phone.
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(NARROW_QUERY)
    const apply = () => setNarrow(mq.matches)
    apply()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
    const legacy = mq as any            // iOS Safari 13 and older
    legacy.addListener(apply)
    return () => legacy.removeListener(apply)
  }, [])
  return narrow
}

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

// ── Busy Overlay ──────────────────────────────────────────────
// Module-level (never defined inside a render) so it is not remounted on every
// parent re-render. Shows a real elapsed counter rather than a fake progress
// bar — the client cannot observe server-side stages of a single request.
function BusyOverlay({ label, detail }: { label: string; detail?: string }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(13,33,55,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000,padding:'16px'}}>
      <style>{`@keyframes wfSpin{to{transform:rotate(360deg)}}`}</style>
      <div style={{background:'white',borderRadius:'16px',padding:'28px 32px',minWidth:'260px',maxWidth:'380px',textAlign:'center',boxShadow:'0 25px 60px rgba(0,0,0,0.3)'}}>
        <div style={{width:'34px',height:'34px',margin:'0 auto 14px',border:`3px solid #E2E8F0`,borderTopColor:TEAL,borderRadius:'50%',animation:'wfSpin 0.8s linear infinite'}}/>
        <div style={{fontSize:'14px',fontWeight:'600',color:NAVY,marginBottom:'6px'}}>{label}</div>
        {detail&&<div style={{fontSize:'12px',color:'#64748B',marginBottom:'6px'}}>{detail}</div>}
        <div style={{fontSize:'11px',color:'#94A3B8'}}>
          {elapsed < 3 ? 'Please wait…' : `${elapsed}s elapsed — please keep this window open.`}
        </div>
      </div>
    </div>
  )
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
      <div style={{background:'white',borderRadius:'14px',width:'100%',maxWidth:'640px',maxHeight:'92vh',overflowY:'auto',boxShadow:'0 25px 50px rgba(0,0,0,0.25)'}}>
        <div style={{background:NAVY,padding:'16px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h3 style={{fontSize:'15px',fontWeight:'700',color:'white',margin:0}}>{editing?'✏️ Edit':'+ Add'} Grocery Item</h3>
          <button onClick={onClose} style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'6px',width:'28px',height:'28px',cursor:'pointer',fontSize:'16px',color:'white'}}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{padding:'18px 20px'}}>
          <div style={{display:'grid',gridTemplateColumns:'3fr 1fr',gap:'12px',marginBottom:'12px'}}>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Item Name *</label>
              <input type="text" value={form.name} onChange={e=>set('name')(e.target.value)} required placeholder="e.g. Rice 5kg"
                style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Unit</label>
              <select value={form.unit} onChange={e=>set('unit')(e.target.value)}
                style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box'}}>
                {['units','kg','g','litres','ml','bags','boxes','cans','packs','bottles','dozen'].map(u=><option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Qty / Member *</label>
              <input type="number" step="0.5" min="0.5" value={form.qtyPerMember} onChange={e=>set('qtyPerMember')(e.target.value)} required
                style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Total Qty</label>
              <div style={{padding:'10px 12px',background:'#F8FAFC',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',color:'#64748B'}}>{totalQty} {form.unit}</div>
            </div>
            <div>
              <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Unit Price ($) *</label>
              <input type="number" step="0.01" min="0" value={form.estimatedUnitPrice} onChange={e=>set('estimatedUnitPrice')(e.target.value)} required placeholder="0.00"
                style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',fontWeight:'600',outline:'none',boxSizing:'border-box'}}/>
            </div>
          </div>

          {estTotal > 0 && <div style={{background:'#F0FDF4',borderRadius:'8px',padding:'8px 12px',marginBottom:'10px',display:'flex',justifyContent:'space-between',fontSize:'12px'}}>
            <span style={{color:'#64748B'}}>Estimated total for {memberCount} members:</span>
            <strong style={{color:TEAL}}>${fmt(estTotal)}</strong>
          </div>}

          {/* Supplier moved to Period Purchases in v1.11 — which supplier the
              group uses changes cycle to cycle, so pinning it to the catalogue
              restated history every time they switched. */}

          <div style={{marginBottom:'14px'}}>
            <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Notes</label>
            <input type="text" value={form.notes} onChange={e=>set('notes')(e.target.value)} placeholder="Brand preference, quality notes..."
              style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
          </div>

          {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'7px',padding:'10px 12px',color:'#991B1B',fontSize:'12px',marginBottom:'10px'}}>❌ {error}</div>}
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

// ── Assign Item Modal ─────────────────────────────────────────
// Module-level (never defined inside a render) so typing does not lose
// cursor focus. An assignment is a member + a quantity + the cash they are
// handed to buy it. Only club members are offered; the server re-checks
// membership, the remaining quantity and the uncommitted cash ceiling.
function AssignItemModal({ item, members, clubId, available, existing, periodNumber, suppliers, onClose, onSuccess, onError }: any) {
  const mine       = existing || null
  const remaining  = Number(item.qtyUnassigned ?? item.totalQty) + Number(mine?.qtyAssigned || 0)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<string>(mine?.userId || '')
  const [qty, setQty]       = useState<string>(String(mine?.qtyAssigned || remaining || ''))
  const [advance, setAdv]   = useState<string>(String(mine?.advanceAmount || ''))
  const [touched, setTouched] = useState(!!mine)
  const [saving, setSaving] = useState(false)
  const [mode, setMode]     = useState<string>(mine?.fundingMode || 'MEMBER_CASH')
  const [supplier, setSup]  = useState<string>(mine?.supplierAccountId || '')

  const qtyNum = parseFloat(qty || '0')
  const advNum = parseFloat(advance || '0')
  // Suggest the advance from the estimate until the admin types their own.
  const suggested = Number((qtyNum * Number(item.estimatedUnitPrice || 0)).toFixed(2))
  const effAdv    = touched ? advNum : suggested
  const headroom  = Number(available || 0) + Number(mine?.advanceAmount || 0)

  const term    = search.trim().toLowerCase()
  const visible = term
    ? members.filter((m: any) =>
        (m.fullName || '').toLowerCase().includes(term) ||
        (m.email    || '').toLowerCase().includes(term))
    : members

  const qtyBad  = !(qtyNum > 0) || qtyNum > remaining + 0.0001
  const advBad  = !(effAdv >= 0) || effAdv > headroom + 0.0001
  const supBad  = mode==='SUPPLIER_DIRECT' && !supplier
  const blocked = saving || !picked || qtyBad || advBad || supBad

  async function submit() {
    setSaving(true)
    try {
      const res = await fetch('/api/grocery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action:'ASSIGN_ITEM', clubId, itemId:item.id,
          assignedToId: picked, qtyAssigned: qtyNum, advanceAmount: effAdv,
          periodNumber: periodNumber || 1, fundingMode: mode,
          supplierAccountId: mode==='SUPPLIER_DIRECT' ? supplier : null }),
      })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else { onError(data.error || 'Could not assign this item'); setSaving(false) }
    } catch { onError('Network error'); setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1030,padding:'20px'}}>
      <div style={{background:'white',borderRadius:'14px',width:'100%',maxWidth:'460px',maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 25px 50px rgba(0,0,0,0.25)',overflow:'hidden'}}>

        <div style={{background:PURPLE,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
          <div>
            <h3 style={{fontSize:'14px',fontWeight:'700',color:'white',margin:'0 0 2px'}}>👤 Assign — {item.name}</h3>
            <p style={{fontSize:'11px',color:'rgba(255,255,255,0.7)',margin:0}}>Who buys it, how much of it, and with how much cash</p>
          </div>
          <button onClick={onClose} style={{background:'rgba(255,255,255,0.2)',border:'none',borderRadius:'6px',width:'28px',height:'28px',minWidth:'28px',cursor:'pointer',fontSize:'16px',color:'white'}}>×</button>
        </div>

        <div style={{flex:1,overflowY:'auto',padding:'14px 18px'}}>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'12px'}}>
            <div style={{background:'#F8FAFC',borderRadius:'8px',padding:'8px 10px'}}>
              <div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase'}}>Unassigned</div>
              <div style={{fontSize:'13px',fontWeight:'600',color:NAVY}}>{remaining} of {item.totalQty} {item.unit}</div>
            </div>
            <div style={{background:'#F8FAFC',borderRadius:'8px',padding:'8px 10px'}}>
              <div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase'}}>Cash uncommitted</div>
              <div style={{fontSize:'13px',fontWeight:'600',color:headroom>0?TEAL:RED}}>${fmt(headroom)}</div>
            </div>
          </div>

          {members.length === 0
            ? <div style={{textAlign:'center',padding:'24px 12px',color:'#94A3B8'}}>
                <div style={{fontSize:'30px',marginBottom:'8px'}}>👥</div>
                <p style={{fontSize:'13px',margin:'0 0 4px',color:'#475569'}}>This club has no members yet.</p>
                <p style={{fontSize:'11px',margin:0}}>Add members on the Members tab, then assign this item.</p>
              </div>
            : <div>
                <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'5px',textTransform:'uppercase'}}>Responsible member</label>
                {members.length > 3 && <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search members..."
                  style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'16px',outline:'none',boxSizing:'border-box',marginBottom:'8px'}}/>}
                <div style={{display:'flex',flexDirection:'column',gap:'5px',maxHeight:'168px',overflowY:'auto',marginBottom:'12px'}}>
                  {visible.map((m: any) => {
                    const sel = picked === m.userId
                    return (
                      <div key={m.userId} onClick={()=>setPicked(m.userId)}
                        style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 10px',minHeight:'44px',borderRadius:'8px',cursor:'pointer',boxSizing:'border-box',background:sel?'#F5F3FF':'white',border:`1.5px solid ${sel?PURPLE:'#E2E8F0'}`}}>
                        <div style={{width:'18px',height:'18px',borderRadius:'50%',flexShrink:0,border:`2px solid ${sel?PURPLE:'#CBD5E1'}`,background:sel?PURPLE:'white',display:'flex',alignItems:'center',justifyContent:'center'}}>
                          {sel && <span style={{color:'white',fontSize:'10px',fontWeight:'700'}}>✓</span>}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:'13px',fontWeight:'500',color:NAVY}}>{m.fullName}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'10px'}}>
                  <div>
                    <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Quantity ({item.unit})</label>
                    <input type="number" step="0.5" min="0" value={qty} onChange={e=>setQty(e.target.value)}
                      style={{width:'100%',padding:'9px 10px',border:`1.5px solid ${qtyBad?'#FECACA':'#E2E8F0'}`,borderRadius:'8px',fontSize:'16px',outline:'none',boxSizing:'border-box'}}/>
                  </div>
                  <div>
                    <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Cash advance ($)</label>
                    <input type="number" step="0.01" min="0" value={touched?advance:String(suggested||'')}
                      onChange={e=>{ setTouched(true); setAdv(e.target.value) }}
                      style={{width:'100%',padding:'9px 10px',border:`1.5px solid ${advBad?'#FECACA':'#E2E8F0'}`,borderRadius:'8px',fontSize:'16px',fontWeight:'600',outline:'none',boxSizing:'border-box'}}/>
                  </div>
                </div>

                <div style={{marginBottom:'10px'}}>
                  <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>How is it paid for?</label>
                  <div style={{display:'flex',gap:'6px',marginBottom:'6px'}}>
                    {[['MEMBER_CASH','Cash to member'],['SUPPLIER_DIRECT','Straight to supplier']].map(([v,l])=>(
                      <button key={v} type="button" onClick={()=>setMode(v)}
                        style={{flex:1,padding:'9px 6px',minHeight:'44px',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer',border:`1.5px solid ${mode===v?PURPLE:'#E2E8F0'}`,background:mode===v?'#F5F3FF':'white',color:mode===v?PURPLE:'#64748B'}}>{l}</button>
                    ))}
                  </div>
                  {mode==='SUPPLIER_DIRECT'&&(suppliers&&suppliers.length
                    ? <select value={supplier} onChange={e=>setSup(e.target.value)}
                        style={{width:'100%',padding:'9px 10px',border:`1.5px solid ${supBad?'#FECACA':'#E2E8F0'}`,borderRadius:'8px',fontSize:'16px',outline:'none',boxSizing:'border-box',background:'white'}}>
                        <option value="">Choose supplier account...</option>
                        {suppliers.map((x:any)=><option key={x.id} value={x.id}>{x.supplierName}{x.bankName?` — ${x.bankName}`:''}</option>)}
                      </select>
                    : <div style={{fontSize:'11px',color:RED}}>No supplier accounts set up for this club yet.</div>)}
                  {mode==='SUPPLIER_DIRECT'&&<div style={{fontSize:'10px',color:'#94A3B8',marginTop:'4px'}}>Members pay the supplier directly — nobody holds the club's cash.</div>}
                </div>

                {qtyBad && <div style={{fontSize:'11px',color:RED,marginBottom:'6px'}}>Quantity must be above 0 and no more than {remaining} {item.unit}.</div>}
                {advBad && <div style={{fontSize:'11px',color:RED,marginBottom:'6px'}}>Advance cannot exceed the ${fmt(headroom)} still uncommitted — the club holds no float.</div>}
                {!touched && suggested > 0 && <div style={{fontSize:'11px',color:'#94A3B8',marginBottom:'6px'}}>Suggested from the estimate; type to override.</div>}
              </div>}

        </div>

        <div style={{padding:'12px 18px',borderTop:'1px solid #E2E8F0',display:'flex',gap:'8px',flexShrink:0}}>
          <button type="button" onClick={onClose} disabled={saving}
            style={{flex:1,padding:'10px',minHeight:'44px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:saving?'not-allowed':'pointer',color:'#475569'}}>Cancel</button>
          <button type="button" onClick={submit} disabled={blocked}
            style={{flex:2,padding:'10px',minHeight:'44px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',color:'white',background:blocked?'#C4B5FD':PURPLE,cursor:blocked?'not-allowed':'pointer'}}>
            {saving ? '⏳ Saving...' : '✓ Assign'}
          </button>
        </div>

      </div>
    </div>
  )
}

// ── Acquit Modal ──────────────────────────────────────────────
// Records what the member actually spent against what they were given.
// The variance and where it lands are shown BEFORE committing, because
// the write is a ledger entry that can only be corrected by reversal.
function AcquitModal({ assignment, clubId, onClose, onSuccess, onError }: any) {
  const [spent, setSpent]   = useState<string>('')
  const [receipt, setRcpt]  = useState('')
  const [saving, setSaving] = useState(false)

  const advance  = Number(assignment.advanceAmount)
  const spentNum = parseFloat(spent || '')
  const valid    = Number.isFinite(spentNum) && spentNum >= 0
  const variance = valid ? Number((advance - spentNum).toFixed(2)) : null

  async function submit() {
    setSaving(true)
    try {
      const res = await fetch('/api/grocery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action:'ACQUIT_ASSIGNMENT', clubId,
          assignmentId: assignment.id, actualSpent: spentNum,
          receiptUrl: receipt || null }),
      })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else { onError(data.error || 'Could not acquit this assignment'); setSaving(false) }
    } catch { onError('Network error'); setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1040,padding:'20px'}}>
      <div style={{background:'white',borderRadius:'14px',width:'100%',maxWidth:'420px',boxShadow:'0 20px 40px rgba(0,0,0,0.25)',overflow:'hidden'}}>

        <div style={{background:GREEN,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <h3 style={{fontSize:'14px',fontWeight:'700',color:'white',margin:'0 0 2px'}}>🧾 Acquit — {assignment.itemName}</h3>
            <p style={{fontSize:'11px',color:'rgba(255,255,255,0.75)',margin:0}}>{assignment.memberName} · {assignment.qtyAssigned} {assignment.unit}</p>
          </div>
          <button onClick={onClose} style={{background:'rgba(255,255,255,0.2)',border:'none',borderRadius:'6px',width:'28px',height:'28px',minWidth:'28px',cursor:'pointer',fontSize:'16px',color:'white'}}>×</button>
        </div>

        <div style={{padding:'16px 18px'}}>
          <div style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px',marginBottom:'12px',display:'flex',justifyContent:'space-between',fontSize:'12px',color:'#64748B'}}>
            <span>Advance given</span>
            <strong style={{color:NAVY,fontSize:'14px'}}>${fmt(advance)}</strong>
          </div>

          <div style={{marginBottom:'10px'}}>
            <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Actually spent ($) *</label>
            <input type="number" step="0.01" min="0" value={spent} onChange={e=>setSpent(e.target.value)} placeholder="0.00" autoFocus
              style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'16px',fontWeight:'600',outline:'none',boxSizing:'border-box'}}/>
          </div>

          <div style={{marginBottom:'12px'}}>
            <label style={{display:'block',fontSize:'11px',fontWeight:'600',color:'#374151',marginBottom:'4px',textTransform:'uppercase'}}>Receipt reference</label>
            <input type="text" value={receipt} onChange={e=>setRcpt(e.target.value)} placeholder="Optional"
              style={{width:'100%',padding:'9px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'16px',outline:'none',boxSizing:'border-box'}}/>
          </div>

          {variance !== null && <div style={{background:variance===0?'#F1F5F9':variance>0?'#FEF9C3':'#EEF2FF',border:`1px solid ${variance===0?'#E2E8F0':variance>0?'#FCD34D':'#C7D2FE'}`,borderRadius:'8px',padding:'11px 13px',marginBottom:'12px'}}>
            {variance === 0
              ? <div style={{fontSize:'12px',color:'#475569'}}>Advance matched the spend exactly — nothing carries forward.</div>
              : <div>
                  <div style={{fontSize:'13px',fontWeight:'600',color:variance>0?GOLD:'#3730A3',marginBottom:'3px'}}>
                    {variance > 0
                      ? `${assignment.memberName} holds $${fmt(variance)} change`
                      : `Club owes ${assignment.memberName} $${fmt(Math.abs(variance))}`}
                  </div>
                  <div style={{fontSize:'11px',color:'#64748B'}}>
                    Either way it reduces the new cash they bring next cycle by ${fmt(Math.abs(variance))}. Applied to their earliest unpaid period.
                  </div>
                </div>}
          </div>}

          <div style={{display:'flex',gap:'8px'}}>
            <button type="button" onClick={onClose} disabled={saving}
              style={{flex:1,padding:'10px',minHeight:'44px',background:'#F1F5F9',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer',color:'#475569'}}>Cancel</button>
            <button type="button" onClick={submit} disabled={saving || !valid}
              style={{flex:2,padding:'10px',minHeight:'44px',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',color:'white',background:(saving||!valid)?'#94A3B8':GREEN,cursor:(saving||!valid)?'not-allowed':'pointer'}}>
              {saving ? '⏳ Saving...' : '🧾 Record & carry forward'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Assignments ───────────────────────────────────────────────
// Assignment belongs to the CYCLE, not the catalogue. The Grocery List answers
// "what does the hamper cost"; who buys what, in which period, with how much
// cash, is a cycle question and now lives only here:
//     Period Purchases -> Roll-call -> Assignments -> Settlement
//
// Allocation is driven off the PERIOD PLAN rather than the catalogue, so the
// only things offerable are the items the group actually agreed to buy this
// period, with the quantity still unallocated.
function AssignmentsPanel({ plan, assigns, openAssigns, club, cycle, busy,
                            onAssign, onAcquit, onWithdraw }: any) {
  const canAssign   = cycle?.status === 'FUNDED'
  const outstanding = plan.filter((r: any) => Number(r.qtyUnassigned) > 0.0001)
  const covered     = plan.length > 0 && outstanding.length === 0

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
      {!cycle
        ? null
        : ['OPEN','REOPENED'].includes(cycle.status)
          ? <div style={{background:'#FEF9C3',border:'1px solid #FCD34D',borderRadius:'8px',padding:'10px 13px',fontSize:'11px',color:GOLD}}>
              Nothing can be allocated yet. Publish the period plan and close the roll-call first — items are assigned against money members have confirmed they hold.
            </div>
          : !canAssign
            ? <div style={{background:'#F1F5F9',borderRadius:'8px',padding:'10px 13px',fontSize:'11px',color:'#475569'}}>
                Cycle {cycle.periodNumber} is {String(cycle.status).toLowerCase()}. Allocation is closed — reopen the cycle to change who is buying what.
              </div>
            : <div style={{background:'#EEF2FF',border:'1px solid #C7D2FE',borderRadius:'8px',padding:'10px 13px',fontSize:'11px',color:'#3730A3'}}>
                Allocate this period&apos;s purchases to members. Each carries the cash they are handed to buy it, capped by the confirmed pot.
              </div>}

      {canAssign&&<div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
        <div style={{padding:'10px 13px',borderBottom:'1px solid #F1F5F9',fontSize:'11px',fontWeight:'700',color:NAVY,textTransform:'uppercase',letterSpacing:'0.04em'}}>
          Still to allocate
        </div>
        {plan.length===0
          ? <div style={{padding:'22px 13px',textAlign:'center',color:'#94A3B8',fontSize:'12px'}}>
              Nothing was planned for this period. Go back to Period Purchases.
            </div>
          : covered
            ? <div style={{padding:'22px 13px',textAlign:'center',color:GREEN,fontSize:'12px'}}>
                ✓ Every planned item has a buyer. Lock the cycle to solve the settlement.
              </div>
            : <div>
                {outstanding.map((r: any, idx: number) => (
                  <div key={r.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 13px',flexWrap:'wrap',borderTop:idx===0?'none':'1px solid #F1F5F9'}}>
                    <div style={{flex:1,minWidth:'160px'}}>
                      <div style={{fontSize:'13px',fontWeight:'600',color:NAVY}}>{r.itemName}</div>
                      <div style={{fontSize:'11px',color:'#64748B'}}>
                        {r.qtyUnassigned} of {r.qty} {r.unit} unallocated · ${fmt(r.unitPrice)} each
                        {r.supplierName&&<span> · {r.supplierName}</span>}
                      </div>
                    </div>
                    <div style={{fontSize:'13px',fontWeight:'700',color:GOLD}}>${fmt(Number(r.qtyUnassigned)*Number(r.unitPrice))}</div>
                    <button onClick={()=>onAssign(r)} disabled={busy}
                      style={{padding:'8px 14px',minHeight:'44px',background:PURPLE,color:'white',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:busy?'not-allowed':'pointer'}}>
                      👤 Assign
                    </button>
                  </div>
                ))}
              </div>}
      </div>}

      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px'}}>
        {[
          {l:'Advanced out',    v:`$${fmt(club.advancedOut||0)}`,     c:GOLD},
          {l:'Not yet acquitted',v:`$${fmt(club.unacquitted||0)}`,    c:(club.unacquitted||0)>0?RED:GREEN},
          {l:'Cash uncommitted',v:`$${fmt(club.uncommittedCash||0)}`, c:(club.uncommittedCash||0)>=0?TEAL:RED},
        ].map(k=><div key={k.l} style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px'}}>
          <div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em'}}>{k.l}</div>
          <div style={{fontSize:'15px',fontWeight:'700',color:k.c,marginTop:'2px'}}>{k.v}</div>
        </div>)}
      </div>

      <div style={{background:'#EEF2FF',borderRadius:'8px',padding:'9px 12px',fontSize:'11px',color:'#3730A3',border:'1px solid #C7D2FE'}}>
        The club holds no pooled cash. Every advance is money already collected and handed to a member to spend.
      </div>

      {assigns.length===0?<div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}>
        <div style={{fontSize:'32px',marginBottom:'8px'}}>🧾</div>
        <p>No assignments yet. Assign items on the Grocery List tab.</p>
      </div>:(
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#F8FAFC'}}>
              {['Item','Member','Qty','Advance','Spent','Variance','Status','Actions'].map(h=>(
                <th key={h} style={{padding:'9px 10px',textAlign:'left',fontSize:'10px',fontWeight:'600',color:'#64748B',borderBottom:'1px solid #E2E8F0',whiteSpace:'nowrap',textTransform:'uppercase'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {assigns.map((a:any,idx:number)=>{
                const done = a.status==='ACQUITTED'
                return <tr key={a.id} style={{borderBottom:'1px solid #F8FAFC',background:idx%2===0?'white':'#FAFAFA'}}>
                  <td style={{padding:'9px 10px',fontSize:'13px',fontWeight:'600',color:NAVY}}>{a.itemName}</td>
                  <td style={{padding:'9px 10px',fontSize:'12px',color:'#475569'}}>{a.memberName}</td>
                  <td style={{padding:'9px 10px',fontSize:'12px',color:NAVY}}>{a.qtyAssigned} {a.unit}</td>
                  <td style={{padding:'9px 10px',fontSize:'13px',fontWeight:'600',color:NAVY}}>${fmt(a.advanceAmount)}</td>
                  <td style={{padding:'9px 10px',fontSize:'13px',color:done?NAVY:'#94A3B8'}}>{a.actualSpent!=null?`$${fmt(a.actualSpent)}`:'—'}</td>
                  <td style={{padding:'9px 10px'}}>
                    {a.variance==null?<span style={{color:'#94A3B8',fontSize:'12px'}}>—</span>
                     :a.variance===0?<span style={{fontSize:'12px',color:GREEN}}>exact</span>
                     :<div>
                        <div style={{fontSize:'13px',fontWeight:'600',color:a.variance>0?GOLD:'#3730A3'}}>
                          {a.variance>0?'+':'−'}${fmt(Math.abs(a.variance))}
                        </div>
                        <div style={{fontSize:'10px',color:'#94A3B8'}}>{a.variance>0?'holds change':'out of pocket'}</div>
                      </div>}
                  </td>
                  <td style={{padding:'9px 10px'}}>
                    <Pill bg={done?'#DCFCE7':'#FEF9C3'} color={done?GREEN:GOLD}>{done?'✅ Acquitted':'⏳ Open'}</Pill>
                  </td>
                  <td style={{padding:'9px 10px'}}>
                    <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
                      {!done&&<button onClick={()=>onAcquit(a)}
                        style={{padding:'3px 7px',background:'#DCFCE7',color:GREEN,border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer',fontWeight:'600'}}>Acquit</button>}
                      {!done&&<button onClick={()=>onWithdraw(a)}
                        style={{padding:'3px 7px',background:'#FEF2F2',color:RED,border:'1px solid #FECACA',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Withdraw</button>}
                      {done&&a.receiptUrl&&<span style={{fontSize:'10px',color:'#94A3B8'}}>{a.receiptUrl}</span>}
                    </div>
                  </td>
                </tr>
              })}
            </tbody>
            <tfoot><tr style={{background:'#F8FAFC',borderTop:'2px solid #E2E8F0'}}>
              <td colSpan={3} style={{padding:'10px',fontSize:'12px',fontWeight:'600',color:NAVY}}>Totals · {openAssigns.length} open</td>
              <td style={{padding:'10px',fontSize:'13px',fontWeight:'700',color:NAVY}}>${fmt(assigns.reduce((t:number,a:any)=>t+Number(a.advanceAmount||0),0))}</td>
              <td style={{padding:'10px',fontSize:'13px',fontWeight:'700',color:TEAL}}>${fmt(assigns.reduce((t:number,a:any)=>t+Number(a.actualSpent||0),0))}</td>
              <td colSpan={3}/>
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Cycle stage nav ───────────────────────────────────────────
// Period Purchases, Roll-call, Assignments and Settlement are stages of one
// sequence, not peer destinations — each is already gated by cycle status.
// Presenting them as nine top-level tabs both misread the flow and pushed
// the bar past 1180px, which scrolled horizontally on any 1280 or 1440
// laptop. As a stepper they take one slot and show progress for free.
const STAGES: [string, string, string][] = [
  ['periodplan',  '🧺', 'Period Purchases'],
  ['rollcall',    '🙋', 'Roll-call'],
  ['assignments', '🧾', 'Assignments'],
  ['settlement',  '⚡', 'Settlement'],
]

// Which stages the cycle has already passed, derived from its own status so
// the stepper cannot disagree with what the API will actually allow.
function stageProgress(cycle: any) {
  const st = cycle?.status
  return {
    periodplan:  !!cycle?.budgetSetAt,
    rollcall:    !!st && !['OPEN','REOPENED'].includes(st),
    assignments: ['LOCKED','SETTLED','CLOSED'].includes(st),
    settlement:  ['SETTLED','CLOSED'].includes(st),
  } as Record<string, boolean>
}

// Where the group actually is right now — used when the Cycle tab is opened
// so it lands on the stage that needs attention rather than always the first.
function currentStage(cycle: any) {
  const st = cycle?.status
  if (['LOCKED','SETTLED','CLOSED'].includes(st)) return 'settlement'
  if (st === 'FUNDED') return 'assignments'
  if (cycle?.budgetSetAt) return 'rollcall'
  return 'periodplan'
}

function StageNav({ stage, setStage, cycle }: any) {
  const done = stageProgress(cycle)
  return (
    <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginBottom:'12px'}}>
      {STAGES.map(([id, icon, label], i) => {
        const active = stage === id
        const ok     = done[id]
        return (
          <button key={id} onClick={()=>setStage(id)}
            style={{display:'flex',alignItems:'center',gap:'7px',padding:'8px 13px',minHeight:'44px',borderRadius:'8px',cursor:'pointer',fontSize:'12px',fontWeight:active?'700':'500',border:`1.5px solid ${active?TEAL:ok?'#BBF7D0':'#E2E8F0'}`,background:active?'#E1F5EE':ok?'#F6FFFB':'white',color:active?TEAL:ok?GREEN:'#64748B'}}>
            <span style={{width:'20px',height:'20px',minWidth:'20px',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',background:ok?GREEN:active?TEAL:'#E2E8F0',color:ok||active?'white':'#94A3B8'}}>
              {ok?'✓':i+1}
            </span>
            <span>{icon} {label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Period Purchases ──────────────────────────────────────────
// Everything is edited locally and saved in ONE request. The previous
// version wrote on every tick and then refetched the whole club, so each
// checkbox cost two round trips to Tokyo and a twenty-item list meant forty.
// Ticking and typing are now instant; the network is touched once, when the
// admin presses Save.
function PeriodPurchasePanel({ plan, items, cycle, members, busy, onSavePlan, onSetBudget }: any) {
  // Server truth, keyed by item, used both to seed the draft and to work out
  // what has actually changed.
  const serverRows = () => {
    const by: Record<string, { on: boolean; qty: string; price: string; supplier: string; contact: string }> = {}
    for (const i of items) {
      const line = plan.find((r: any) => r.itemId === i.id)
      by[i.id] = line
        ? { on: true,  qty: String(line.qty),         price: String(line.unitPrice),
            supplier: line.supplierName || '',        contact: line.supplierContact || '' }
        : { on: false, qty: String(i.totalQty ?? ''), price: String(i.estimatedUnitPrice ?? ''),
            supplier: '',                             contact: '' }
    }
    return by
  }

  const [rows, setRows]   = useState(serverRows)
  const [search, setSearch] = useState('')

  // Reseed when the server view changes underneath us (a save, or a switch
  // to another cycle). Keyed on the plan's own content so local edits are not
  // wiped by an unrelated re-render.
  const planKey = plan.map((r: any) => `${r.itemId}:${r.qty}:${r.unitPrice}:${r.supplierName||''}:${r.supplierContact||''}`).sort().join('|')
  const itemKey = items.map((i: any) => i.id).join('|')
  useEffect(() => { setRows(serverRows()) }, [planKey, itemKey])

  const open = ['OPEN','REOPENED'].includes(cycle?.status)
  const num  = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

  const chosen  = items.filter((i: any) => rows[i.id]?.on)
  const planned = chosen.reduce((t: number, i: any) => t + num(rows[i.id].qty) * num(rows[i.id].price), 0)
  const perMember = members.length ? planned / members.length : 0

  // Dirty check compares against server truth rather than tracking a flag,
  // so an edit-and-undo correctly reports nothing to save.
  const base  = serverRows()
  const dirty = items.some((i: any) => {
    const a = rows[i.id], b = base[i.id]
    if (!a || !b) return false
    if (a.on !== b.on) return true
    return a.on && (num(a.qty) !== num(b.qty) || num(a.price) !== num(b.price)
                 || (a.supplier||'') !== (b.supplier||'') || (a.contact||'') !== (b.contact||''))
  })
  const invalid = chosen.filter((i: any) => !(num(rows[i.id].qty) > 0) || num(rows[i.id].price) < 0)

  const setRow = (id: string, patch: any) => setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }))
  const term    = search.trim().toLowerCase()
  const visible = term ? items.filter((i: any) => (i.name||'').toLowerCase().includes(term)) : items

  function save() {
    onSavePlan(chosen.map((i: any) => ({
      itemId: i.id, qty: num(rows[i.id].qty), unitPrice: num(rows[i.id].price),
      supplierName: rows[i.id].supplier || null, supplierContact: rows[i.id].contact || null,
    })))
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
        {[
          {l:'Items chosen',      v:`${chosen.length}/${items.length}`, c:NAVY},
          {l:'Buying this period',v:`$${fmt(planned)}`,                 c:GOLD},
          {l:'Members',           v:String(members.length),             c:'#475569'},
          {l:'Contribution each', v:`$${fmt(perMember)}`,               c:TEAL},
        ].map(k=><div key={k.l} style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px'}}>
          <div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em'}}>{k.l}</div>
          <div style={{fontSize:'16px',fontWeight:'700',color:k.c,marginTop:'2px'}}>{k.v}</div>
        </div>)}
      </div>

      {open
        ? <div style={{background:'#EEF2FF',border:'1px solid #C7D2FE',borderRadius:'8px',padding:'9px 12px',fontSize:'11px',color:'#3730A3'}}>
            Tick what this period&apos;s money will buy and adjust quantity or price where it has moved. Nothing is sent until you press Save.
          </div>
        : <div style={{background:'#F1F5F9',borderRadius:'8px',padding:'9px 12px',fontSize:'11px',color:'#475569'}}>
            The roll-call has closed, so this plan is fixed. Members were told what to bring based on it.
          </div>}

      {items.length>3&&<input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search the catalogue..."
        style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'16px',outline:'none',boxSizing:'border-box'}}/>}

      {items.length===0
        ? <div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}>
            <div style={{fontSize:'32px',marginBottom:'8px'}}>🧺</div>
            <p style={{margin:'0 0 4px',color:'#475569'}}>The catalogue is empty.</p>
            <p style={{fontSize:'12px',margin:0}}>Add grocery items on the Grocery List tab first.</p>
          </div>
        : <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
            {visible.map((i:any,idx:number)=>{
              const r    = rows[i.id] || { on:false, qty:'', price:'', supplier:'', contact:'' }
              const on   = r.on
              const line = num(r.qty) * num(r.price)
              const bad  = on && (!(num(r.qty) > 0) || num(r.price) < 0)
              const wasOn = base[i.id]?.on
              const moved = on && wasOn && (num(r.qty) !== num(base[i.id].qty) || num(r.price) !== num(base[i.id].price)
                || (r.supplier||'') !== (base[i.id].supplier||'') || (r.contact||'') !== (base[i.id].contact||''))
              return (
                <div key={i.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 12px',flexWrap:'wrap',borderTop:idx===0?'none':'1px solid #F1F5F9',background:on?'#F6FFFB':'white'}}>
                  <button onClick={()=>setRow(i.id,{on:!on})} disabled={!open}
                    style={{width:'24px',height:'24px',minWidth:'24px',borderRadius:'6px',flexShrink:0,cursor:open?'pointer':'not-allowed',border:`2px solid ${on?TEAL:'#CBD5E1'}`,background:on?TEAL:'white',color:'white',fontSize:'13px',fontWeight:'700',display:'flex',alignItems:'center',justifyContent:'center',padding:0}}>
                    {on?'✓':''}
                  </button>

                  <div style={{flex:1,minWidth:'130px'}}>
                    <div style={{fontSize:'13px',fontWeight:'600',color:on?NAVY:'#64748B'}}>
                      {i.name}
                      {(on!==wasOn||moved)&&<span style={{fontSize:'10px',color:GOLD,marginLeft:'6px'}}>• unsaved</span>}
                    </div>
                    <div style={{fontSize:'10px',color:'#94A3B8'}}>catalogue: {i.totalQty} {i.unit} @ ${fmt(i.estimatedUnitPrice)}</div>
                  </div>

                  <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                    <div style={{width:'82px'}}>
                      <div style={{fontSize:'9px',color:'#94A3B8',textTransform:'uppercase',marginBottom:'2px'}}>Qty</div>
                      <input type="number" step="0.5" min="0" disabled={!on||!open} value={r.qty}
                        onChange={e=>setRow(i.id,{qty:e.target.value})}
                        style={{width:'100%',padding:'8px',border:`1.5px solid ${bad?'#FECACA':'#E2E8F0'}`,borderRadius:'7px',fontSize:'16px',outline:'none',boxSizing:'border-box',background:on?'white':'#F8FAFC',color:on?NAVY:'#94A3B8'}}/>
                    </div>
                    <div style={{width:'94px'}}>
                      <div style={{fontSize:'9px',color:'#94A3B8',textTransform:'uppercase',marginBottom:'2px'}}>Price $</div>
                      <input type="number" step="0.01" min="0" disabled={!on||!open} value={r.price}
                        onChange={e=>setRow(i.id,{price:e.target.value})}
                        style={{width:'100%',padding:'8px',border:`1.5px solid ${bad?'#FECACA':'#E2E8F0'}`,borderRadius:'7px',fontSize:'16px',fontWeight:'600',outline:'none',boxSizing:'border-box',background:on?'white':'#F8FAFC',color:on?NAVY:'#94A3B8'}}/>
                    </div>
                    <div style={{width:'86px',textAlign:'right'}}>
                      <div style={{fontSize:'9px',color:'#94A3B8',textTransform:'uppercase',marginBottom:'2px'}}>Line</div>
                      <div style={{fontSize:'14px',fontWeight:'700',color:on?TEAL:'#CBD5E1'}}>{on?`$${fmt(line)}`:'—'}</div>
                    </div>
                  </div>

                  {/* Supplier belongs to the cycle, not the catalogue — the
                      group may buy the same item elsewhere next period. */}
                  {on&&open&&<div style={{display:'flex',gap:'8px',width:'100%',marginTop:'8px',flexWrap:'wrap'}}>
                    <input type="text" value={r.supplier} onChange={e=>setRow(i.id,{supplier:e.target.value})}
                      placeholder="Supplier for this period (optional)"
                      style={{flex:2,minWidth:'170px',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'16px',outline:'none',boxSizing:'border-box'}}/>
                    <input type="text" value={r.contact} onChange={e=>setRow(i.id,{contact:e.target.value})}
                      placeholder="Contact"
                      style={{flex:1,minWidth:'120px',padding:'8px 10px',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:'16px',outline:'none',boxSizing:'border-box'}}/>
                  </div>}
                  {on&&!open&&r.supplier&&<div style={{fontSize:'11px',color:'#64748B',marginTop:'6px'}}>
                    Supplier: {r.supplier}{r.contact?` · ${r.contact}`:''}
                  </div>}
                </div>
              )
            })}
          </div>}

      {open&&<div style={{position:'sticky',bottom:0,background:'white',borderTop:'1px solid #E2E8F0',padding:'10px 0',display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
        <button onClick={save} disabled={busy||!dirty||invalid.length>0}
          style={{padding:'10px 18px',minHeight:'44px',background:(busy||!dirty||invalid.length>0)?'#CBD5E1':TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:(busy||!dirty||invalid.length>0)?'not-allowed':'pointer'}}>
          {busy?'⏳ Saving...':dirty?'💾 Save plan':'Saved'}
        </button>
        {dirty&&<button onClick={()=>setRows(serverRows())} disabled={busy}
          style={{padding:'10px 14px',minHeight:'44px',background:'#F1F5F9',color:'#475569',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>Discard changes</button>}
        {/* Publishing tells members what to bring, so it must reflect a saved
            plan — never unsaved edits sitting in the browser. */}
        <button onClick={onSetBudget} disabled={busy||dirty||chosen.length===0}
          style={{padding:'10px 18px',minHeight:'44px',background:(busy||dirty||chosen.length===0)?'#CBD5E1':GOLD,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:(busy||dirty||chosen.length===0)?'not-allowed':'pointer'}}>
          📢 Publish — ${fmt(perMember)} each
        </button>
        {dirty&&<span style={{fontSize:'11px',color:GOLD}}>Save the plan before publishing.</span>}
        {invalid.length>0&&<span style={{fontSize:'11px',color:RED}}>{invalid.length} ticked item{invalid.length===1?'':'s'} need a quantity above zero.</span>}
        {!dirty&&cycle?.budgetSetAt&&<span style={{fontSize:'11px',color:'#64748B'}}>
          Published at ${fmt(cycle.targetContribution)} each
          {Math.abs(Number(cycle.plannedTotal)-planned)>0.005&&<strong style={{color:GOLD}}> — plan has changed since</strong>}
        </span>}
      </div>}
    </div>
  )
}

// ── Cycle stage bar ───────────────────────────────────────────
// OPEN -> FUNDED -> LOCKED -> SETTLED. Each stage exposes only the action
// that legitimately comes next, so the sequence cannot be run out of order
// from the UI.
const CYCLE_META: Record<string, any> = {
  OPEN:     { label:'Roll-call open',  hint:'Members tick that they have their money', bg:'#EEF2FF', color:'#3730A3' },
  REOPENED: { label:'Reopened',        hint:'Members tick that they have their money', bg:'#EEF2FF', color:'#3730A3' },
  FUNDED:   { label:'Funded',          hint:'Assign items within the confirmed pot',   bg:'#FEF9C3', color:GOLD },
  LOCKED:   { label:'Assignments locked', hint:'Solve the settlement to issue payment instructions', bg:'#E1F5EE', color:TEAL },
  SETTLED:  { label:'Settled',         hint:'Members pay each other, then buy',        bg:'#DCFCE7', color:GREEN },
  CLOSED:   { label:'Closed',          hint:'Cycle complete',                          bg:'#F1F5F9', color:'#475569' },
}

function CycleBar({ cycle, busy, onLockRollCall, onLockCycle, onSolve }: any) {
  // Hook before the early return — a conditional hook is a crash the first
  // time a club has no cycle.
  const narrow = useIsNarrow()
  if (!cycle) return null
  const meta = CYCLE_META[cycle.status] || CYCLE_META.OPEN
  // On a phone the action is the point of this bar, so it goes full width
  // under the status rather than being squeezed beside it.
  const btn = narrow ? { flex:'1 1 100%', fontSize:'13px' } : {}
  return (
    <div style={{background:meta.bg,border:`1px solid ${meta.color}33`,borderRadius:'10px',padding:narrow?'12px':'12px 14px',display:'flex',flexWrap:'wrap',gap:narrow?'10px':'12px',alignItems:narrow?'stretch':'center',justifyContent:'space-between'}}>
      <div style={{minWidth:0,flex:narrow?'1 1 100%':undefined}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:meta.color}}>Cycle {cycle.periodNumber} · {meta.label}</span>
          {cycle.confirmedMemberCount>0&&<span style={{fontSize:'11px',color:'#475569'}}>
            {cycle.confirmedMemberCount} confirmed{cycle.declinedMemberCount>0?` · ${cycle.declinedMemberCount} declined`:''} · pot ${fmt(cycle.confirmedPot)}
          </span>}
        </div>
        <div style={{fontSize:'11px',color:'#64748B',marginTop:'2px'}}>{meta.hint}</div>
      </div>
      <div style={{display:'flex',gap:'6px',flexWrap:'wrap',flex:narrow?'1 1 100%':undefined}}>
        {['OPEN','REOPENED'].includes(cycle.status)&&<button onClick={onLockRollCall} disabled={busy}
          style={{padding:'8px 14px',minHeight:'44px',background:'#3730A3',color:'white',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:busy?'not-allowed':'pointer',...btn}}>
          {busy?'⏳ Working...':'🔒 Close roll-call'}</button>}
        {cycle.status==='FUNDED'&&<button onClick={onLockCycle} disabled={busy}
          style={{padding:'8px 14px',minHeight:'44px',background:GOLD,color:'white',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:busy?'not-allowed':'pointer',...btn}}>
          {busy?'⏳ Working...':'🔒 Lock assignments'}</button>}
        {cycle.status==='LOCKED'&&<button onClick={onSolve} disabled={busy}
          style={{padding:'8px 14px',minHeight:'44px',background:TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:busy?'not-allowed':'pointer',...btn}}>
          {busy?'⏳ Solving...':'⚡ Solve settlement'}</button>}
        {cycle.status==='SETTLED'&&<button onClick={onSolve} disabled={busy}
          style={{padding:'8px 14px',minHeight:'44px',background:'white',color:TEAL,border:`1px solid ${TEAL}`,borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:busy?'not-allowed':'pointer',...btn}}>
          ↻ Re-solve</button>}
      </div>
    </div>
  )
}

// ── Roll-call ─────────────────────────────────────────────────
// The last-day screen. A tick is NOT a payment — the member is holding cash
// they have not handed to anyone, and will not know who to pay until the
// settlement is solved.
//
// Answers are held locally and saved in ONE request. Writing on each tap
// cost two Tokyo round trips per member, which is the worst possible place
// for that: the whole group is sitting in a room waiting for the roll-call.
// Tapping the active answer again clears it, so a mis-tap in front of
// everyone is undoable.
function RollCallPanel({ rows, cycle, busy, onSaveRollCall, onCloseRollCall }: any) {
  const serverState = () => {
    const by: Record<string, { has: boolean | null; reason: string }> = {}
    for (const r of rows) {
      by[r.userId] = {
        has: r.fundsConfirmedAt ? true : r.fundsDeclinedAt ? false : null,
        reason: r.declineReason || '',
      }
    }
    return by
  }

  const [draft, setDraft] = useState(serverState)
  const rowsKey = rows.map((r: any) => `${r.userId}:${r.fundsConfirmedAt?1:r.fundsDeclinedAt?0:'-'}:${r.declineReason||''}`).join('|')
  useEffect(() => { setDraft(serverState()) }, [rowsKey])

  const open = ['OPEN','REOPENED'].includes(cycle?.status)
  const base = serverState()
  const dirty = rows.some((r: any) => {
    const a = draft[r.userId], b = base[r.userId]
    if (!a || !b) return false
    return a.has !== b.has || (a.has === false && a.reason !== b.reason)
  })

  const answered  = rows.filter((r: any) => draft[r.userId]?.has !== null && draft[r.userId]?.has !== undefined)
  const confirmed = rows.filter((r: any) => draft[r.userId]?.has === true)
  const declined  = rows.filter((r: any) => draft[r.userId]?.has === false)
  const silent    = rows.filter((r: any) => draft[r.userId]?.has === null || draft[r.userId]?.has === undefined)
  const pot       = confirmed.reduce((t: number, r: any) => t + Number(r.amountPayable ?? r.amountDue), 0)

  // Tapping the active answer again clears it back to no-answer.
  const answer = (userId: string, v: boolean) =>
    setDraft(d => ({ ...d, [userId]: { ...d[userId], has: d[userId]?.has === v ? null : v } }))
  const setReason = (userId: string, reason: string) =>
    setDraft(d => ({ ...d, [userId]: { ...d[userId], reason } }))

  function save() {
    onSaveRollCall(rows.map((r: any) => ({
      userId: r.userId,
      hasFunds: draft[r.userId]?.has ?? null,
      reason: draft[r.userId]?.has === false ? (draft[r.userId]?.reason || null) : null,
    })))
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
        {[
          {l:'Answered',   v:`${answered.length}/${rows.length}`, c:answered.length===rows.length?GREEN:'#475569'},
          {l:'Has money',  v:String(confirmed.length),            c:GREEN},
          {l:'No money',   v:String(declined.length),             c:declined.length?RED:'#94A3B8'},
          {l:'In the room',v:`$${fmt(pot)}`,                      c:TEAL},
        ].map(k=><div key={k.l} style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px'}}>
          <div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em'}}>{k.l}</div>
          <div style={{fontSize:'16px',fontWeight:'700',color:k.c,marginTop:'2px'}}>{k.v}</div>
        </div>)}
      </div>

      {open
        ? <div style={{background:'#EEF2FF',border:'1px solid #C7D2FE',borderRadius:'8px',padding:'9px 12px',fontSize:'11px',color:'#3730A3'}}>
            Go round the group and mark each member. Tap the same answer again to clear it. Nothing is sent until you press Save.
          </div>
        : <div style={{background:'#F1F5F9',borderRadius:'8px',padding:'9px 12px',fontSize:'11px',color:'#475569'}}>
            Roll-call is closed for this cycle. Reopen it to change a response.
          </div>}

      <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
        {rows.map((r: any, idx: number) => {
          const d = draft[r.userId] || { has:null, reason:'' }
          const yes = d.has === true, no = d.has === false
          const moved = d.has !== base[r.userId]?.has
          return (
            <div key={r.id} style={{padding:'10px 12px',borderTop:idx===0?'none':'1px solid #F1F5F9',background:yes?'#F6FFFB':no?'#FFFBFB':'white'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
                <div style={{width:'32px',height:'32px',borderRadius:'50%',flexShrink:0,background:'#E1F5EE',color:TEAL,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:'700'}}>
                  {(r.memberName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                </div>
                <div style={{flex:1,minWidth:'120px'}}>
                  <div style={{fontSize:'13px',fontWeight:'600',color:NAVY}}>
                    {r.memberName}
                    {moved&&<span style={{fontSize:'10px',color:GOLD,marginLeft:'6px'}}>• unsaved</span>}
                  </div>
                  <div style={{fontSize:'11px',color:'#64748B'}}>
                    ${fmt(r.amountPayable ?? r.amountDue)} to bring
                    {!!r.carryAdjustment&&<span style={{color:r.carryAdjustment<0?'#3730A3':GOLD}}> · ${fmt(r.amountDue)} base {r.carryAdjustment<0?'−':'+'} ${fmt(Math.abs(r.carryAdjustment))} carried</span>}
                  </div>
                  {r.arrearsCarriedAt&&<div style={{fontSize:'10px',color:GOLD,marginTop:'2px'}}>Previously carried as arrears</div>}
                </div>
                {open
                  ? <div style={{display:'flex',gap:'6px'}}>
                      <button onClick={()=>answer(r.userId,true)}
                        style={{padding:'7px 12px',minHeight:'44px',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer',border:`1.5px solid ${yes?GREEN:'#E2E8F0'}`,background:yes?'#DCFCE7':'white',color:yes?GREEN:'#64748B'}}>✓ Has money</button>
                      <button onClick={()=>answer(r.userId,false)}
                        style={{padding:'7px 12px',minHeight:'44px',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer',border:`1.5px solid ${no?RED:'#E2E8F0'}`,background:no?'#FEF2F2':'white',color:no?RED:'#64748B'}}>✗ Not yet</button>
                    </div>
                  : <Pill bg={yes?'#DCFCE7':no?'#FEF2F2':'#F1F5F9'} color={yes?GREEN:no?RED:'#64748B'}>
                      {yes?'✓ Confirmed':no?'✗ Declined':'— No answer'}
                    </Pill>}
              </div>
              {open&&no&&<input type="text" value={d.reason} onChange={e=>setReason(r.userId,e.target.value)}
                placeholder="Reason (optional)"
                style={{width:'100%',marginTop:'8px',padding:'8px 10px',border:'1.5px solid #FECACA',borderRadius:'7px',fontSize:'16px',outline:'none',boxSizing:'border-box'}}/>}
              {!open&&no&&r.declineReason&&<div style={{fontSize:'10px',color:RED,marginTop:'4px'}}>{r.declineReason}</div>}
            </div>
          )
        })}
      </div>

      {open&&<div style={{position:'sticky',bottom:0,background:'white',borderTop:'1px solid #E2E8F0',padding:'10px 0',display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
        <button onClick={save} disabled={busy||!dirty}
          style={{padding:'10px 18px',minHeight:'44px',background:(busy||!dirty)?'#CBD5E1':TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:(busy||!dirty)?'not-allowed':'pointer'}}>
          {busy?'⏳ Saving...':dirty?'💾 Save roll-call':'Saved'}
        </button>
        {dirty&&<button onClick={()=>setDraft(serverState())} disabled={busy}
          style={{padding:'10px 14px',minHeight:'44px',background:'#F1F5F9',color:'#475569',border:'none',borderRadius:'8px',fontSize:'13px',cursor:'pointer'}}>Discard changes</button>}
        {/* Closing fixes who is in the cycle, so it must act on saved answers
            rather than whatever is sitting unsent in the browser. */}
        <button onClick={onCloseRollCall} disabled={busy||dirty||silent.length>0||confirmed.length===0}
          style={{padding:'10px 18px',minHeight:'44px',background:(busy||dirty||silent.length>0||confirmed.length===0)?'#CBD5E1':'#3730A3',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:(busy||dirty||silent.length>0||confirmed.length===0)?'not-allowed':'pointer'}}>
          🔒 Close roll-call
        </button>
        {dirty
          ? <span style={{fontSize:'11px',color:GOLD}}>Save before closing.</span>
          : silent.length>0
            ? <span style={{fontSize:'11px',color:GOLD}}>Waiting on {silent.map((r:any)=>r.memberName).join(', ')} — silence is not counted as a decline.</span>
            : confirmed.length===0
              ? <span style={{fontSize:'11px',color:RED}}>Nobody has funds — there is nothing to assign this cycle.</span>
              : <span style={{fontSize:'11px',color:'#64748B'}}>Closing fixes the ${fmt(pot)} pot and carries arrears for the {declined.length} who declined.</span>}
      </div>}
    </div>
  )
}

// ── Settlement ────────────────────────────────────────────────
// Only CONFIRMED money counts toward a buyer's funded bar. A payer marking
// their own transfer as sent is a claim, not cash in the buyer's hand.
function SettlementPanel({ transfers, assigns, busy, onState }: any) {
  if (!transfers.length) return (
    <div style={{textAlign:'center',padding:'40px',color:'#94A3B8'}}>
      <div style={{fontSize:'32px',marginBottom:'8px'}}>⚡</div>
      <p style={{margin:'0 0 4px',color:'#475569'}}>No settlement yet.</p>
      <p style={{fontSize:'12px',margin:0}}>Close the roll-call, assign the items, then lock and solve.</p>
    </div>
  )

  const confirmedIn: Record<string, number> = {}
  for (const t of transfers) {
    if (t.status === 'CONFIRMED' && t.payeeUserId)
      confirmedIn[t.payeeUserId] = (confirmedIn[t.payeeUserId] || 0) + Number(t.amount)
  }
  const buyers: Record<string, any> = {}
  for (const a of assigns) {
    if (!buyers[a.userId]) buyers[a.userId] = { name:a.memberName, needs:0 }
    buyers[a.userId].needs += Number(a.advanceAmount)
  }
  const totalMoved = transfers.reduce((t: number, x: any) => t + Number(x.amount), 0)
  const settled    = transfers.filter((t: any) => t.status === 'CONFIRMED')
    .reduce((t: number, x: any) => t + Number(x.amount), 0)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px'}}>
        {[
          {l:'Payments',      v:String(transfers.length),   c:NAVY},
          {l:'Total to move', v:`$${fmt(totalMoved)}`,      c:GOLD},
          {l:'Confirmed',     v:`$${fmt(settled)}`,         c:settled>=totalMoved?GREEN:TEAL},
        ].map(k=><div key={k.l} style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px'}}>
          <div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em'}}>{k.l}</div>
          <div style={{fontSize:'16px',fontWeight:'700',color:k.c,marginTop:'2px'}}>{k.v}</div>
        </div>)}
      </div>

      {Object.keys(buyers).length>0&&<div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'12px 14px'}}>
        <div style={{fontSize:'11px',fontWeight:'700',color:NAVY,textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'9px'}}>Buyer funding</div>
        {Object.entries(buyers).map(([uid,b]: any)=>{
          const have = Number(confirmedIn[uid]||0)
          const pct  = b.needs>0 ? Math.min(100, Math.round(have/b.needs*100)) : 100
          return (
            <div key={uid} style={{marginBottom:'9px'}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'12px',marginBottom:'3px'}}>
                <span style={{color:NAVY,fontWeight:'600'}}>{b.name}</span>
                <span style={{color:pct>=100?GREEN:GOLD}}>${fmt(have)} of ${fmt(b.needs)} received</span>
              </div>
              <div style={{height:'6px',background:'#F1F5F9',borderRadius:'3px',overflow:'hidden'}}>
                <div style={{width:`${pct}%`,height:'100%',background:pct>=100?GREEN:GOLD}}/>
              </div>
            </div>
          )
        })}
      </div>}

      <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',overflow:'hidden'}}>
        {transfers.map((t: any, idx: number)=>{
          const done = t.status==='CONFIRMED'
          const meta: Record<string,any> = {
            INSTRUCTED:{bg:'#F1F5F9',color:'#475569',label:'To pay'},
            CLAIMED:   {bg:'#FEF9C3',color:GOLD,     label:'Sent — awaiting confirmation'},
            CONFIRMED: {bg:'#DCFCE7',color:GREEN,    label:'Received'},
            DISPUTED:  {bg:'#FEF2F2',color:RED,      label:'Disputed'},
          }
          const m = meta[t.status] || meta.INSTRUCTED
          return (
            <div key={t.id} style={{padding:'11px 13px',borderTop:idx===0?'none':'1px solid #F1F5F9',display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'center'}}>
              <div style={{flex:1,minWidth:'180px'}}>
                <div style={{fontSize:'13px',color:NAVY}}>
                  <strong>{t.payerName}</strong> pays <strong>{t.payeeName}</strong>
                  {t.payeeType==='SUPPLIER'&&<span style={{fontSize:'10px',color:PURPLE,marginLeft:'5px'}}>SUPPLIER</span>}
                </div>
                <div style={{fontSize:'11px',color:'#64748B',marginTop:'2px'}}>
                  ${fmt(t.amount)}
                  {t.payeeType==='SUPPLIER'&&t.accountNumber&&<span> · {t.bankName} {t.accountNumber}</span>}
                  {t.reference&&<span> · ref {t.reference}</span>}
                </div>
              </div>
              <Pill bg={m.bg} color={m.color}>{m.label}</Pill>
              <div style={{display:'flex',gap:'5px'}}>
                {t.status==='INSTRUCTED'&&<button onClick={()=>onState('CLAIM_TRANSFER',t.id)} disabled={busy}
                  style={{padding:'6px 10px',minHeight:'44px',background:'#FEF9C3',color:GOLD,border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>Mark sent</button>}
                {!done&&<button onClick={()=>onState('CONFIRM_TRANSFER',t.id)} disabled={busy}
                  style={{padding:'6px 10px',minHeight:'44px',background:'#DCFCE7',color:GREEN,border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>Confirm received</button>}
                {done&&<button onClick={()=>onState('DISPUTE_TRANSFER',t.id)} disabled={busy}
                  style={{padding:'6px 10px',minHeight:'44px',background:'#FEF2F2',color:RED,border:'1px solid #FECACA',borderRadius:'6px',fontSize:'11px',cursor:'pointer'}}>Dispute</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Club Detail ───────────────────────────────────────────────
function ClubDetail({ clubId, groupMembers, onClose, onAction }: any) {
  const [club, setClub]   = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]     = useState<'dashboard'|'items'|'cycle'|'members'|'contributions'|'settings'>('dashboard')
  const [stage, setStage] = useState<'periodplan'|'rollcall'|'assignments'|'settlement'>('periodplan')
  const [showItemModal, setShowItemModal] = useState(false)
  const [editItem, setEditItem]           = useState<any>(null)
  const [purchaseItem, setPurchaseItem]   = useState<any>(null)
  const [assignItem, setAssignItem]       = useState<any>(null)
  const [acquitRow, setAcquitRow]         = useState<any>(null)
  const [saving, setSaving]               = useState(false)
  const [busy, setBusy]                   = useState<{label:string;detail?:string}|null>(null)
  const [search, setSearch]               = useState('')
  const narrow                            = useIsNarrow()

  const fetchClub = useCallback(async () => {
    // Client-side timing. The server's own numbers arrive in data._timings, but
    // they cannot see time spent before the handler starts (cold function boot,
    // TLS, queueing) or after it returns (transfer, JSON.parse, React render).
    // Comparing the two is what tells us which side of the wire the problem is
    // on. Harmless in production: three timestamps and one console line.
    const tStart = performance.now()
    const res    = await fetch(`/api/grocery?clubId=${clubId}`)
    const tHeaders = performance.now()
    const data   = await res.json()
    const tParsed  = performance.now()
    if (data.success) setClub(data.data)
    setLoading(false)
    const server = data?.data?._timings
    console.log('[grocery] club load',
      `request→headers ${Math.round(tHeaders - tStart)}ms`,
      `body+parse ${Math.round(tParsed - tHeaders)}ms`,
      `total ${Math.round(tParsed - tStart)}ms`,
      server ? `| server handler ${server.handlerMs}ms` : '| server timings off',
      server?.marks ?? '')
  }, [clubId])

  useEffect(()=>{ fetchClub() },[fetchClub])

  // `busyLabel` shows a blocking overlay for long-running actions. Actions that
  // return quickly pass nothing and just disable their button as before.
  async function doAction(action: string, payload: any = {}, busyLabel?: {label:string;detail?:string}) {
    setSaving(true)
    if (busyLabel) setBusy(busyLabel)
    try {
      const res  = await fetch('/api/grocery', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action, clubId, ...payload }) })
      const data = await res.json()
      if (data.success) { onAction(data.message); await fetchClub() }
      else onAction(data.error||'Failed','error')
    } catch { onAction('Network error','error') } finally { setSaving(false); setBusy(null) }
  }

  const activateBusy = (memberCount: number) => ({
    label:  'Activating club…',
    detail: memberCount > 0
      ? `Building the contribution schedule for ${memberCount} member${memberCount===1?'':'s'}.`
      : 'Building the contribution schedule.',
  })

  if (loading) return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:narrow?'20px':0}}>
      <div style={{background:'white',borderRadius:'16px',padding:narrow?'32px 24px':'40px',textAlign:'center',width:narrow?'100%':'auto'}}><div style={{fontSize:'32px',marginBottom:'12px'}}>⏳</div>Loading...</div>
    </div>
  )
  if (!club) return null

  const sm        = STATUS_META[club.status] || STATUS_META.SETUP
  const members   = club.members || []
  const items     = club.items   || []
  const contribs  = club.contributions || []
  const assigns   = club.assignments   || []
  const cycles    = club.cycles        || []
  const transfers = club.settlementTransfers || []
  // The cycle currently being worked: the first not yet closed.
  const cycle     = cycles.find((c:any)=>c.status!=='CLOSED') || cycles[0] || null
  const period    = cycle?.periodNumber ?? 1
  const rollCall  = contribs.filter((c:any)=>c.periodNumber===period)
  const cycleTx   = transfers.filter((t:any)=>t.periodNumber===period)
  const plan      = (club.periodPurchases||[]).filter((r:any)=>r.periodNumber===period)
  // Contributions: current and previous cycle only. Route v1.12 already scopes
  // the payload to this window, so the filter is a no-op against a current
  // server — it stays because it is the client's own statement of what it
  // renders, and it keeps this component correct if it is ever handed a wider
  // payload (a cached response, an older deployment, a future export path).
  const windowFrom      = Math.max(1, Number(club.periodWindowFrom ?? period - 1))
  const visibleContribs = contribs.filter((c:any)=>c.periodNumber>=windowFrom)
  // Assignments are read per period everywhere they are shown, so scope once
  // here rather than re-filtering the same array at three call sites.
  const cycleAssigns = assigns.filter((a:any)=>a.periodNumber===period)
  const openAssigns  = cycleAssigns.filter((a:any)=>['ASSIGNED','PURCHASED'].includes(a.status))
  const nonMembers = groupMembers.filter((m:any) => !members.find((cm:any)=>cm.userId===(m.userId||m.id)))

  // Group contribs by period — built from the visible window, not the raw
  // array. Building it from `contribs` was what forced the route to ship every
  // period ever written: the tab rendered them all.
  const byPeriod: Record<number,any[]> = {}
  visibleContribs.filter((c:any) => !search || c.memberName?.toLowerCase().includes(search.toLowerCase()))
    .forEach((c:any) => { if (!byPeriod[c.periodNumber]) byPeriod[c.periodNumber]=[]; byPeriod[c.periodNumber].push(c) })

  const now = new Date()
  const canActivate = club.status==='SETUP' && members.length>0 && items.length>0

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:narrow?'stretch':'center',justifyContent:'center',zIndex:1000,padding:narrow?0:'16px'}}>
      {/* A phone gets the whole screen. A 95vh card inside a 16px gutter wastes
          both edges and leaves a strip of dimmed backdrop that reads as a
          mis-tap target. */}
      <div style={{background:'white',borderRadius:narrow?0:'16px',width:'100%',maxWidth:narrow?'none':'820px',maxHeight:narrow?'none':'95vh',height:narrow?'100%':'auto',display:'flex',flexDirection:'column',boxShadow:narrow?'none':'0 25px 60px rgba(0,0,0,0.3)',overflow:'hidden'}}>
        {busy&&<BusyOverlay label={busy.label} detail={busy.detail}/>}
        {showItemModal&&<ItemModal clubId={clubId} item={editItem} memberCount={members.length||1}
          onClose={()=>{ setShowItemModal(false); setEditItem(null) }}
          onSuccess={(msg:string)=>{ onAction(msg); fetchClub() }}/>}
        {purchaseItem&&<PurchaseModal item={purchaseItem} members={members} clubId={clubId}
          onClose={()=>setPurchaseItem(null)}
          onSuccess={(msg:string)=>{ onAction(msg); fetchClub(); setPurchaseItem(null) }}/>}
        {assignItem&&<AssignItemModal item={assignItem} members={members} clubId={clubId}
          available={cycle?.confirmedPot!=null
            ? Number(cycle.confirmedPot)
              - cycleAssigns.reduce((t:number,a:any)=>t+Number(a.advanceAmount||0),0)
            : club.uncommittedCash}
          periodNumber={period}
          suppliers={club.supplierAccounts||[]}
          existing={cycleAssigns.find((a:any)=>a.itemId===assignItem.id&&a.status!=='ACQUITTED')}
          onClose={()=>setAssignItem(null)}
          onSuccess={(msg:string)=>{ onAction(msg); fetchClub() }}
          onError={(msg:string)=>onAction(msg,'error')}/>}
        {acquitRow&&<AcquitModal assignment={acquitRow} clubId={clubId}
          onClose={()=>setAcquitRow(null)}
          onSuccess={(msg:string)=>{ onAction(msg); fetchClub() }}
          onError={(msg:string)=>onAction(msg,'error')}/>}

        {/* Header */}
        <div style={{background:`linear-gradient(135deg,${NAVY},#1A4A2E)`,padding:narrow?'14px 14px 16px':'20px 24px',flexShrink:0,paddingTop:narrow?'calc(14px + env(safe-area-inset-top))':undefined}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:narrow?'10px':'12px'}}>
            <div style={{width:narrow?'38px':'44px',height:narrow?'38px':'44px',borderRadius:'10px',background:'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:narrow?'19px':'22px',flexShrink:0}}>🛒</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'2px'}}>
                <span style={{fontSize:narrow?'15px':'16px',fontWeight:'700',color:'white'}}>{club.name}</span>
                <Pill bg={sm.bg} color={sm.color}>{sm.icon} {sm.label}</Pill>
              </div>
              <div style={{fontSize:narrow?'11px':'12px',color:'rgba(255,255,255,0.6)',lineHeight:1.45}}>
                {FREQ[club.contributionFrequency]} · {club.periodMonths} months · {members.length} members
                {club.coordinatorName&&<span style={{marginLeft:'8px'}}>· 👤 {club.coordinatorName}</span>}
              </div>
            </div>
            {/* 32px is under the 44px minimum, and this is the only way out of
                a full-screen sheet. */}
            <button onClick={onClose} aria-label="Close" style={{width:narrow?'44px':'32px',height:narrow?'44px':'32px',background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:narrow?'22px':'18px',color:'white',flexShrink:0,lineHeight:1}}>×</button>
          </div>

          {/* KPI strip */}
          {/* Five figures across a 380px phone gives each one 55px, against
              amounts that need ~75px — they wrapped mid-number. Two columns
              of tinted cards instead, with the odd one out spanning the row
              rather than sitting in a lopsided gap. No figure is dropped. */}
          <div style={{display:'grid',gridTemplateColumns:narrow?'repeat(2,1fr)':'repeat(5,1fr)',gap:narrow?'8px':'10px',marginTop:narrow?'12px':'14px',paddingTop:'12px',borderTop:'1px solid rgba(255,255,255,0.1)'}}>
            {[
              {l:'List Value',    v:`$${fmt(club.listValue ?? club.totalBudget)}`,   c:'white'},
              {l:'Collected',     v:`$${fmt(club.totalContributed)}`,                c:'#9FE1CB'},
              {l:'Advanced Out',  v:`$${fmt(club.advancedOut||0)}`,                  c:'#FCD34D'},
              {l:'Uncommitted',   v:`$${fmt(club.uncommittedCash||0)}`,              c:(club.uncommittedCash||0)>=0?'#9FE1CB':'#FCA5A5'},
              {l:'Unacquitted',   v:`$${fmt(club.unacquitted||0)}`,                  c:(club.unacquitted||0)>0?'#FCA5A5':'white'},
            ].map((s,si,arr)=><div key={s.l} style={narrow?{background:'rgba(255,255,255,0.07)',borderRadius:'8px',padding:'8px 10px',gridColumn:(arr.length%2===1&&si===arr.length-1)?'1 / -1':undefined}:undefined}>
              <div style={{fontSize:'9px',color:'rgba(255,255,255,0.5)',textTransform:'uppercase',letterSpacing:'0.04em'}}>{s.l}</div>
              <div style={{fontSize:'15px',fontWeight:'700',color:s.c,marginTop:'2px'}}>{s.v}</div>
            </div>)}
          </div>

          {/* Budget progress */}
          {club.totalBudget > 0 && <div style={{marginTop:'10px',display:'grid',gridTemplateColumns:narrow?'1fr':'1fr 1fr',gap:'8px'}}>
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
          {/* 6px of vertical padding is a 26px target. On a phone these become
              full-width rows at 44px. */}
          <div style={{display:'flex',gap:'8px',marginTop:'12px',flexWrap:'wrap'}}>
            {canActivate&&<button onClick={()=>doAction('ACTIVATE',{},activateBusy(members.length))} disabled={saving}
              style={{padding:narrow?'10px 14px':'6px 14px',minHeight:narrow?'44px':undefined,flex:narrow?'1 1 100%':undefined,background:saving?'#94A3B8':TEAL,color:'white',border:'none',borderRadius:narrow?'8px':'6px',fontSize:narrow?'13px':'12px',fontWeight:'600',cursor:saving?'not-allowed':'pointer'}}>{saving?'⏳ Activating…':'▶️ Activate Club'}</button>}
            {club.status==='ACTIVE'&&<button onClick={()=>setTab('items')}
              style={{padding:narrow?'10px 14px':'6px 14px',minHeight:narrow?'44px':undefined,flex:narrow?'1 1 100%':undefined,background:'rgba(255,255,255,0.15)',color:'white',border:'none',borderRadius:narrow?'8px':'6px',fontSize:narrow?'13px':'12px',cursor:'pointer'}}>🛒 Manage Items</button>}
            {['PURCHASING','ACTIVE'].includes(club.status)&&<button onClick={()=>doAction('MARK_DISTRIBUTED',{},{label:'Updating items…',detail:'Marking all purchased items as distributed.'})} disabled={saving}
              style={{padding:narrow?'10px 14px':'6px 14px',minHeight:narrow?'44px':undefined,flex:narrow?'1 1 100%':undefined,background:'rgba(255,255,255,0.15)',color:'white',border:'none',borderRadius:narrow?'8px':'6px',fontSize:narrow?'13px':'12px',cursor:'pointer'}}>📦 Mark All Distributed</button>}
          </div>
        </div>

        {/* Tabs */}
        {/* Wraps rather than scrolls: a tab bar that runs off the edge hides
            destinations with no affordance that they exist. */}
        {/* Wrapping flex puts two tabs on the first row and orphans the sixth.
            A fixed 3x2 grid gives every destination the same target and keeps
            the row structure predictable as tabs are added. Still no
            horizontal scroll, at any width. */}
        <div style={{display:narrow?'grid':'flex',gridTemplateColumns:narrow?'repeat(3,1fr)':undefined,flexWrap:'wrap',borderBottom:'1px solid #E2E8F0',flexShrink:0}}>
          {[['dashboard','📊 Dashboard'],['items','🛒 Grocery List'],['cycle','🔄 Cycle'],['members','👥 Members'],['contributions','💸 Contributions'],['settings','⚙️ Settings']].map(([id,label])=>(
            <button key={id} onClick={()=>{ setTab(id as any); if(id==='cycle') setStage(currentStage(cycle) as any) }}
              style={{padding:narrow?'11px 4px':'10px 16px',minHeight:narrow?'44px':undefined,background:'none',border:'none',borderBottom:tab===id?`2px solid ${TEAL}`:'2px solid transparent',color:tab===id?TEAL:'#64748B',fontWeight:tab===id?'600':'400',fontSize:narrow?'11px':'13px',cursor:'pointer',marginBottom:'-1px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{flex:1,overflowY:'auto',WebkitOverflowScrolling:'touch',padding:narrow?'12px 12px':'16px 20px',paddingBottom:narrow?'calc(24px + env(safe-area-inset-bottom))':undefined}}>

          {/* DASHBOARD */}
          {tab==='dashboard'&&<div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
            {club.status==='SETUP'&&<div style={{background:'#EEF2FF',borderRadius:'12px',padding:narrow?'14px':'16px',border:'1px solid #C7D2FE'}}>
              <div style={{fontSize:'13px',fontWeight:'600',color:'#3730A3',marginBottom:'10px'}}>📋 Setup Checklist</div>
              {[[members.length>0,`Members enrolled (${members.length})`],[items.length>0,`Grocery items added (${items.length})`],[club.coordinatorId,'Coordinator assigned']].map(([done,label],i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:done?GREEN:'#64748B',marginBottom:'5px'}}>
                  <span>{done?'✅':'⬜'}</span><span>{label as string}</span>
                </div>
              ))}
              {canActivate&&<button onClick={()=>doAction('ACTIVATE',{},activateBusy(members.length))} disabled={saving}
                style={{marginTop:'8px',padding:narrow?'12px 18px':'8px 18px',minHeight:narrow?'44px':undefined,width:narrow?'100%':undefined,background:saving?'#94A3B8':TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:narrow?'13px':'12px',fontWeight:'600',cursor:saving?'not-allowed':'pointer'}}>{saving?'⏳ Activating…':'▶️ Activate Now'}</button>}
              {!canActivate&&<p style={{fontSize:'12px',color:'#64748B',margin:'8px 0 0'}}>Add at least one member and one grocery item to activate.</p>}
            </div>}

            {/* Item status summary */}
            {items.length>0&&<div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:narrow?'14px':'16px'}}>
              <div style={{fontSize:'13px',fontWeight:'600',color:NAVY,marginBottom:'12px'}}>🛒 Grocery List Summary</div>
              {/* Four across leaves 71px a tile, and DISTRIBUTED alone measures
                  ~66px at 10px — it sat on the edge of wrapping. 2x2 instead. */}
              <div style={{display:'grid',gridTemplateColumns:narrow?'repeat(2,1fr)':'repeat(4,1fr)',gap:'8px',marginBottom:'12px'}}>
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
                  <button onClick={()=>{ setTab('cycle'); setStage('assignments') }} style={{padding:narrow?'10px 12px':'4px 10px',minHeight:narrow?'44px':undefined,flexShrink:0,background:'#EEF2FF',color:PURPLE,border:'none',borderRadius:narrow?'8px':'5px',fontSize:'11px',fontWeight:narrow?'600':'400',cursor:'pointer',whiteSpace:'nowrap'}}>{narrow?'Assign →':'Assignments →'}</button>
                </div>
              ))}
            </div>}

            {/* Club info */}
            {/* Two 150px columns cannot hold "CONTRIBUTION/MEMBER" above
                "1 December 2026". On a phone these become label-left /
                value-right rows, matching the Overview convention used on the
                group screens. Dates shorten so the value stays on one line. */}
            <div style={{display:'grid',gridTemplateColumns:narrow?'1fr':'1fr 1fr',gap:narrow?'6px':'8px'}}>
              {[['Start Date',new Date(club.startDate).toLocaleDateString('en-GB',narrow?{day:'numeric',month:'short',year:'numeric'}:{day:'numeric',month:'long',year:'numeric'})],
                ['End Date',new Date(club.endDate).toLocaleDateString('en-GB',narrow?{day:'numeric',month:'short',year:'numeric'}:{day:'numeric',month:'long',year:'numeric'})],
                ['Frequency',FREQ[club.contributionFrequency]],
                ['Contribution/Member',`$${fmt(club.contributionAmount)}`],
                ['Coordinator',club.coordinatorName||'—'],
                ['Days Left',`${club.daysLeft} days`],
              ].map(([l,v])=><div key={l as string} style={narrow
                  ? {background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px'}
                  : {background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px'}}>
                <div style={{fontSize:'10px',color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:narrow?0:'3px',flexShrink:0}}>{l}</div>
                <div style={{fontSize:'13px',fontWeight:'500',color:NAVY,textAlign:narrow?'right':'left',minWidth:0}}>{v}</div>
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
                    {['Item','Unit','Qty/Member','Total Qty','Est. Price','Actual','Status','Actions'].map(h=>(
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
                        <td style={{padding:'9px 10px'}}>
                          <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
                            {['PENDING','ASSIGNED'].includes(item.status)&&
                              <button onClick={()=>{ setEditItem(item); setShowItemModal(true) }}
                                style={{padding:'3px 7px',background:'#EEF2FF',color:PURPLE,border:'none',borderRadius:'4px',fontSize:'10px',cursor:'pointer'}}>Edit</button>}
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

          {/* CYCLE STAGE */}
          {cycle&&['dashboard','cycle'].includes(tab)&&<CycleBar cycle={cycle} busy={busy}
            onLockRollCall={()=>doAction('LOCK_CONTRIBUTIONS',{periodNumber:period})}
            onLockCycle={()=>doAction('LOCK_CYCLE',{periodNumber:period})}
            onSolve={()=>doAction('SOLVE_SETTLEMENT',{periodNumber:period})}/>}

          {/* CYCLE — four stages of one sequence */}
          {tab==='cycle'&&<StageNav stage={stage} setStage={setStage} cycle={cycle}/>}

          {tab==='cycle'&&stage==='periodplan'&&<PeriodPurchasePanel plan={plan} items={items} cycle={cycle}
            members={members} busy={saving}
            onSavePlan={(lines:any[])=>doAction('SAVE_PERIOD_PLAN',{lines,periodNumber:period})}
            onSetBudget={()=>doAction('SET_PERIOD_BUDGET',{periodNumber:period})}/>}

          {tab==='cycle'&&stage==='rollcall'&&<RollCallPanel rows={rollCall} cycle={cycle} busy={saving}
            onSaveRollCall={(responses:any[])=>doAction('SAVE_ROLL_CALL',{responses,periodNumber:period})}
            onCloseRollCall={()=>doAction('LOCK_CONTRIBUTIONS',{periodNumber:period})}/>}

          {tab==='cycle'&&stage==='settlement'&&<SettlementPanel transfers={cycleTx}
            assigns={cycleAssigns} busy={busy}
            onState={(action:string,transferId:string)=>doAction(action,{transferId})}/>}

          {/* Assignments are this cycle's, not the club's. Passing the whole
              array made the totals row sum every period ever assigned. */}
          {tab==='cycle'&&stage==='assignments'&&<AssignmentsPanel plan={plan} assigns={cycleAssigns}
            openAssigns={openAssigns} club={club} cycle={cycle} busy={busy}
            onAssign={(line:any)=>setAssignItem({ id:line.itemId, name:line.itemName, unit:line.unit,
              totalQty:Number(line.qty), qtyUnassigned:Number(line.qtyUnassigned),
              estimatedUnitPrice:Number(line.unitPrice) })}
            onAcquit={(a:any)=>setAcquitRow(a)}
            onWithdraw={(a:any)=>doAction('CANCEL_ASSIGNMENT',{itemId:a.itemId,assignedToId:a.userId})}/>}
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
                {[['Total',visibleContribs.length,'#64748B'],['Paid',visibleContribs.filter((c:any)=>c.status==='PAID').length,GREEN],
                  ['Pending',visibleContribs.filter((c:any)=>c.status==='PENDING').length,'#1A5EA8'],
                  ['Overdue',visibleContribs.filter((c:any)=>c.isOverdue).length,RED]].map(([l,v,c])=>(
                  <span key={l as string} style={{color:c as string,fontWeight:'600'}}>{l}: {v}</span>
                ))}
                <span style={{color:'#94A3B8',fontWeight:'400'}}>
                  · showing period{windowFrom===period?'':'s'} {windowFrom===period?`#${period}`:`#${windowFrom}–#${period}`}
                </span>
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
                            <td style={{padding:'8px 14px'}}>
                              <div style={{fontSize:'13px',fontWeight:'600',color:TEAL}}>${fmt(c.amountPayable??c.amountDue)}</div>
                              {!!c.carryAdjustment&&<div style={{fontSize:'10px',color:c.carryAdjustment<0?'#3730A3':GOLD}}>
                                ${fmt(c.amountDue)} base {c.carryAdjustment<0?'−':'+'} ${fmt(Math.abs(c.carryAdjustment))} carried
                              </div>}
                            </td>
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
            <ScheduleForm club={club} locked={club.scheduleLocked} reasons={club.scheduleLockReasons}
              saving={busy} onReschedule={(payload:any)=>doAction('RESCHEDULE_CLUB',payload)}/>
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

// ── Schedule ──────────────────────────────────────────────────
// Dates, frequency and duration stay editable while the club has not
// actually started, because changing them regenerates every contribution row
// and that is only safe while nothing hangs off those rows. Once a roll-call
// is answered, money moves or items are assigned, the schedule locks and the
// panel says exactly what locked it rather than greying out silently.
function ScheduleForm({ club, locked, reasons, onReschedule, saving }: any) {
  const iso = (d: any) => { try { return new Date(d).toISOString().split('T')[0] } catch { return '' } }
  const [form, setForm] = useState({
    periodMonths: String(club.periodMonths ?? 3),
    contributionFrequency: club.contributionFrequency || 'MONTHLY',
    startDate: iso(club.startDate),
  })
  const set = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }))

  const months  = parseInt(form.periodMonths || '0', 10)
  const freq    = form.contributionFrequency
  const periods = !(months > 0) ? 0
    : freq === 'WEEKLY' ? Math.ceil(months * 4.33)
    : freq === 'FORTNIGHTLY' ? Math.ceil(months * 2.17)
    : months
  const changed = String(club.periodMonths) !== form.periodMonths
    || (club.contributionFrequency || 'MONTHLY') !== form.contributionFrequency
    || iso(club.startDate) !== form.startDate
  const tooMany = periods > 260
  const blocked = saving || !changed || !(periods > 0) || tooMany

  return (
    <div style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:'16px'}}>
      <h4 style={{fontSize:'14px',fontWeight:'600',color:NAVY,margin:'0 0 4px'}}>📅 Schedule</h4>
      <p style={{fontSize:'11px',color:'#64748B',margin:'0 0 14px'}}>
        Start date, frequency and duration. The end date is worked out from these.
      </p>

      {locked
        ? <div style={{background:'#FEF9C3',border:'1px solid #FCD34D',borderRadius:'8px',padding:'11px 13px'}}>
            <div style={{fontSize:'12px',fontWeight:'700',color:GOLD,marginBottom:'5px'}}>🔒 Locked — this club is in motion</div>
            <ul style={{margin:'0 0 6px',paddingLeft:'18px'}}>
              {(reasons||[]).map((r:string,i:number)=>(
                <li key={i} style={{fontSize:'11px',color:'#78350F',marginBottom:'2px'}}>{r}</li>
              ))}
            </ul>
            <div style={{fontSize:'11px',color:'#78350F'}}>
              Changing the dates now would regenerate the contribution rows these records depend on. The grocery list is unaffected — you can still edit the catalogue.
            </div>
          </div>
        : <div>
            <div style={{background:'#EEF2FF',border:'1px solid #C7D2FE',borderRadius:'8px',padding:'9px 12px',fontSize:'11px',color:'#3730A3',marginBottom:'12px'}}>
              Nothing has happened on this club yet, so the schedule can still change. It locks once a roll-call is answered, money moves, or items are assigned.
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Start date</label>
                <input type="date" value={form.startDate} onChange={e=>set('startDate')(e.target.value)}
                  style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'16px',outline:'none',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Frequency</label>
                <select value={form.contributionFrequency} onChange={e=>set('contributionFrequency')(e.target.value)}
                  style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'16px',outline:'none',background:'white',boxSizing:'border-box'}}>
                  <option value="WEEKLY">Weekly</option>
                  <option value="FORTNIGHTLY">Fortnightly</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#374151',marginBottom:'5px'}}>Duration (months)</label>
                <input type="number" min="1" step="1" value={form.periodMonths} onChange={e=>set('periodMonths')(e.target.value)}
                  style={{width:'100%',padding:'10px 12px',border:`1.5px solid ${tooMany?'#FECACA':'#E2E8F0'}`,borderRadius:'8px',fontSize:'16px',outline:'none',boxSizing:'border-box'}}/>
              </div>
            </div>

            <div style={{background:'#F8FAFC',borderRadius:'8px',padding:'10px 12px',fontSize:'12px',color:'#475569',marginBottom:'12px'}}>
              {periods>0
                ? <span>That is <strong style={{color:NAVY}}>{periods}</strong> {freq.toLowerCase()} period{periods===1?'':'s'}. Contribution rows are rebuilt for every member across all of them.</span>
                : <span>Set a duration of at least one month.</span>}
              {tooMany&&<div style={{color:RED,marginTop:'4px'}}>{periods} periods is too many — reduce the duration or use a less frequent cycle.</div>}
            </div>

            <button onClick={()=>onReschedule({ clubId:club.id, periodMonths:months,
                contributionFrequency:form.contributionFrequency, startDate:form.startDate })}
              disabled={blocked}
              style={{padding:'10px 20px',minHeight:'44px',background:blocked?'#CBD5E1':TEAL,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:blocked?'not-allowed':'pointer'}}>
              {saving?'⏳ Rebuilding schedule...':changed?'📅 Apply new schedule':'No changes to apply'}
            </button>
          </div>}
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
  const [deletingId, setDeletingId] = useState<string|null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string|null>(null)
  const narrow = useIsNarrow()

  const showToast = (msg: string, type='success') => setToast({msg,type})

  async function handleDelete(clubId: string) {
    setDeletingId(clubId)
    try {
      const res  = await fetch(`/api/grocery?clubId=${clubId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) { showToast(data.message); fetchClubs() }
      else showToast(data.error || 'Delete failed', 'error')
    } catch { showToast('Network error', 'error') }
    finally { setDeletingId(null); setDeleteConfirm(null) }
  }

  const fetchClubs = useCallback(async () => {
    setLoading(true)
    const tStart = performance.now()
    try {
      const res  = await fetch(`/api/grocery?groupId=${groupId}`)
      const tHeaders = performance.now()
      const data = await res.json()
      if (data.success) setClubs(data.data)
      const server = data?._timings
      console.log('[grocery] club list',
        `request→headers ${Math.round(tHeaders - tStart)}ms`,
        `total ${Math.round(performance.now() - tStart)}ms`,
        server ? `| server handler ${server.handlerMs}ms` : '| server timings off',
        server?.marks ?? '')
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

      <div style={{display:'flex',flexDirection:narrow?'column':'row',justifyContent:'space-between',alignItems:narrow?'stretch':'center',gap:narrow?'10px':0}}>
        <div>
          <h3 style={{fontSize:'16px',fontWeight:'700',color:NAVY,margin:'0 0 2px'}}>🛒 Grocery Clubs</h3>
          <p style={{fontSize:'12px',color:'#64748B',margin:0}}>Pool contributions to buy groceries in bulk at better prices</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button onClick={fetchClubs} aria-label="Refresh" style={{padding:narrow?'0 16px':'7px 12px',minHeight:narrow?'44px':undefined,minWidth:narrow?'44px':undefined,background:'#F1F5F9',border:'1.5px solid #E2E8F0',borderRadius:'7px',fontSize:narrow?'15px':'12px',cursor:'pointer',color:'#475569'}}>↻</button>
          <button onClick={()=>setShowCreate(true)} style={{padding:narrow?'0 16px':'8px 16px',minHeight:narrow?'44px':undefined,flex:narrow?1:undefined,background:TEAL,color:'white',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ New Club</button>
        </div>
      </div>

      {loading?<div style={{padding:'40px',textAlign:'center',color:'#94A3B8'}}>⏳ Loading...</div>
      :clubs.length===0?<div style={{background:'white',borderRadius:'12px',border:'1px dashed #E2E8F0',padding:narrow?'36px 20px':'48px',textAlign:'center'}}>
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
                style={{background:'white',borderRadius:'12px',border:'1px solid #E2E8F0',padding:narrow?'14px':'16px 20px',cursor:'pointer',display:'flex',alignItems:'center',gap:narrow?'12px':'16px',flexWrap:'wrap',transition:'all 0.15s'}}
                onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.boxShadow='0 4px 16px rgba(0,0,0,0.08)'}}
                onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.boxShadow='none'}}>
                <div style={{width:'42px',height:'42px',borderRadius:'10px',background:`linear-gradient(135deg,${NAVY},#1A4A2E)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',flexShrink:0}}>🛒</div>
                <div style={{flex:1,minWidth:narrow?0:'200px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'2px'}}>
                    <span style={{fontSize:'14px',fontWeight:'700',color:NAVY}}>{c.name}</span>
                    <Pill bg={sm2.bg} color={sm2.color}>{sm2.icon} {sm2.label}</Pill>
                  </div>
                  <div style={{fontSize:'12px',color:'#64748B'}}>
                    {FREQ[c.contributionFrequency]} · {c.periodMonths}mo · {c.memberCount} members · {c.purchasedCount}/{c.itemCount} items purchased
                    {c.coordinatorName&&<span style={{marginLeft:'6px'}}>· 👤 {c.coordinatorName}</span>}
                  </div>
                </div>
                <div style={narrow
                  ? {display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px',flex:'1 1 100%',background:'#F8FAFC',borderRadius:'8px',padding:'10px 8px'}
                  : {display:'flex',gap:'16px',flexWrap:'wrap',flexShrink:0}}>
                  {[{l:'Budget',v:`$${c.totalBudget>0?fmt(c.totalBudget):'TBD'}`},{l:'Collected',v:`$${fmt(c.totalContributed)}`},{l:'Spent',v:`$${fmt(c.totalSpent)}`}].map(s=>(
                    <div key={s.l} style={{textAlign:'center',minWidth:0}}>
                      <div style={{fontSize:'13px',fontWeight:'700',color:NAVY}}>{s.v}</div>
                      <div style={{fontSize:'10px',color:'#94A3B8'}}>{s.l}</div>
                    </div>
                  ))}
                </div>
                {c.totalBudget>0&&<div style={narrow?{flex:'1 1 100%'}:{flexShrink:0,width:'80px'}}>
                  <div style={{fontSize:'10px',color:'#94A3B8',marginBottom:'3px',textAlign:'right'}}>{c.fundingPct}% funded</div>
                  <div style={{height:'6px',background:'#F1F5F9',borderRadius:'3px',overflow:'hidden'}}>
                    <div style={{height:'100%',background:TEAL,borderRadius:'3px',width:`${c.fundingPct}%`}}/>
                  </div>
                </div>}
                {/* The whole card is the tap target on a phone; a 12px chevron
                    competing for a row of its own is noise. */}
                {!narrow&&<span style={{fontSize:'18px',color:'#CBD5E1',flexShrink:0}}>→</span>}
                {deleteConfirm === c.id
                  ? <div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:'6px',alignItems:'center',flexShrink:0,flex:narrow?'1 1 100%':undefined,justifyContent:narrow?'flex-end':undefined}}>
                      <span style={{fontSize:'11px',color:'#991B1B',fontWeight:'600'}}>Delete?</span>
                      <button onClick={()=>handleDelete(c.id)} disabled={!!deletingId}
                        style={{padding:narrow?'0 16px':'4px 10px',minHeight:narrow?'44px':undefined,background:'#DC2626',color:'white',border:'none',borderRadius:'6px',fontSize:narrow?'12px':'11px',fontWeight:'700',cursor:'pointer'}}>
                        {deletingId===c.id?'…':'Yes'}
                      </button>
                      <button onClick={()=>setDeleteConfirm(null)}
                        style={{padding:narrow?'0 16px':'4px 10px',minHeight:narrow?'44px':undefined,background:'#F1F5F9',color:'#475569',border:'none',borderRadius:'6px',fontSize:narrow?'12px':'11px',cursor:'pointer'}}>No</button>
                    </div>
                  : <button onClick={e=>{e.stopPropagation();setDeleteConfirm(c.id)}}
                      style={{padding:narrow?'0 14px':'4px 10px',minHeight:narrow?'40px':undefined,marginLeft:narrow?'auto':undefined,background:'#FEF2F2',color:'#991B1B',border:'1px solid #FECACA',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer',flexShrink:0}}>
                      🗑 Delete
                    </button>
                }
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
