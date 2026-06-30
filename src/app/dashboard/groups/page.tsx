'use client'
import { useState, useEffect, useCallback } from 'react'
import SendInviteModal from '../invitations/SendInviteModal'
import GroceryClubPanel from '../grocery/GroceryClubPanel'
import InvestmentPanel  from '../investment/InvestmentPanel'
import AssetsPage from '../assets/AssetsPage'
import SavingsPage    from '../savings/SavingsPage'
import PropertyPage   from '../property/PropertyPage'
import LoansPage      from '../loans/LoansPage'
import CountrySelector from '../../../components/CountrySelector'
// Brand type → visual style map (replaces broken getStokvels static import)
const STOKVEL_TYPE_COLORS: Record<string, { icon: string; color: string; bg: string }> = {
  SAVINGS:    { icon: '💰', color: '#1A5EA8', bg: '#DBEAFE' },
  GENERAL:    { icon: '🤝', color: '#0F6E56', bg: '#DCFCE7' },
  GROCERY:    { icon: '🛒', color: '#166534', bg: '#DCFCE7' },
  INVESTMENT: { icon: '📈', color: '#7C3AED', bg: '#F3E8FF' },
}

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const BLUE = '#1A5EA8'

const CURRENCIES = ['USD','ZAR','ZWG','KES','TZS','UGX','ZMW','BWP','MWK','EUR','GBP']
const STRATEGIES = [
  { value: 'SENIORITY',  label: 'Seniority Based', desc: 'Longer-standing members get earlier payout positions' },
  { value: 'RANDOM',     label: 'Random Draw',     desc: 'Cryptographically secure random shuffle at cycle start' },
  { value: 'GROUP_VOTE', label: 'Group Vote',      desc: 'Members vote on the payout order before the cycle begins' },
]

const EMPTY_FORM = {
  name: '', description: '', currency: 'USD',
  contributionAmount: '', contributionDay: '1',
  contributionFrequency: 'monthly', maxMembers: '10',
  penaltyRate: '20', insurancePoolPct: '1.5',
  payoutStrategy: 'SENIORITY', country: '', region: '', branding: '',
  city: '', zipCode: '', treasurerId: '', secretaryId: '',
  groupType: 'PRIVATE' as 'PRIVATE'|'PUBLIC',
}

// ── Helpers ───────────────────────────────────────────────────
function statusBadge(status: string) {
  const map: Record<string, [string,string]> = {
    ACTIVE:    ['#DCFCE7','#166534'],
    DRAFT:     ['#F1F5F9','#475569'],
    PAUSED:    ['#FEF9C3','#854D0E'],
    COMPLETED: ['#DBEAFE','#1E40AF'],
    DISSOLVED: ['#FEE2E2','#991B1B'],
  }
  const [bg, color] = map[status] || ['#F1F5F9','#475569']
  return <span style={{ background:bg, color, fontSize:'11px', fontWeight:'600', padding:'2px 8px', borderRadius:'999px' }}>{status}</span>
}

function groupTypeBadge(groupType: string) {
  const isPublic = groupType === 'PUBLIC'
  return (
    <span style={{
      background: isPublic ? '#EFF6FF' : '#F8FAFC',
      color:      isPublic ? '#1D4ED8' : '#475569',
      fontSize:'10px', fontWeight:'700', padding:'2px 8px',
      borderRadius:'999px', letterSpacing:'0.03em',
      border: `1px solid ${isPublic ? '#BFDBFE' : '#E2E8F0'}`,
      display:'inline-flex', alignItems:'center', gap:'3px',
    }}>
      {isPublic ? '🌐 PUBLIC' : '🔒 PRIVATE'}
    </span>
  )
}

function GroupTypeSwitch({ value, onChange }: { value: 'PRIVATE'|'PUBLIC'; onChange: (v: 'PRIVATE'|'PUBLIC') => void }) {
  const isPublic = value === 'PUBLIC'
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'12px 16px', borderRadius:'10px', border:`1.5px solid ${isPublic ? '#BFDBFE' : '#E2E8F0'}`,
        background: isPublic ? '#EFF6FF' : '#F8FAFC', cursor:'pointer', userSelect:'none' as any }}
        onClick={() => onChange(isPublic ? 'PRIVATE' : 'PUBLIC')}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'20px' }}>{isPublic ? '🌐' : '🔒'}</span>
          <div>
            <div style={{ fontSize:'13px', fontWeight:'700', color: isPublic ? '#1D4ED8' : '#475569' }}>
              {isPublic ? 'Public Group' : 'Private Group'}
            </div>
            <div style={{ fontSize:'11px', color:'#94A3B8', lineHeight:'1.4' }}>
              {isPublic
                ? 'Visible to the public — anyone can request to join'
                : 'Invitation only — hidden from the public'}
            </div>
          </div>
        </div>
        {/* Toggle pill */}
        <div style={{ position:'relative', width:'44px', height:'24px', flexShrink:0 }}>
          <div style={{ position:'absolute', inset:0, borderRadius:'12px', background: isPublic ? '#1D4ED8' : '#CBD5E1', transition:'background 0.2s' }} />
          <div style={{ position:'absolute', top:'3px', left: isPublic ? '23px' : '3px', width:'18px', height:'18px', borderRadius:'50%', background:'white', boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left 0.2s' }} />
        </div>
      </div>
      {isPublic && (
        <div style={{ padding:'8px 12px', background:'#FEF9C3', borderRadius:'8px', border:'1px solid #FCD34D', fontSize:'11px', color:'#854D0E', lineHeight:'1.5' }}>
          ⚠️ Public groups can be advertised by the platform. Members of the public can request to join.
        </div>
      )}
    </div>
  )
}

function Input({ label, value, onChange, type='text', placeholder='', required=false, hint='' }: any) {
  return (
    <div style={{ marginBottom:'16px' }}>
      <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
        {label} {required && <span style={{ color:'#DC2626' }}>*</span>}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }}
      />
      {hint && <p style={{ fontSize:'11px', color:'#94A3B8', margin:'4px 0 0' }}>{hint}</p>}
    </div>  )
}

function Select({ label, value, onChange, options, required=false }: any) {
  return (
    <div style={{ marginBottom:'16px' }}>
      <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
        {label} {required && <span style={{ color:'#DC2626' }}>*</span>}
      </label>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white', boxSizing:'border-box' as any }}>
        {options.map((o: any) => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
      </select>
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

// ── Windfall Schemes Hub ──────────────────────────────────────
const SCHEMES = [
  { id:'grocery',    icon:'🛒', label:'Grocery Club',  desc:'Pool contributions to buy groceries in bulk',    color:'#166534', bg:'#DCFCE7', available:true  },
  { id:'savings',    icon:'💰', label:'Savings Pool',  desc:'Time-bound collective savings with lending',     color:'#1A5EA8', bg:'#DBEAFE', available:true  },
  { id:'property',   icon:'🏠', label:'Property',      desc:'Group property investment and rental income',    color:'#7C3AED', bg:'#F3E8FF', available:true  },
  { id:'loans',      icon:'📋', label:'Loans',         desc:'Member loan management with guarantors',         color:'#854D0E', bg:'#FEF9C3', available:true  },
  { id:'investment', icon:'📈', label:'Investment',    desc:'Stock and fund portfolio management',            color:'#0D2137', bg:'#E2E8F0', available:false },
  { id:'assets',     icon:'🏗️', label:'Assets',        desc:'Track and distribute group physical assets',     color:'#475569', bg:'#F1F5F9', available:true  },
]

function WindfallSchemesHub({ groupId, groupMembers }: { groupId: string; groupMembers: any[] }) {
  const TEAL2 = '#0F6E56'; const NAVY2 = '#0D2137'
  const [activeId, setActiveId] = useState<string|null>(null)

  // ── Render active scheme module ────────────────────────────
  if (activeId) {
    const scheme = SCHEMES.find(s => s.id === activeId)
    return (
      <div>
        <button onClick={() => setActiveId(null)}
          style={{ display:'flex', alignItems:'center', gap:'6px', background:'none', border:'none', color:TEAL2, fontSize:'13px', fontWeight:'600', cursor:'pointer', marginBottom:'16px', padding:0 }}>
          ← Back to Windfall Schemes
        </button>

        {activeId === 'grocery' && (
          <GroceryClubPanel groupId={groupId} groupMembers={groupMembers} />
        )}
        {activeId === 'savings' && <SavingsPage groupId={groupId} />}
        {activeId === 'property' && <PropertyPage groupId={groupId} />}
        {activeId === 'loans' && <LoansPage groupId={groupId} />}
        {activeId === 'investment' && (
          <InvestmentPanel groupId={groupId} groupMembers={groupMembers} />
        )}
        {activeId === 'assets' && (
          <AssetsPage groupId={groupId} />
        )}
      </div>
    )
  }

  // ── Scheme selector grid ────────────────────────────────────
  return (
    <div>
      <div style={{ marginBottom:'16px' }}>
        <h3 style={{ fontSize:'15px', fontWeight:'700', color:NAVY2, margin:'0 0 4px' }}>🌀 Windfall Schemes</h3>
        <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>Select a scheme to manage for this group. Members can participate in multiple schemes simultaneously.</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px' }}>
        {SCHEMES.map(s => (
          <div key={s.id}
            onClick={() => setActiveId(s.id)}
            style={{ background:'white', borderRadius:'14px', border:`2px solid ${s.available ? '#E2E8F0' : '#F1F5F9'}`,
              padding:'20px 16px', cursor:'pointer', transition:'all 0.2s', position:'relative', textAlign:'center' }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.border = `2px solid ${s.color}`
              el.style.boxShadow = `0 6px 20px rgba(0,0,0,0.10)`
              el.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.border = `2px solid ${s.available ? '#E2E8F0' : '#F1F5F9'}`
              el.style.boxShadow = 'none'
              el.style.transform = 'translateY(0)'
            }}>
            {!s.available && (
              <span style={{ position:'absolute', top:'8px', right:'8px', background:'#F1F5F9', color:'#94A3B8', fontSize:'9px', fontWeight:'700', padding:'2px 6px', borderRadius:'4px', letterSpacing:'0.04em' }}>
                SOON
              </span>
            )}
            <div style={{ width:'52px', height:'52px', borderRadius:'14px', background:s.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'24px', margin:'0 auto 12px' }}>
              {s.icon}
            </div>
            <div style={{ fontSize:'14px', fontWeight:'700', color:NAVY2, marginBottom:'6px' }}>{s.label}</div>
            <div style={{ fontSize:'11px', color:'#94A3B8', lineHeight:'1.5', marginBottom:'12px' }}>{s.desc}</div>
            <div style={{ display:'inline-flex', alignItems:'center', gap:'4px', fontSize:'11px', fontWeight:'600',
              color: s.available ? s.color : '#94A3B8',
              background: s.available ? s.bg : '#F8FAFC',
              padding:'4px 12px', borderRadius:'999px' }}>
              {s.available ? 'Open →' : 'Coming Soon'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Branding Selector ─────────────────────────────────────────
function BrandingSelector({ countryCode, value, onChange }: { countryCode:string; value:string; onChange:(v:string)=>void }) {
  const [brands, setBrands]           = useState<any[]>([])
  const [loadingBrands, setLoading]   = useState(false)
  const NAVY2 = '#0D2137'

  useEffect(() => {
    if (!countryCode) { setBrands([]); return }
    setLoading(true)
    fetch(`/api/reference?type=stokvel-brands&countryId=${countryCode}`)
      .then(r => r.json())
      .then(d => setBrands(d.success ? d.data : []))
      .catch(() => setBrands([]))
      .finally(() => setLoading(false))
  }, [countryCode])

  if (!countryCode) {
    return (
      <div style={{ padding:'12px 14px', background:'#F8FAFC', border:'1.5px dashed #E2E8F0', borderRadius:'8px', fontSize:'13px', color:'#94A3B8' }}>
        Select a country first to see available branding options
      </div>
    )
  }

  if (loadingBrands) {
    return (
      <div style={{ padding:'12px 14px', background:'#F8FAFC', border:'1.5px dashed #E2E8F0', borderRadius:'8px', fontSize:'13px', color:'#94A3B8' }}>
        Loading brands...
      </div>
    )
  }

  if (brands.length === 0) {
    return (
      <div style={{ padding:'12px 14px', background:'#F8FAFC', border:'1.5px dashed #E2E8F0', borderRadius:'8px', fontSize:'13px', color:'#94A3B8' }}>
        No branding options available for this country
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'8px' }}>
        {brands.map((s: any) => {
          const meta = STOKVEL_TYPE_COLORS[s.type] || STOKVEL_TYPE_COLORS.GENERAL
          const sel  = value === s.name
          return (
            <div key={s.name} onClick={() => onChange(s.name)}
              title={s.description || s.name}
              style={{ display:'flex', alignItems:'center', gap:'8px', padding:'10px 16px', borderRadius:'10px', cursor:'pointer', border:`2px solid ${sel ? meta.color : '#E2E8F0'}`, background: sel ? meta.bg : 'white', transition:'all 0.15s' }}>
              <span style={{ fontSize:'18px' }}>{meta.icon}</span>
              <div>
                <div style={{ fontSize:'13px', fontWeight: sel ? '700' : '500', color: sel ? meta.color : NAVY2 }}>{s.name}</div>
                <div style={{ fontSize:'10px', color:'#94A3B8' }}>{s.type}</div>
              </div>
              {sel && <span style={{ marginLeft:'4px', fontSize:'14px', color: meta.color }}>✓</span>}
            </div>
          )
        })}
      </div>
      {value && (() => {
        const matched = brands.find((s: any) => s.name === value)
        if (!matched) return null
        const meta = STOKVEL_TYPE_COLORS[matched.type] || STOKVEL_TYPE_COLORS.GENERAL
        return (
          <div style={{ background: meta.bg, border:`1px solid ${meta.color}30`, borderRadius:'8px', padding:'10px 14px', fontSize:'12px', color: meta.color }}>
            <strong>{meta.icon} {matched.name}</strong> — {matched.description}
          </div>
        )
      })()}
      {!value && <p style={{ fontSize:'11px', color:'#DC2626', margin:0 }}>⚠️ Branding is required</p>}
    </div>
  )
}


export default function GroupsPage() {
  const [view, setView]                 = useState<'list'|'detail'|'create'>('list')
  const [groups, setGroups]             = useState<any[]>([])
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<any>(null)
  const [detailTab, setDetailTab]       = useState('overview')
  const [search, setSearch]             = useState('')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteGroupId, setInviteGroupId]     = useState<string|null>(null)
  const [currentUserId, setCurrentUserId]     = useState<string>('')

  // Get current user ID and fetch all stokvel brands on mount
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => { if (d.success && d.data?.id) setCurrentUserId(d.data.id) })
      .catch(() => {})
    // Fetch all brands upfront so the overview banner can look them up
    fetch('/api/reference?type=stokvel-brands')
      .then(r => r.json())
      .then(d => { if (d.success) setAllBrands(d.data) })
      .catch(() => {})
  }, [])
  const [toast, setToast]               = useState<{msg:string; type:'success'|'error'}|null>(null)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [formError, setFormError]       = useState('')
  const [location, setLocation]          = useState({ countryCode:'', provinceCode:'', city:'', currency:'' })
  const [groupMembers, setGroupMembers]  = useState<any[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [editForm, setEditForm]          = useState<any>(null)
  const [editSaving, setEditSaving]      = useState(false)
  const [editLocation, setEditLocation]  = useState({ countryCode:'', provinceCode:'', city:'', currency:'' })
  const [deleteSaving, setDeleteSaving]  = useState(false)
  const [deleteCheck, setDeleteCheck]    = useState<any>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [openAccordion, setOpenAccordion]  = useState<string[]>(['group-details'])
  const [allBrands, setAllBrands]          = useState<any[]>([])

  // ── Update group ─────────────────────────────────────────────
  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    setEditSaving(true)
    try {
      const res  = await fetch('/api/groups', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...editForm,
          contributionAmount:  parseFloat(editForm.contributionAmount),
          contributionDay:     parseInt(editForm.contributionDay),
          maxMembers:          parseInt(editForm.maxMembers),
          penaltyRate:         parseFloat(editForm.penaltyRate) / 100,
          insurancePoolPct:    parseFloat(editForm.insurancePoolPct) / 100,
          country:             editLocation.countryCode || editForm.country,
          region:              editLocation.provinceCode || editLocation.city || editForm.region,
          branding:            editForm.branding || '',
          currency:            editLocation.currency || editForm.currency,
          city:                editLocation.city     || editForm.city        || null,
          zipCode:             editForm.zipCode      || null,
          treasurerId:         editForm.treasurerId  || null,
          secretaryId:         editForm.secretaryId  || null,
          groupType:           editForm.groupType    || 'PRIVATE',
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(data.message)
        // Immediately update selectedGroup with the saved values so the UI reflects changes
        const saved = {
          ...editForm,
          contributionAmount:  parseFloat(editForm.contributionAmount),
          contributionDay:     parseInt(editForm.contributionDay),
          maxMembers:          parseInt(editForm.maxMembers),
          penaltyRate:         parseFloat(editForm.penaltyRate) / 100,
          insurancePoolPct:    parseFloat(editForm.insurancePoolPct) / 100,
          country:             editLocation.countryCode || editForm.country,
          region:              editLocation.provinceCode || editLocation.city || editForm.region,
          branding:            editForm.branding || '',
          currency:            editLocation.currency || editForm.currency,
          groupType:           editForm.groupType || 'PRIVATE',
        }
        setSelectedGroup((prev: any) => ({ ...prev, ...saved }))
        // Also refresh groups list in background
        fetchGroups()
      }
      else { console.error('Update failed:', data); showToast(data.error || 'Update failed', 'error') }
    } catch { showToast('Network error', 'error') }
    finally { setEditSaving(false) }
  }

  // ── Delete — pre-check ────────────────────────────────────────
  async function handleDeleteCheck(groupId: string) {
    setDeleteSaving(true); setDeleteCheck(null); setDeleteConfirmName('')
    try {
      const res  = await fetch('/api/groups?id=' + groupId, { method: 'DELETE' })
      const data = await res.json()
      setDeleteCheck({ ...data, id: groupId })
    } catch { showToast('Network error', 'error') }
    finally { setDeleteSaving(false) }
  }

  // ── Delete — confirmed ────────────────────────────────────────
  async function handleDeleteConfirm() {
    if (!deleteCheck) return
    setDeleteSaving(true)
    try {
      const res  = await fetch(
        '/api/groups?id=' + deleteCheck.id + '&confirmName=' + encodeURIComponent(deleteConfirmName) + '&force=true',
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (data.success) {
        showToast(data.message)
        setDeleteCheck(null); setDeleteConfirmName('')
        setView('list'); fetchGroups()
      } else {
        showToast(data.error || 'Deletion failed', 'error')
      }
    } catch { showToast('Network error', 'error') }
    finally { setDeleteSaving(false) }
  }

  // ── Fetch members for selected group ────────────────────────
  const fetchGroupMembers = useCallback(async (groupId: string) => {
    setMembersLoading(true)
    try {
      const res  = await fetch(`/api/members?groupId=${groupId}`)
      const data = await res.json()
      if (data.success) {
        const members = data.data || []
        // Normalise: ensure every member has a userId field
        const normalised = members.map((m: any) => ({
          ...m,
          userId: m.userId || m.user?.id || m.id,
          fullName: m.fullName || m.user?.fullName || m.name || '?',
        }))
        setGroupMembers(normalised)
      } else setGroupMembers([])
    } catch { setGroupMembers([]) }
    finally { setMembersLoading(false) }
  }, [])

  // ── Change group status ─────────────────────────────────────
  async function handleStatusChange(groupId: string, newStatus: string, groupName: string) {
    try {
      const group = groups.find(g => g.id === groupId)
      if (!group) return
      const res  = await fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Send all required fields, just change status
          id: groupId, status: newStatus,
          name: group.name, description: group.description||'',
          currency: group.currency, contributionAmount: group.contributionAmount,
          contributionDay: group.contributionDay, contributionFrequency: group.contributionFrequency,
          maxMembers: group.maxMembers, penaltyRate: group.penaltyRate,
          insurancePoolPct: group.insurancePoolPct, payoutStrategy: group.payoutStrategy,
          country: group.country||'', region: group.region||'',
          branding: group.branding||'', city: group.city||'', zipCode: group.zipCode||'',
          treasurerId: group.treasurerId||'', secretaryId: group.secretaryId||'',
          groupType: group.groupType||'PRIVATE',
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(`"${groupName}" is now ${newStatus}`)
        setSelectedGroup((prev: any) => prev ? { ...prev, status: newStatus } : prev)
        fetchGroups()
      } else {
        showToast(data.error || 'Status change failed', 'error')
      }
    } catch { showToast('Network error', 'error') }
  }

  // ── Fetch groups ─────────────────────────────────────────────
  const fetchGroups = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/groups')
      const data = await res.json()
      if (data.success) {
        setGroups(data.data)
        // If viewing a group detail, refresh selectedGroup too
        setSelectedGroup((prev: any) => {
          if (!prev) return prev
          const updated = data.data.find((g: any) => g.id === prev.id)
          return updated || prev
        })
      } else showToast(data.error || 'Failed to load groups', 'error')
    } catch {
      showToast('Network error loading groups', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchGroups() }, [fetchGroups])

  // Auto-fetch members when a group detail is opened
  useEffect(() => {
    if (selectedGroup) {
      setGroupMembers([])
      fetchGroupMembers(selectedGroup.id)
    }
  }, [selectedGroup?.id])

  function showToast(msg: string, type: 'success'|'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const filtered = groups.filter(g => {
    const matchSearch = g.name.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'ALL' || g.status === filterStatus
    return matchSearch && matchStatus
  })

  // ── Create group ────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) return setFormError('Group name is required')
    setSaving(true)
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                form.name.trim(),
          description:         form.description.trim(),
          currency:            location.currency || form.currency,
          contributionAmount:  0,
          contributionDay:     parseInt(form.contributionDay),
          contributionFrequency: form.contributionFrequency,
          maxMembers:          parseInt(form.maxMembers),
          penaltyRate:         parseFloat(form.penaltyRate) / 100,
          insurancePoolPct:    parseFloat(form.insurancePoolPct) / 100,
          payoutStrategy:      form.payoutStrategy,
          country:             location.countryCode || form.country.trim(),
          region:              location.provinceCode || form.region.trim(),
          city:                location.city         || form.city   || null,
          zipCode:             form.zipCode          || null,
          branding:            form.branding,
          treasurerId:         null,
          secretaryId:         null,
          groupType:           form.groupType || 'PRIVATE',
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(data.message || 'Group created successfully!')
        setForm(EMPTY_FORM)
        setView('list')
        fetchGroups() // Refresh list
      } else {
        setFormError(data.error || 'Failed to create group')
      }
    } catch {
      setFormError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── LIST VIEW ───────────────────────────────────────────────
  if (view === 'list') return (
    <div style={{ display:'flex', flexDirection:'column', gap:'20px' }}>

      {/* Toast */}
      <VersionBadge label="👥 Groups" ver="v1.3" />
      {toast && (
        <div style={{ position:'fixed', top:'20px', right:'20px', zIndex:9999, padding:'12px 20px', borderRadius:'10px', fontWeight:'500', fontSize:'13px', boxShadow:'0 8px 25px rgba(0,0,0,0.15)', background: toast.type==='success'?'#166534':'#991B1B', color:'white' }}>
          {toast.type==='success'?'✅':'❌'} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h2 style={{ fontSize:'20px', fontWeight:'700', color:NAVY, margin:'0 0 4px' }}>Groups</h2>
          <p style={{ fontSize:'13px', color:'#64748B', margin:0 }}>
            {loading ? 'Loading...' : `${groups.length} groups · ${groups.filter(g=>g.status==='ACTIVE').length} active`}
          </p>
        </div>
        <button onClick={() => setView('create')} style={{ background:TEAL, color:'white', border:'none', borderRadius:'8px', padding:'10px 18px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
          + Create Group
        </button>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap' }}>
        <input placeholder="Search groups..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding:'8px 14px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', width:'240px', outline:'none' }}
        />
        {['ALL','ACTIVE','DRAFT','PAUSED','COMPLETED'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{
            padding:'6px 14px', borderRadius:'999px', fontSize:'12px', fontWeight:'500', cursor:'pointer',
            background: filterStatus===s ? TEAL : 'white',
            color: filterStatus===s ? 'white' : '#64748B',
            border: filterStatus===s ? 'none' : '1.5px solid #E2E8F0',
          }}>{s}</button>
        ))}
        <button onClick={fetchGroups} style={{ padding:'6px 12px', borderRadius:'8px', fontSize:'12px', cursor:'pointer', background:'#F1F5F9', border:'1.5px solid #E2E8F0', color:'#475569' }}>
          ↻ Refresh
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'12px' }}>
        {[
          { label:'Total Groups',  value: loading ? '—' : groups.length,                                         color: TEAL    },
          { label:'Active Groups', value: loading ? '—' : groups.filter(g=>g.status==='ACTIVE').length,          color:'#166534'},
          { label:'Total Members', value: loading ? '—' : groups.reduce((s:number,g:any)=>s+g.memberCount,0),   color: BLUE    },
          { label:'Total Escrow',  value: loading ? '—' : `$${groups.reduce((s:number,g:any)=>s+g.escrowBalance,0).toLocaleString()}`, color:'#B45309'},
        ].map(s => (
          <div key={s.label} style={{ background:'white', borderRadius:'10px', padding:'14px 16px', border:'1px solid #E2E8F0' }}>
            <div style={{ fontSize:'11px', color:'#64748B', marginBottom:'4px' }}>{s.label}</div>
            <div style={{ fontSize:'22px', fontWeight:'700', color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'32px', marginBottom:'12px' }}>⏳</div>
          <p style={{ color:'#64748B', fontSize:'14px' }}>Loading groups from database...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'48px', marginBottom:'12px' }}>👥</div>
          <h3 style={{ fontSize:'16px', fontWeight:'600', color:NAVY, margin:'0 0 8px' }}>
            {search || filterStatus !== 'ALL' ? 'No groups match your filter' : 'No groups yet'}
          </h3>
          <p style={{ color:'#64748B', fontSize:'13px', marginBottom:'20px' }}>
            {search || filterStatus !== 'ALL' ? 'Try adjusting your search or filter.' : 'Create your first savings group to get started.'}
          </p>
          {!search && filterStatus === 'ALL' && (
            <button onClick={() => setView('create')} style={{ padding:'10px 20px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
              + Create First Group
            </button>
          )}
        </div>
      )}

      {/* Group table */}
      {!loading && filtered.length > 0 && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#F8FAFC', borderBottom:'1px solid #E2E8F0' }}>
                {['Group','Location','Type','Status','Members','Contribution','Pool','Escrow','Strategy','Cycle','Actions'].map(h => (
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:'11px', fontWeight:'600', color:'#64748B', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((g: any, i: number) => {
                const curr = g.currency === 'USD' ? '$' : g.currency
                return (
                  <tr key={g.id}
                    onClick={() => { setSelectedGroup(g); setView('detail'); setDetailTab('overview') }}
                    style={{ borderBottom:'1px solid #F8FAFC', background: i % 2 === 0 ? 'white' : '#FAFAFA', cursor:'pointer', transition:'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#F0FDF4')}
                    onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#FAFAFA')}
                  >
                    {/* Group name */}
                    <td style={{ padding:'12px 14px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                        <div style={{ width:'32px', height:'32px', borderRadius:'8px', background: g.status==='ACTIVE' ? `linear-gradient(135deg,${NAVY},${TEAL})` : '#F1F5F9', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', flexShrink:0 }}>👥</div>
                        <div>
                          <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY }}>{g.name}</div>
                          <div style={{ fontSize:'11px', color:'#94A3B8' }}>Admin: {g.adminName}</div>
                        </div>
                      </div>
                    </td>

                    {/* Location */}
                    <td style={{ padding:'12px 14px', fontSize:'12px', color:'#475569', whiteSpace:'nowrap' }}>
                      {g.region && g.country ? `${g.region}, ${g.country}` : g.country || '—'}
                    </td>

                    {/* Group Type */}
                    <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}>
                      {groupTypeBadge(g.groupType || 'PRIVATE')}
                    </td>

                    {/* Status */}
                    <td style={{ padding:'12px 14px' }}>{statusBadge(g.status)}</td>

                    {/* Members */}
                    <td style={{ padding:'12px 14px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                        <div style={{ flex:1, height:'5px', background:'#F1F5F9', borderRadius:'3px', overflow:'hidden', minWidth:'40px' }}>
                          <div style={{ height:'100%', background:TEAL, borderRadius:'3px', width:`${Math.min(100, g.memberCount / g.maxMembers * 100)}%` }} />
                        </div>
                        <span style={{ fontSize:'12px', fontWeight:'600', color:NAVY, whiteSpace:'nowrap' }}>{g.memberCount}/{g.maxMembers}</span>
                      </div>
                    </td>

                    {/* Contribution */}
                    <td style={{ padding:'12px 14px', fontSize:'13px', fontWeight:'600', color:TEAL, whiteSpace:'nowrap' }}>
                      {curr}{g.contributionAmount}/mo
                    </td>

                    {/* Monthly pool */}
                    <td style={{ padding:'12px 14px', fontSize:'13px', fontWeight:'600', color:NAVY, whiteSpace:'nowrap' }}>
                      {curr}{(g.contributionAmount * g.memberCount).toLocaleString()}
                    </td>

                    {/* Escrow */}
                    <td style={{ padding:'12px 14px', fontSize:'12px', color:'#475569', whiteSpace:'nowrap' }}>
                      {curr}{g.escrowBalance.toLocaleString()}
                    </td>

                    {/* Strategy */}
                    <td style={{ padding:'12px 14px', fontSize:'11px', color:'#64748B', whiteSpace:'nowrap' }}>
                      {g.payoutStrategy?.replace(/_/g,' ')}
                    </td>

                    {/* Cycle */}
                    <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}>
                      {g.activeCycle ? (
                        <span style={{ background:'#DCFCE7', color:'#166534', fontSize:'10px', fontWeight:'600', padding:'2px 7px', borderRadius:'4px' }}>
                          Cycle {g.activeCycle.cycleNumber}
                        </span>
                      ) : (
                        <span style={{ fontSize:'11px', color:'#94A3B8' }}>No cycle</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ padding:'12px 14px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display:'flex', gap:'5px' }}>
                        <button
                          onClick={() => { setSelectedGroup(g); setView('detail'); setDetailTab('overview') }}
                          style={{ padding:'4px 10px', background:'#F1F5F9', border:'none', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#475569', fontWeight:'500' }}>
                          Open
                        </button>
                        <button
                          onClick={() => { setInviteGroupId(g.id); setShowInviteModal(true) }}
                          style={{ padding:'4px 10px', background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#166534', fontWeight:'500', whiteSpace:'nowrap' }}>
                          + Invite
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Row count footer */}
          <div style={{ padding:'10px 16px', borderTop:'1px solid #F1F5F9', background:'#FAFAFA', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:'12px', color:'#94A3B8' }}>
              Showing {filtered.length} of {groups.length} group{groups.length !== 1 ? 's' : ''}
            </span>
            {filtered.length < groups.length && (
              <button onClick={() => { setSearch(''); setFilterStatus('ALL') }}
                style={{ fontSize:'12px', color:TEAL, background:'none', border:'none', cursor:'pointer' }}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )

  // ── CREATE VIEW ─────────────────────────────────────────────
  if (view === 'create') return (
    <div style={{ maxWidth:'720px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'24px' }}>
        <button onClick={() => { setView('list'); setFormError(''); setForm(EMPTY_FORM) }}
          style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', padding:'8px 14px', cursor:'pointer', fontSize:'13px', color:'#475569' }}>← Back</button>
        <div>
          <h2 style={{ fontSize:'20px', fontWeight:'700', color:NAVY, margin:'0 0 2px' }}>Create New Group</h2>
          <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>Set up a new stokvel savings group</p>
        </div>
      </div>

      {formError && (
        <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'10px', padding:'12px 16px', marginBottom:'16px', color:'#991B1B', fontSize:'13px' }}>
          ❌ {formError}
        </div>
      )}

      <form onSubmit={handleCreate}>
        <div style={{ borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden', background:'white' }}>

          {/* Accordion uses same openAccordion state */}
          {[
            { id:'cr-details',  icon:'📋', label:'Group Details',  required:true  },
            { id:'cr-members',  icon:'👥', label:'Members',        required:false },
            { id:'cr-location', icon:'📍', label:'Location',       required:true  },
            { id:'cr-currency', icon:'💱', label:'Currency',       required:false },
            { id:'cr-branding', icon:'🏷️', label:'Branding',      required:true  },
          ].map((sec, si) => {
            const isOpen = openAccordion.includes(sec.id)
            const toggle = () => setOpenAccordion((prev: string[]) =>
              prev.includes(sec.id) ? prev.filter((x:string) => x !== sec.id) : [...prev, sec.id]
            )
            const INPUT:  React.CSSProperties = { width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' }
            const LABEL:  React.CSSProperties = { display:'block', fontSize:'11px', fontWeight:'600', color:'#64748B', marginBottom:'4px', textTransform:'uppercase', letterSpacing:'0.04em' }
            const GRID2:  React.CSSProperties = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }

            return (
              <div key={sec.id}>
                <button type="button" onClick={toggle}
                  style={{ width:'100%', display:'flex', alignItems:'center', gap:'10px', padding:'14px 18px',
                    background: isOpen ? '#F8FAFC' : 'white',
                    border:'none', borderTop: si > 0 ? '1px solid #F1F5F9' : 'none',
                    cursor:'pointer', textAlign:'left' as any }}>
                  <span style={{ fontSize:'16px' }}>{sec.icon}</span>
                  <span style={{ flex:1, fontSize:'13px', fontWeight:'600', color:NAVY }}>{sec.label}</span>
                  {sec.required && <span style={{ fontSize:'10px', color:'#DC2626', fontWeight:'600', background:'#FEF2F2', padding:'1px 6px', borderRadius:'4px' }}>Required</span>}
                  <span style={{ fontSize:'11px', color:'#94A3B8', display:'inline-block',
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s' }}>▼</span>
                </button>

                {isOpen && (
                  <div style={{ padding:'16px 18px 20px', borderTop:'1px solid #F1F5F9', background:'#FAFBFC' }}>

                    {/* ── Group Details ── */}
                    {sec.id === 'cr-details' && (
                      <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                        <div>
                          <label style={LABEL}>Group Name *</label>
                          <input type="text" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required
                            placeholder="e.g. Harare Builders Circle"
                            style={INPUT}/>
                        </div>
                        <div>
                          <label style={LABEL}>Description</label>
                          <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}
                            placeholder="What is this group about?" rows={3}
                            style={{...INPUT, resize:'vertical' as any}}/>
                        </div>
                        <div style={GRID2}>
                          <div>
                            <label style={LABEL}>Max Members</label>
                            <input type="number" min="2" max="500" value={form.maxMembers}
                              onChange={e=>setForm(f=>({...f,maxMembers:e.target.value}))}
                              style={INPUT}/>
                          </div>
                          <div>
                            <label style={LABEL}>Payout Strategy</label>
                            <select value={form.payoutStrategy} onChange={e=>setForm(f=>({...f,payoutStrategy:e.target.value}))}
                              style={{...INPUT, background:'white'}}>
                              {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label style={LABEL}>Group Visibility</label>
                          <GroupTypeSwitch
                            value={form.groupType as 'PRIVATE'|'PUBLIC'}
                            onChange={v => setForm(f => ({...f, groupType: v}))}
                          />
                        </div>
                      </div>
                    )}

                    {/* ── Members ── */}
                    {sec.id === 'cr-members' && (
                      <div style={GRID2}>
                        <div style={{ gridColumn:'1/-1' }}>
                          <div style={{ padding:'10px 12px', background:'#EEF2FF', borderRadius:'8px', fontSize:'12px', color:'#3730A3' }}>
                            ℹ️ Treasurer and Secretary can be assigned after adding members via the Invite flow.
                          </div>
                        </div>
                        <div>
                          <label style={LABEL}>Treasurer</label>
                          <input type="text" disabled placeholder="Assign after inviting members"
                            style={{...INPUT, background:'#F8FAFC', color:'#94A3B8', cursor:'not-allowed'}}/>
                        </div>
                        <div>
                          <label style={LABEL}>Secretary</label>
                          <input type="text" disabled placeholder="Assign after inviting members"
                            style={{...INPUT, background:'#F8FAFC', color:'#94A3B8', cursor:'not-allowed'}}/>
                        </div>
                      </div>
                    )}

                    {/* ── Location ── */}
                    {sec.id === 'cr-location' && (
                      <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                        <CountrySelector
                          value={location}
                          onChange={r => { setLocation(r); setForm(f=>({...f,country:r.countryCode,region:r.provinceName||'',city:r.city||'',currency:r.currency,branding:''})) }}
                          onNameSuggested={name => setForm(f=>({...f,name}))}
                        />
                        <div style={GRID2}>
                          <div>
                            <label style={LABEL}>City</label>
                            <input type="text" value={form.city||''} onChange={e=>setForm(f=>({...f,city:e.target.value}))}
                              placeholder="e.g. Harare" style={INPUT}/>
                          </div>
                          <div>
                            <label style={LABEL}>ZIP / Postcode</label>
                            <input type="text" value={form.zipCode||''} onChange={e=>setForm(f=>({...f,zipCode:e.target.value}))}
                              placeholder="e.g. 00263" style={INPUT}/>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Currency ── */}
                    {sec.id === 'cr-currency' && (
                      <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                        <div>
                          <label style={LABEL}>Group Currency</label>
                          {location.currency ? (
                            <div style={{ padding:'9px 12px', border:'1.5px solid #BBF7D0', borderRadius:'8px', fontSize:'13px', fontWeight:'600', color:'#166534', background:'#F0FDF4', display:'flex', alignItems:'center', gap:'8px' }}>
                              <span>💱</span> {location.currency} <span style={{ fontSize:'11px', fontWeight:'400', color:'#64748B', marginLeft:'4px' }}>— set from country selection</span>
                            </div>
                          ) : (
                            <div style={{ padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', color:'#94A3B8', background:'#F8FAFC' }}>
                              Select a country in Location to auto-fill currency
                            </div>
                          )}
                        </div>
                        {/* Pool preview */}
                        {form.contributionAmount && form.maxMembers && (
                          <div style={{ background:'#F0FDF4', borderRadius:'8px', padding:'12px 16px', border:'1px solid #BBF7D0' }}>
                            <div style={{ fontSize:'11px', fontWeight:'600', color:'#166534', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'8px' }}>📊 Pool Preview</div>
                            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px' }}>
                              {[
                                { l:'Monthly Pool',   v:`$${(parseFloat(form.contributionAmount||'0')*parseInt(form.maxMembers||'0')).toLocaleString()}` },
                                { l:'Insurance/mo',   v:`$${(parseFloat(form.contributionAmount||'0')*parseInt(form.maxMembers||'0')*parseFloat(form.insurancePoolPct||'0')/100).toFixed(2)}` },
                                { l:'Platform Fee',   v:`$${(parseFloat(form.contributionAmount||'0')*parseInt(form.maxMembers||'0')*0.02).toFixed(2)}` },
                              ].map(item => (
                                <div key={item.l}>
                                  <div style={{ fontSize:'10px', color:'#166534', opacity:0.7 }}>{item.l}</div>
                                  <div style={{ fontSize:'15px', fontWeight:'700', color:'#166534' }}>{item.v}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Branding ── */}
                    {sec.id === 'cr-branding' && (
                      <div>
                        <p style={{ fontSize:'12px', color:'#64748B', margin:'0 0 12px', lineHeight:'1.5' }}>
                          Select the local savings tradition that best represents this group. This branding appears prominently on the group dashboard.
                        </p>
                        {location.countryCode ? (
                          <BrandingSelector
                            countryCode={location.countryCode}
                            value={form.branding}
                            onChange={b => setForm(f=>({...f,branding:b}))}
                          />
                        ) : (
                          <div style={{ padding:'12px 14px', background:'#FEF9C3', borderRadius:'8px', fontSize:'12px', color:'#854D0E', border:'1px solid #FCD34D' }}>
                            ⚠️ Open the Location section and select a country to see local branding options.
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                )}
              </div>
            )
          })}

          {/* Error */}
          {formError && (
            <div style={{ margin:'0 18px 12px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'8px', padding:'10px 14px', color:'#991B1B', fontSize:'12px' }}>
              ❌ {formError}
            </div>
          )}

          {/* Submit bar */}
          <div style={{ padding:'14px 18px', borderTop:'2px solid #E2E8F0', background:'white', display:'flex', gap:'10px' }}>
            <button type="button" onClick={() => { setView('list'); setFormError(''); setForm(EMPTY_FORM); setLocation({ countryCode:'', provinceCode:'', city:'', currency:'' }) }}
              style={{ padding:'10px 20px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#475569', fontWeight:'500' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              style={{ flex:1, padding:'10px', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600',
                cursor:saving?'not-allowed':'pointer',
                background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`, color:'white' }}>
              {saving ? '⏳ Creating...' : '✓ Create Group'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )

  // ── DETAIL VIEW ─────────────────────────────────────────────
  if (view === 'detail' && selectedGroup) {
    const g = selectedGroup
    const TABS = ['overview','members','schemes','cycle','settings']

    return (
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => setView('list')} style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', padding:'8px 14px', cursor:'pointer', fontSize:'13px', color:'#475569' }}>← Back</button>
          {g.status === 'DRAFT' && (
            <button onClick={() => handleStatusChange(g.id, 'ACTIVE', g.name)}
              style={{ padding:'8px 16px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
              ▶️ Activate Group
            </button>
          )}
          {g.status === 'ACTIVE' && (
            <button onClick={() => handleStatusChange(g.id, 'PAUSED', g.name)}
              style={{ padding:'8px 16px', background:'#FEF9C3', color:'#854D0E', border:'1.5px solid #FCD34D', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
              ⏸️ Pause Group
            </button>
          )}
          {g.status === 'PAUSED' && (
            <button onClick={() => handleStatusChange(g.id, 'ACTIVE', g.name)}
              style={{ padding:'8px 16px', background:'#DCFCE7', color:'#166534', border:'1.5px solid #BBF7D0', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
              ▶️ Reactivate Group
            </button>
          )}
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
              <h2 style={{ fontSize:'18px', fontWeight:'700', color:NAVY, margin:0 }}>{g.name}</h2>
              {statusBadge(g.status)}
              {groupTypeBadge(g.groupType || 'PRIVATE')}
            </div>
            <p style={{ fontSize:'12px', color:'#64748B', margin:'2px 0 0' }}>
              {g.region && g.country ? `${g.region}, ${g.country} · ` : ''}{g.currency} · {g.payoutStrategy.replace('_',' ')} · Admin: {g.adminName}
            </p>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={() => { setInviteGroupId(g.id); setShowInviteModal(true) }} style={{ padding:'8px 14px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', fontWeight:'500' }}>+ Invite Member</button>
          </div>
        </div>
  
        {/* Tabs */}
        <div style={{ display:'flex', gap:'0', borderBottom:'1px solid #E2E8F0' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => { setDetailTab(t); if (t === 'members' || t === 'schemes') fetchGroupMembers(g.id) }} style={{
              padding:'10px 18px', background:'none', border:'none',
              borderBottom: detailTab===t?`2px solid ${TEAL}`:'2px solid transparent',
              color: detailTab===t?TEAL:'#64748B', fontWeight: detailTab===t?'600':'400',
              fontSize:'13px', cursor:'pointer', textTransform:'capitalize', marginBottom:'-1px',
            }}>{t === 'schemes' ? '🌀 Windfall Schemes' : t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
  
        {/* Overview */}
        {detailTab==='overview' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>

            {/* ── Group Identity Banner ── */}
            {(() => {
              const branding    = g.branding || ''
              const countryCode = g.country  || ''
              const brandData   = allBrands.find((s: any) => s.name === branding && (!s.countryId || s.countryId === countryCode))
              const meta        = brandData ? (STOKVEL_TYPE_COLORS[brandData.type] || STOKVEL_TYPE_COLORS.GENERAL) : null
              return (
                <div style={{ background:`linear-gradient(135deg,${NAVY} 0%,#1A3A5C 100%)`, borderRadius:'16px', padding:'24px 28px', position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', right:'-20px', bottom:'-20px', fontSize:'120px', opacity:0.06, lineHeight:1, userSelect:'none', pointerEvents:'none', transform:'rotate(-10deg)' }}>
                    {meta ? meta.icon : '🌍'}
                  </div>
                  <div style={{ fontSize:'11px', fontWeight:'600', color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'6px' }}>Group Name</div>
                  <div style={{ fontSize:'24px', fontWeight:'700', color:'white', marginBottom:'16px', lineHeight:1.2 }}>{g.name}</div>
                  {branding && meta ? (
                    <div>
                      <div style={{ fontSize:'10px', fontWeight:'600', color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'6px' }}>Group Branding</div>
                      <div style={{ display:'inline-flex', alignItems:'center', gap:'10px', background:meta.bg, borderRadius:'12px', padding:'10px 18px' }}>
                        <span style={{ fontSize:'24px' }}>{meta.icon}</span>
                        <div>
                          <div style={{ fontSize:'26px', fontWeight:'900', color:meta.color, letterSpacing:'-0.5px', lineHeight:1 }}>{branding}</div>
                          {brandData.type && <div style={{ fontSize:'11px', color:meta.color, opacity:0.7, marginTop:'2px' }}>{brandData.type}</div>}
                        </div>
                      </div>
                      {brandData.description && <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.5)', marginTop:'10px', fontStyle:'italic' }}>"{brandData.description}"</div>}
                    </div>
                  ) : (
                    <div style={{ display:'inline-flex', alignItems:'center', gap:'8px', background:'rgba(255,165,0,0.15)', border:'1px solid rgba(255,165,0,0.4)', borderRadius:'8px', padding:'8px 14px' }}>
                      <span style={{ fontSize:'14px' }}>⚠️</span>
                      <span style={{ fontSize:'12px', color:'rgba(255,165,0,0.9)' }}>No branding selected — go to Settings tab to add one</span>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* ── KPI strip ── */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px' }}>
              {[
                { label:'Members',        value:`${g.memberCount}/${g.maxMembers}`,                           color:NAVY   },
                { label:'Escrow Balance', value:`$${Number(g.escrowBalance||0).toLocaleString()}`,            color:TEAL   },
                { label:'Country',        value: g.country || '—',                                           color:BLUE   },
                { label:'Status',         value: g.status,                                                   color:'#166534' },
                { label:'Group Type',     value: g.groupType === 'PUBLIC' ? '🌐 Public' : '🔒 Private',     color: g.groupType === 'PUBLIC' ? '#1D4ED8' : '#475569' },
              ].map(s => (
                <div key={s.label} style={{ background:'white', borderRadius:'10px', padding:'14px', border:'1px solid #E2E8F0', textAlign:'center' }}>
                  <div style={{ fontSize:'10px', color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'4px' }}>{s.label}</div>
                  <div style={{ fontSize:'16px', fontWeight:'700', color:s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* ── Status callout ── */}
            {g.status === 'DRAFT' && (
              <div style={{ background:'#EEF2FF', borderRadius:'12px', padding:'14px 18px', border:'1px solid #C7D2FE', display:'flex', alignItems:'center', gap:'12px' }}>
                <span style={{ fontSize:'24px' }}>⚙️</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'13px', fontWeight:'600', color:'#3730A3', marginBottom:'2px' }}>Group is in Draft</div>
                  <div style={{ fontSize:'12px', color:'#64748B' }}>Add members, configure settings, then activate the group to start collecting contributions and running schemes.</div>
                </div>
                <button onClick={() => handleStatusChange(g.id, 'ACTIVE', g.name)}
                  style={{ padding:'9px 18px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer', flexShrink:0 }}>
                  ▶️ Activate Now
                </button>
              </div>
            )}
            {g.status === 'PAUSED' && (
              <div style={{ background:'#FEF9C3', borderRadius:'12px', padding:'14px 18px', border:'1px solid #FCD34D', display:'flex', alignItems:'center', gap:'12px' }}>
                <span style={{ fontSize:'24px' }}>⏸️</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'13px', fontWeight:'600', color:'#854D0E', marginBottom:'2px' }}>Group is Paused</div>
                  <div style={{ fontSize:'12px', color:'#64748B' }}>New contributions and scheme activities are on hold. Reactivate when ready to resume.</div>
                </div>
                <button onClick={() => handleStatusChange(g.id, 'ACTIVE', g.name)}
                  style={{ padding:'9px 18px', background:'#166534', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer', flexShrink:0 }}>
                  ▶️ Reactivate
                </button>
              </div>
            )}

            {/* ── Accordion sections ── */}
            {(() => {
              const OV_SECTIONS = [
                { id:'ov-details',  icon:'📋', label:'Group Details'  },
                { id:'ov-members',  icon:'👥', label:'Members'        },
                { id:'ov-location', icon:'📍', label:'Location'       },
                { id:'ov-currency', icon:'💱', label:'Currency'       },
                { id:'ov-dates',    icon:'📅', label:'Dates'          },
              ]
              const isOpen = (id: string) => openAccordion.includes(id)
              const toggle = (id: string) => setOpenAccordion((prev: string[]) =>
                prev.includes(id) ? prev.filter((x: string) => x !== id) : [...prev, id]
              )
              const ROW: React.CSSProperties = { display:'grid', gridTemplateColumns:'180px 1fr', gap:'8px', alignItems:'flex-start', padding:'9px 0', borderBottom:'1px solid #F1F5F9' }
              const DLABEL: React.CSSProperties = { color:'#64748B', fontSize:'12px', fontWeight:'500', paddingTop:'1px' }
              const SEP: React.CSSProperties    = { color:'#CBD5E1', fontSize:'12px', paddingTop:'1px' }
              const DVALUE: React.CSSProperties = { color:NAVY, fontSize:'13px', fontWeight:'500', wordBreak:'break-word' as any }

              return (
                <div style={{ borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden', background:'white' }}>
                  {OV_SECTIONS.map((sec, si) => (
                    <div key={sec.id}>
                      <button type="button" onClick={() => toggle(sec.id)}
                        style={{ width:'100%', display:'flex', alignItems:'center', gap:'10px', padding:'13px 16px',
                          background: isOpen(sec.id) ? '#F8FAFC' : 'white',
                          border:'none', borderTop: si > 0 ? '1px solid #F1F5F9' : 'none',
                          cursor:'pointer', textAlign:'left' as any }}>
                        <span style={{ fontSize:'15px' }}>{sec.icon}</span>
                        <span style={{ flex:1, fontSize:'13px', fontWeight:'600', color:NAVY }}>{sec.label}</span>
                        <span style={{ fontSize:'11px', color:'#94A3B8', display:'inline-block',
                          transform: isOpen(sec.id) ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s' }}>▼</span>
                      </button>

                      {isOpen(sec.id) && (
                        <div style={{ padding:'12px 16px 16px', borderTop:'1px solid #F1F5F9', background:'#FAFBFC' }}>

                          {sec.id === 'ov-details' && (
                            <div>
                              {[
                                ['Name',        g.name],
                                ['Description', g.description || '—'],
                                ['Admin',       g.adminName],
                                ['Status',      g.status],
                                ['Group Type',  g.groupType === 'PUBLIC' ? '🌐 Public — open to join requests' : '🔒 Private — invitation only'],
                              ].map(([l,v]) => (
                                <div key={l as string} style={ROW}>
                                  <span style={DLABEL}>{l}</span>
                                  <span style={DVALUE}>: &nbsp;{v}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {sec.id === 'ov-members' && (
                            <div>
                              {[
                                ['Admin',        g.adminName],
                                ['Treasurer',    groupMembers.find((m:any)=>(m.userId||m.id)===g.treasurerId)?.fullName || '—'],
                                ['Secretary',    groupMembers.find((m:any)=>(m.userId||m.id)===g.secretaryId)?.fullName  || '—'],
                                ['Enrolled',     `${g.memberCount} members`],
                                ['Max Members',  g.maxMembers],
                                ['Vacancies',    Math.max(0, g.maxMembers - g.memberCount)],
                                ['Payout Order', g.payoutStrategy?.replace('_',' ')],
                              ].map(([l,v]) => (
                                <div key={l as string} style={ROW}>
                                  <span style={DLABEL}>{l}</span>
                                  <span style={DVALUE}>: &nbsp;{v}</span>
                                </div>
                              ))}
                              {/* Capacity bar */}
                              <div style={{ marginTop:'10px' }}>
                                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', color:'#94A3B8', marginBottom:'4px' }}>
                                  <span>Capacity</span>
                                  <span>{g.memberCount}/{g.maxMembers}</span>
                                </div>
                                <div style={{ height:'6px', background:'#F1F5F9', borderRadius:'3px', overflow:'hidden' }}>
                                  <div style={{ height:'100%', borderRadius:'3px', background:g.memberCount>=g.maxMembers?'#166534':TEAL,
                                    width:`${Math.min(100, g.memberCount/g.maxMembers*100)}%`, transition:'width 0.4s' }}/>
                                </div>
                              </div>
                            </div>
                          )}

                          {sec.id === 'ov-location' && (
                            <div>
                              {[
                                ['Country',      g.country || '—'],
                                ['State/Region', g.region  || '—'],
                                ['City',         g.city    || '—'],
                                ['ZIP/Postcode', g.zipCode || '—'],
                              ].map(([l,v]) => (
                                <div key={l as string} style={ROW}>
                                  <span style={DLABEL}>{l}</span>
                                  <span style={DVALUE}>: &nbsp;{v}</span>
                                </div>
                              ))}
                              {!g.country && (
                                <div style={{ marginTop:'8px', fontSize:'11px', color:'#854D0E', background:'#FEF9C3', padding:'7px 10px', borderRadius:'6px' }}>
                                  ⚠️ No location set — update in Settings tab
                                </div>
                              )}
                            </div>
                          )}

                          {sec.id === 'ov-currency' && (
                            <div>
                              {[
                                ['Group Currency',  g.currency],
                                ['Insurance Pool',  `${(g.insurancePoolPct*100).toFixed(1)}%`],
                                ['Platform Fee',    `${(g.platformFeePct*100).toFixed(0)}%`],
                                ['Escrow Balance',  `$${Number(g.escrowBalance||0).toLocaleString()}`],
                              ].map(([l,v]) => (
                                <div key={l as string} style={ROW}>
                                  <span style={DLABEL}>{l}</span>
                                  <span style={DVALUE}>: &nbsp;{v}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {sec.id === 'ov-dates' && (
                            <div>
                              {[
                                ['Date Created', g.createdAt ? new Date(g.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—'],
                                ['Last Updated', g.updatedAt ? new Date(g.updatedAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—'],
                                ['Date Closed',  '—'],
                              ].map(([l,v]) => (
                                <div key={l as string} style={ROW}>
                                  <span style={DLABEL}>{l}</span>
                                  <span style={DVALUE}>: &nbsp;{v}</span>
                                </div>
                              ))}
                            </div>
                          )}

                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* ── No cycle notice ── */}
            {!g.activeCycle && (
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'24px', textAlign:'center' }}>
                <div style={{ fontSize:'32px', marginBottom:'8px' }}>🔄</div>
                <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 6px' }}>No Active Cycle</h3>
                <p style={{ color:'#64748B', fontSize:'13px', marginBottom:'14px' }}>Add members first, then start the first cycle to begin collecting contributions and assigning payout positions.</p>
                <button style={{ padding:'9px 18px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>🚀 Start Cycle 1</button>
              </div>
            )}
          </div>
        )}

        {/* Members tab */}
        {detailTab==='members' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <span style={{ fontSize:'14px', fontWeight:'700', color:NAVY }}>
                  {membersLoading ? '...' : `${groupMembers.length} of ${g.maxMembers} members`}
                </span>
                {!membersLoading && groupMembers.length > 0 && (
                  <span style={{ marginLeft:'10px', fontSize:'12px', color:'#64748B' }}>
                    {g.maxMembers - groupMembers.length > 0
                      ? `${g.maxMembers - groupMembers.length} vacancies`
                      : '✅ Full'}
                  </span>
                )}
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={() => fetchGroupMembers(g.id)} style={{ padding:'6px 12px', background:'#F1F5F9', border:'1.5px solid #E2E8F0', borderRadius:'7px', fontSize:'12px', cursor:'pointer', color:'#475569' }}>↻ Refresh</button>
                <button onClick={() => { setInviteGroupId(g.id); setShowInviteModal(true) }} style={{ padding:'7px 14px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', fontWeight:'600' }}>+ Invite Member</button>
              </div>
            </div>

            {/* Capacity bar */}
            {g.maxMembers > 0 && (
              <div style={{ background:'white', borderRadius:'10px', border:'1px solid #E2E8F0', padding:'12px 16px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', color:'#64748B', marginBottom:'6px' }}>
                  <span>Capacity</span>
                  <span style={{ fontWeight:'600', color:NAVY }}>{groupMembers.length}/{g.maxMembers}</span>
                </div>
                <div style={{ height:'6px', background:'#F1F5F9', borderRadius:'3px', overflow:'hidden' }}>
                  <div style={{ height:'100%', borderRadius:'3px', background:groupMembers.length >= g.maxMembers ? '#166534' : TEAL, width:`${Math.min(100, groupMembers.length / g.maxMembers * 100)}%`, transition:'width 0.4s' }} />
                </div>
              </div>
            )}

            {/* Loading */}
            {membersLoading && (
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'40px', textAlign:'center', color:'#94A3B8', fontSize:'13px' }}>
                ⏳ Loading members...
              </div>
            )}

            {/* Empty state */}
            {!membersLoading && groupMembers.length === 0 && (
              <div style={{ background:'white', borderRadius:'12px', border:'1.5px dashed #E2E8F0', padding:'48px', textAlign:'center' }}>
                <div style={{ fontSize:'40px', marginBottom:'12px' }}>👥</div>
                <h4 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 6px' }}>No members yet</h4>
                <p style={{ fontSize:'13px', color:'#64748B', margin:'0 0 16px' }}>Invite members to join this group.</p>
                <button onClick={() => { setInviteGroupId(g.id); setShowInviteModal(true) }} style={{ padding:'9px 20px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>+ Invite First Member</button>
              </div>
            )}

            {/* Member list */}
            {!membersLoading && groupMembers.length > 0 && (
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ background:'#F8FAFC' }}>
                      {['#','Member','Contact','Country','Tier','KYC','Score','Status','Joined'].map(h => (
                        <th key={h} style={{ padding:'9px 12px', textAlign:'left', fontSize:'10px', fontWeight:'600', color:'#64748B', borderBottom:'1px solid #E2E8F0', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupMembers.map((m: any, idx: number) => {
                      const tierColors: Record<string,any> = {
                        BRONZE:   { bg:'#FEF3C7', color:'#92400E' },
                        SILVER:   { bg:'#F1F5F9', color:'#475569' },
                        GOLD:     { bg:'#FEF9C3', color:'#854D0E' },
                        PLATINUM: { bg:'#EEF2FF', color:'#3730A3' },
                      }
                      const kycColors: Record<string,any> = {
                        VERIFIED:     { bg:'#DCFCE7', color:'#166534', icon:'✅' },
                        PENDING:      { bg:'#FEF9C3', color:'#854D0E', icon:'⏳' },
                        UNDER_REVIEW: { bg:'#DBEAFE', color:'#1E3A8A', icon:'🔍' },
                        REJECTED:     { bg:'#FEE2E2', color:'#991B1B', icon:'❌' },
                      }
                      const statusColors: Record<string,any> = {
                        ACTIVE:     { bg:'#DCFCE7', color:'#166534' },
                        SUSPENDED:  { bg:'#FEF9C3', color:'#854D0E' },
                        DEFAULTED:  { bg:'#FEE2E2', color:'#991B1B' },
                        EXITED:     { bg:'#F1F5F9', color:'#475569' },
                      }
                      const tier   = tierColors[m.tier]   || tierColors.BRONZE
                      const kyc    = kycColors[m.kycStatus]  || kycColors.PENDING
                      const status = statusColors[m.status]   || statusColors.ACTIVE
                      const initials = (m.fullName||'?').split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()

                      return (
                        <tr key={m.userId||m.id} style={{ borderBottom:'1px solid #F8FAFC', background: idx%2===0?'white':'#FAFAFA' }}>
                          <td style={{ padding:'10px 12px', fontSize:'12px', color:'#94A3B8', fontWeight:'600' }}>
                            {m.payoutPosition || idx+1}
                          </td>
                          <td style={{ padding:'10px 12px' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                              <div style={{ width:'32px', height:'32px', borderRadius:'50%', background:`linear-gradient(135deg,${NAVY},${TEAL})`, color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'700', flexShrink:0 }}>
                                {initials}
                              </div>
                              <div>
                                <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY }}>{m.fullName}</div>
                                <div style={{ fontSize:'10px', color:'#94A3B8' }}>{m.role}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding:'10px 12px' }}>
                            <div style={{ fontSize:'12px', color:'#475569' }}>{m.email}</div>
                            <div style={{ fontSize:'11px', color:'#94A3B8' }}>{m.phone}</div>
                          </td>
                          <td style={{ padding:'10px 12px', fontSize:'12px', color:'#475569' }}>
                            <div>{m.country||'—'}</div>
                            <div style={{ fontSize:'11px', color:'#94A3B8' }}>{m.city||''}</div>
                          </td>
                          <td style={{ padding:'10px 12px' }}>
                            <span style={{ background:tier.bg, color:tier.color, fontSize:'10px', fontWeight:'700', padding:'2px 8px', borderRadius:'999px' }}>
                              {m.tier}
                            </span>
                          </td>
                          <td style={{ padding:'10px 12px' }}>
                            <span style={{ background:kyc.bg, color:kyc.color, fontSize:'10px', fontWeight:'600', padding:'2px 7px', borderRadius:'999px' }}>
                              {kyc.icon} {m.kycStatus}
                            </span>
                          </td>
                          <td style={{ padding:'10px 12px', fontSize:'13px', fontWeight:'600', color:Number(m.reputationScore)>=70?'#166534':Number(m.reputationScore)>=40?'#854D0E':'#991B1B' }}>
                            {Number(m.reputationScore||0).toFixed(0)}
                          </td>
                          <td style={{ padding:'10px 12px' }}>
                            <span style={{ background:status.bg, color:status.color, fontSize:'10px', fontWeight:'600', padding:'2px 7px', borderRadius:'999px' }}>
                              {m.status}
                            </span>
                          </td>
                          <td style={{ padding:'10px 12px', fontSize:'11px', color:'#94A3B8', whiteSpace:'nowrap' }}>
                            {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'#F8FAFC', borderTop:'2px solid #E2E8F0' }}>
                      <td colSpan={9} style={{ padding:'10px 12px', fontSize:'12px', color:'#64748B' }}>
                        {groupMembers.filter((m:any)=>m.status==='ACTIVE').length} active ·{' '}
                        {groupMembers.filter((m:any)=>m.kycStatus==='VERIFIED').length} KYC verified ·{' '}
                        Avg score: {groupMembers.length > 0 ? (groupMembers.reduce((s:number,m:any)=>s+Number(m.reputationScore||0),0)/groupMembers.length).toFixed(0) : '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
  
        {/* Cycle tab */}
        {detailTab==='cycle' && (
          <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'32px', textAlign:'center' }}>
            {g.activeCycle ? (
              <div>
                <h3 style={{ fontSize:'15px', fontWeight:'600', color:NAVY, margin:'0 0 8px' }}>Cycle {g.activeCycle.cycleNumber} Active</h3>
                <p style={{ color:'#64748B', fontSize:'13px' }}>Pool: ${Number(g.activeCycle.poolAmount).toLocaleString()}</p>
              </div>
            ) : (
              <>
                <div style={{ fontSize:'36px', marginBottom:'10px' }}>🔄</div>
                <h3 style={{ fontSize:'15px', fontWeight:'600', color:NAVY, margin:'0 0 6px' }}>No Cycle Started</h3>
                <p style={{ color:'#64748B', fontSize:'13px', marginBottom:'16px' }}>Start the first cycle to assign payout positions.</p>
                <button style={{ padding:'10px 20px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>🚀 Start Cycle 1</button>
              </>
            )}
          </div>
        )}
  
        {/* Windfall Schemes tab */}
        {detailTab==='schemes' && (
          <div>
            <WindfallSchemesHub groupId={g.id} groupMembers={groupMembers} />
          </div>
        )}
  
        {/* Settings tab — Accordion */}
        {detailTab==='settings' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'0' }}>
            {(() => {
              if (!editForm || editForm.id !== g.id) {
                const init = {
                  id: g.id, name: g.name, description: g.description||'',
                  branding: g.branding||'', currency: g.currency,
                  contributionAmount: g.contributionAmount?.toString()||'',
                  contributionDay: g.contributionDay?.toString()||'1',
                  contributionFrequency: g.contributionFrequency||'monthly',
                  maxMembers: g.maxMembers?.toString()||'10',
                  penaltyRate: ((g.penaltyRate||0.20)*100).toFixed(0),
                  insurancePoolPct: ((g.insurancePoolPct||0.015)*100).toFixed(1),
                  payoutStrategy: g.payoutStrategy||'SENIORITY',
                  country: g.country||'', region: g.region||'',
                  city: g.city||'', zipCode: g.zipCode||'',
                  treasurerId: g.treasurerId||'', secretaryId: g.secretaryId||'',
                  groupType: (g.groupType || 'PRIVATE') as 'PRIVATE'|'PUBLIC',
                  dateClosed: '',
                }
                setEditForm(init)
                return null
              }
              const ef    = editForm
              const setEf = (k: string) => (v: string) => setEditForm((p: any) => ({...p, [k]:v}))
              const isOpen = (id: string) => openAccordion.includes(id)
              const toggle = (id: string) => setOpenAccordion((prev: string[]) =>
                prev.includes(id) ? prev.filter((x: string) => x !== id) : [...prev, id]
              )
              const INPUT:  React.CSSProperties = { width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' }
              const LABEL:  React.CSSProperties = { display:'block', fontSize:'11px', fontWeight:'600', color:'#64748B', marginBottom:'4px', textTransform:'uppercase', letterSpacing:'0.04em' }
              const GRID2:  React.CSSProperties = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }
              const SECTIONS = [
                { id:'group-details',  icon:'📋', label:'Group Details'    },
                { id:'members',        icon:'👥', label:'Members'          },
                { id:'location',       icon:'📍', label:'Location'         },
                { id:'currency',       icon:'💱', label:'Currency'         },
                { id:'branding',       icon:'🏷️', label:'Branding'        },
                { id:'dates',          icon:'📅', label:'Dates'            },
                { id:'documentation',  icon:'📄', label:'Documentation'    },
                { id:'danger',         icon:'🗑️', label:'Delete Group'    },
              ]

              return (
                <form onSubmit={handleUpdate}>
                  <div style={{ borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden', background:'white' }}>

                    {SECTIONS.map((sec, si) => (
                      <div key={sec.id}>
                        <button type="button" onClick={() => toggle(sec.id)}
                          style={{ width:'100%', display:'flex', alignItems:'center', gap:'10px', padding:'14px 18px',
                            background: isOpen(sec.id) ? '#F8FAFC' : 'white',
                            border:'none', borderTop: si > 0 ? '1px solid #F1F5F9' : 'none',
                            cursor:'pointer', textAlign:'left' as any }}>
                          <span style={{ fontSize:'16px' }}>{sec.icon}</span>
                          <span style={{ flex:1, fontSize:'13px', fontWeight:'600', color: sec.id==='danger' ? '#991B1B' : NAVY }}>{sec.label}</span>
                          {sec.id === 'members' && (
                            <span style={{ background:'#EEF2FF', color:'#3730A3', fontSize:'11px', fontWeight:'600', padding:'2px 8px', borderRadius:'999px', marginRight:'6px' }}>
                              {groupMembers.length} / {ef.maxMembers}
                            </span>
                          )}
                          <span style={{ fontSize:'11px', color:'#94A3B8', display:'inline-block',
                            transform: isOpen(sec.id) ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s' }}>▼</span>
                        </button>

                        {isOpen(sec.id) && (
                          <div style={{ padding:'16px 18px 20px', borderTop:'1px solid #F1F5F9', background:'#FAFBFC' }}>

                            {sec.id === 'group-details' && (
                              <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                                <div>
                                  <label style={LABEL}>Group Name *</label>
                                  <input type="text" value={ef.name} onChange={e=>setEf('name')(e.target.value)} required style={INPUT}/>
                                </div>
                                <div>
                                  <label style={LABEL}>Description</label>
                                  <textarea value={ef.description} onChange={e=>setEf('description')(e.target.value)} rows={3}
                                    style={{...INPUT, resize:'vertical' as any}}/>
                                </div>
                                <div>
                                  <label style={LABEL}>Group Visibility</label>
                                  <GroupTypeSwitch
                                    value={ef.groupType as 'PRIVATE'|'PUBLIC'}
                                    onChange={v => setEditForm((p: any) => ({...p, groupType: v}))}
                                  />
                                </div>
                              </div>
                            )}

                            {sec.id === 'members' && (
                              <div style={GRID2}>
                                <div style={{ gridColumn:'1/-1' }}>
                                  <label style={LABEL}>Group Admin</label>
                                  <div style={{...INPUT, background:'#F8FAFC', color:'#64748B'}}>{g.adminName || '—'}</div>
                                </div>
                                <div>
                                  <label style={LABEL}>Treasurer</label>
                                  <select value={ef.treasurerId||''} onChange={e=>setEf('treasurerId')(e.target.value)} style={{...INPUT, background:'white'}}>
                                    <option value="">— Select Treasurer —</option>
                                    {groupMembers.map((m: any) => <option key={m.userId||m.id} value={m.userId||m.id}>{m.fullName}</option>)}
                                  </select>
                                  {ef.treasurerId && <div style={{fontSize:'11px',color:'#166534',marginTop:'3px'}}>✓ {groupMembers.find((m:any)=>(m.userId||m.id)===ef.treasurerId)?.fullName}</div>}
                                </div>
                                <div>
                                  <label style={LABEL}>Secretary</label>
                                  <select value={ef.secretaryId||''} onChange={e=>setEf('secretaryId')(e.target.value)} style={{...INPUT, background:'white'}}>
                                    <option value="">— Select Secretary —</option>
                                    {groupMembers.map((m: any) => <option key={m.userId||m.id} value={m.userId||m.id}>{m.fullName}</option>)}
                                  </select>
                                  {ef.secretaryId && <div style={{fontSize:'11px',color:'#166534',marginTop:'3px'}}>✓ {groupMembers.find((m:any)=>(m.userId||m.id)===ef.secretaryId)?.fullName}</div>}
                                </div>
                                <div>
                                  <label style={LABEL}>Max Members</label>
                                  <input type="number" min="2" max="500" value={ef.maxMembers} onChange={e=>setEf('maxMembers')(e.target.value)} style={INPUT}/>
                                </div>
                                <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'10px 12px', background:'#F0FDF4', borderRadius:'8px', border:'1px solid #BBF7D0', gridColumn:'1/-1' }}>
                                  <span style={{ fontSize:'20px' }}>👥</span>
                                  <div>
                                    <div style={{ fontSize:'13px', fontWeight:'600', color:'#166534' }}>{groupMembers.length} enrolled · {Math.max(0, parseInt(ef.maxMembers||'0') - groupMembers.length)} vacancies</div>
                                    <div style={{ fontSize:'11px', color:'#64748B' }}>Capacity: {ef.maxMembers} members</div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {sec.id === 'location' && (
                              <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                                <CountrySelector
                                  value={editLocation.countryCode ? editLocation : { countryCode:ef.country||'', provinceCode:'', city:ef.region||'', currency:ef.currency||'' }}
                                  onChange={r => { setEditLocation(r); setEf('country')(r.countryCode); setEf('region')(r.provinceName||r.city); setEf('currency')(r.currency); setEf('branding')('') }}
                                  onNameSuggested={() => {}}
                                />
                                <div>
                                  <label style={LABEL}>ZIP / Postcode</label>
                                  <input type="text" value={ef.zipCode||''} onChange={e=>setEf('zipCode')(e.target.value)} placeholder="e.g. 00263" style={INPUT}/>
                                </div>
                              </div>
                            )}

                            {sec.id === 'currency' && (
                              <div>
                                <label style={LABEL}>Group Currency</label>
                                <select value={ef.currency} onChange={e=>setEf('currency')(e.target.value)} style={{...INPUT, background:'white'}}>
                                  {['USD','ZAR','ZWG','KES','TZS','UGX','ZMW','BWP','MWK','EUR','GBP'].map(c=>(
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                </select>
                                {ef.currency && (
                                  <div style={{ marginTop:'10px', padding:'10px 14px', background:'#F0FDF4', borderRadius:'8px', fontSize:'12px', color:'#166534', display:'flex', alignItems:'center', gap:'8px' }}>
                                    <span style={{ fontSize:'18px' }}>💱</span>
                                    <span>All financial records will use <strong>{ef.currency}</strong></span>
                                  </div>
                                )}
                              </div>
                            )}

                            {sec.id === 'branding' && (
                              <div>
                                <p style={{ fontSize:'12px', color:'#64748B', margin:'0 0 12px', lineHeight:'1.5' }}>
                                  Select the local savings tradition that best represents this group. This branding appears prominently on the group dashboard.
                                </p>
                                {(editLocation.countryCode || ef.country) ? (
                                  <BrandingSelector
                                    countryCode={editLocation.countryCode || ef.country || ''}
                                    value={ef.branding || ''}
                                    onChange={b => setEf('branding')(b)}
                                  />
                                ) : (
                                  <div style={{ padding:'12px 14px', background:'#FEF9C3', borderRadius:'8px', fontSize:'12px', color:'#854D0E', border:'1px solid #FCD34D' }}>
                                    ⚠️ Open the Location section and set a country to see local branding options.
                                  </div>
                                )}
                              </div>
                            )}

                            {sec.id === 'dates' && (
                              <div style={GRID2}>
                                <div>
                                  <label style={LABEL}>Date Created</label>
                                  <div style={{...INPUT, background:'#F8FAFC', color:'#64748B'}}>
                                    {g.createdAt ? new Date(g.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—'}
                                  </div>
                                </div>
                                <div>
                                  <label style={LABEL}>Date Closed</label>
                                  <input type="date" value={ef.dateClosed||''} onChange={e=>setEf('dateClosed')(e.target.value)} style={INPUT}/>
                                  <p style={{ fontSize:'11px', color:'#94A3B8', margin:'4px 0 0' }}>Leave blank if group is still active</p>
                                </div>
                              </div>
                            )}

                            {sec.id === 'documentation' && (
                              <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                                {[
                                  { key:'constitution',    label:'Constitution',     desc:'Group rules and governance document', icon:'📜', bg:'#EEF2FF', color:'#3730A3' },
                                  { key:'welcome-letter',  label:'Welcome Letter',   desc:'Sent to new members on joining',       icon:'👋', bg:'#F0FDF4', color:'#166534' },
                                  { key:'dismissal-letter',label:'Dismissal Letter', desc:'Formal exit or removal notice',        icon:'📨', bg:'#FEF2F2', color:'#991B1B' },
                                ].map(doc => (
                                  <div key={doc.key} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px 14px', background:doc.bg, borderRadius:'10px', border:`1px solid ${doc.color}20` }}>
                                    <span style={{ fontSize:'22px', flexShrink:0 }}>{doc.icon}</span>
                                    <div style={{ flex:1 }}>
                                      <div style={{ fontSize:'13px', fontWeight:'600', color:doc.color }}>{doc.label}</div>
                                      <div style={{ fontSize:'11px', color:'#64748B' }}>{doc.desc}</div>
                                    </div>
                                    <div style={{ display:'flex', gap:'6px' }}>
                                      <button type="button" style={{ padding:'5px 10px', background:'white', color:doc.color, border:`1.5px solid ${doc.color}40`, borderRadius:'6px', fontSize:'11px', fontWeight:'600', cursor:'pointer' }}>
                                        ⬆️ Upload
                                      </button>
                                      <button type="button" style={{ padding:'5px 10px', background:'white', color:'#64748B', border:'1.5px solid #E2E8F0', borderRadius:'6px', fontSize:'11px', cursor:'pointer' }}>
                                        ⬇️ Download
                                      </button>
                                    </div>
                                  </div>
                                ))}
                                <p style={{ fontSize:'11px', color:'#94A3B8', margin:'2px 0 0' }}>
                                  Document storage coming soon. Templates will be auto-generated from group details.
                                </p>
                              </div>
                            )}

                            {sec.id === 'danger' && (
                              <div>
                                <p style={{ fontSize:'13px', color:'#64748B', margin:'0 0 14px', lineHeight:'1.5' }}>
                                  Permanently removes this group. This action cannot be undone. All data is retained in audit logs.
                                </p>
                                {!deleteCheck && (
                                  <button type="button" onClick={()=>handleDeleteCheck(g.id)} disabled={deleteSaving}
                                    style={{ padding:'9px 20px', background:'#FEF2F2', color:'#991B1B', border:'1.5px solid #FECACA', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:deleteSaving?'not-allowed':'pointer' }}>
                                    {deleteSaving ? '⏳ Checking...' : '🗑️ Delete this Group'}
                                  </button>
                                )}
                                {deleteCheck && deleteCheck.id === g.id && (
                                  <div>
                                    {deleteCheck.blockers?.length > 0 && (
                                      <div style={{ background:'#FEF2F2', borderRadius:'10px', padding:'14px', marginBottom:'12px', border:'1px solid #FECACA' }}>
                                        <div style={{ fontSize:'13px', fontWeight:'600', color:'#991B1B', marginBottom:'8px' }}>🚫 Cannot delete — resolve these first:</div>
                                        {deleteCheck.blockers.map((b: string, i: number) => (
                                          <div key={i} style={{ display:'flex', gap:'8px', fontSize:'12px', color:'#991B1B', marginBottom:'4px' }}><span>•</span><span>{b}</span></div>
                                        ))}
                                        <button type="button" onClick={()=>setDeleteCheck(null)} style={{ marginTop:'10px', padding:'6px 14px', background:'white', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'6px', fontSize:'12px', cursor:'pointer' }}>← Dismiss</button>
                                      </div>
                                    )}
                                    {deleteCheck.canDelete && deleteCheck.warnings?.length > 0 && (
                                      <div style={{ background:'#FEF9C3', borderRadius:'10px', padding:'12px 14px', marginBottom:'12px', border:'1px solid #FCD34D' }}>
                                        <div style={{ fontSize:'12px', fontWeight:'600', color:'#854D0E', marginBottom:'6px' }}>⚠️ Please note:</div>
                                        {deleteCheck.warnings.map((w: string, i: number) => (
                                          <div key={i} style={{ fontSize:'12px', color:'#854D0E', marginBottom:'3px' }}>• {w}</div>
                                        ))}
                                      </div>
                                    )}
                                    {deleteCheck.canDelete && (
                                      <div style={{ background:'#FFF1F2', borderRadius:'10px', padding:'14px', border:'1px solid #FECACA' }}>
                                        <div style={{ fontSize:'13px', fontWeight:'600', color:'#991B1B', marginBottom:'8px' }}>
                                          Type <strong>"{g.name}"</strong> to confirm:
                                        </div>
                                        <input type="text" value={deleteConfirmName} onChange={e=>setDeleteConfirmName(e.target.value)}
                                          placeholder={'Type "' + g.name + '" here...'}
                                          style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #FECACA', borderRadius:'8px', fontSize:'13px', outline:'none', marginBottom:'10px', boxSizing:'border-box' as any, background:'white' }}/>
                                        <div style={{ display:'flex', gap:'8px' }}>
                                          <button type="button" onClick={()=>{ setDeleteCheck(null); setDeleteConfirmName('') }}
                                            style={{ flex:1, padding:'9px', background:'white', color:'#475569', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>Cancel</button>
                                          <button type="button" onClick={handleDeleteConfirm}
                                            disabled={deleteConfirmName.toLowerCase() !== g.name.toLowerCase() || deleteSaving}
                                            style={{ flex:2, padding:'9px', background:deleteConfirmName.toLowerCase()===g.name.toLowerCase()?'#991B1B':'#94A3B8', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:deleteConfirmName.toLowerCase()===g.name.toLowerCase()?'pointer':'not-allowed' }}>
                                            {deleteSaving ? '⏳ Deleting...' : '🗑️ Permanently Delete'}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                          </div>
                        )}
                      </div>
                    ))}

                    {/* Save bar */}
                    <div style={{ padding:'14px 18px', borderTop:'2px solid #E2E8F0', background:'white', display:'flex', gap:'10px' }}>
                      <button type="submit" disabled={editSaving}
                        style={{ flex:1, padding:'10px', background:editSaving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:editSaving?'not-allowed':'pointer' }}>
                        {editSaving ? '⏳ Saving...' : '✓ Save Changes'}
                      </button>
                      <button type="button" onClick={()=>setEditForm(null)}
                        style={{ padding:'10px 16px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#475569' }}>
                        Reset
                      </button>
                    </div>
                  </div>
                </form>
              )
            })()}
          </div>
        )}

        {/* Invite Modal */}
        {showInviteModal && inviteGroupId && (
          <SendInviteModal
            groups={groups}
            preselectedGroupId={inviteGroupId}
            currentUserId={currentUserId}
            onClose={() => { setShowInviteModal(false); setInviteGroupId(null) }}
            onSuccess={() => { showToast('Invitation sent successfully!'); setShowInviteModal(false); setInviteGroupId(null) }}
          />
        )}
      </div>
    )
  } // end detail view

  return null
}
