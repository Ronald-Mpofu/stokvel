'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import SendInviteModal from '../invitations/SendInviteModal'
import GroceryClubPanel from '../grocery/GroceryClubPanel'
import InvestmentPanel  from '../investment/InvestmentPanel'
import AssetsPage from '../assets/AssetsPage'
import SavingsPage    from '../savings/SavingsPage'
import PropertyPage   from '../property/PropertyPage'
import LoansPage      from '../loans/LoansPage'
import CountrySelector from '../../../components/CountrySelector'
import { useIsMobile } from '@/lib/mobile/useIsMobile'
import MobileGroupsList from './MobileGroupsList'
import MobileGroupDetail from './MobileGroupDetail'
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

// Fallback only — full currency list is lazily fetched from /api/reference?type=currencies
const CURRENCIES = ['USD','ZAR','ZWG','KES','TZS','UGX','ZMW','BWP','MWK','EUR','GBP']

// ISO-3166 alpha-2 code → full country name, via the browser's built-in
// Intl.DisplayNames (no data table, no network). Falls back to the raw value
// for legacy rows that already store a name or a non-2-letter code.
const REGION_NAMES: any =
  typeof Intl !== 'undefined' && (Intl as any).DisplayNames
    ? new (Intl as any).DisplayNames(['en'], { type: 'region' })
    : null

function countryName(code?: string | null): string {
  if (!code) return '—'
  const c = code.trim().toUpperCase()
  if (REGION_NAMES && /^[A-Z]{2}$/.test(c)) {
    try { return REGION_NAMES.of(c) || code } catch { return code }
  }
  return code
}

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
  publicAdvert: '',
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Display name for the Treasurer / Secretary slots.
 *
 * `serverName` is the authoritative source — /api/groups resolves it by
 * joining "User" on the officer id, so it is correct regardless of the
 * officer's membership status and regardless of whether the member
 * roster has loaded. It is the ONLY source that works for an officer
 * who is SUSPENDED, DEFAULTED or PENDING, because the roster request
 * filters to ACTIVE by default.
 *
 * `roster` remains as a fallback for one narrow window: immediately
 * after a save, when selectedGroup is patched locally from the edit
 * form and the server response has not been re-read yet.
 *
 * Module-level by design — see the project rule on helpers defined
 * inside render.
 */
function officerName(serverName?: string, officerId?: string, roster: any[] = []): string {
  if (serverName) return serverName
  if (!officerId) return '—'
  const match = roster.find((m: any) => (m.userId || m.id) === officerId)
  return match?.fullName || '—'
}

/**
 * Option list for an officer <select>.
 *
 * The roster only contains ACTIVE members, so an officer who is
 * SUSPENDED, DEFAULTED or PENDING has no matching <option>. A <select>
 * whose value matches no option renders blank — the assignment looks
 * lost even though it is intact in the database and will still be saved
 * on submit. Splicing the current assignment in keeps what is stored
 * and what is shown in agreement.
 */
function officerOptions(
  roster: any[],
  currentId?: string,
  currentName?: string
): { id: string; label: string }[] {
  const options = roster.map((m: any) => ({
    id:    String(m.userId || m.id),
    label: String(m.fullName || '?'),
  }))
  if (currentId && !options.some(o => o.id === currentId)) {
    options.unshift({
      id:    currentId,
      label: `${currentName || 'Assigned member'} (not in active roster)`,
    })
  }
  return options
}

/**
 * Treasurer / Secretary picker. Module-level so its component identity
 * is stable across renders — see the project rule on helpers defined
 * inside render.
 */
function OfficerSelect({
  label, valueId, serverName, roster, onChange, inputStyle, labelStyle,
}: {
  label: string
  valueId: string
  serverName?: string
  roster: any[]
  onChange: (v: string) => void
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
}) {
  const options = officerOptions(roster, valueId, serverName)
  const selected = options.find(o => o.id === valueId)
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <select
        value={valueId || ''}
        onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle, background:'white' }}
      >
        <option value="">— Select {label} —</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {valueId && (
        <div style={{ fontSize:'11px', color:'#166534', marginTop:'3px' }}>
          ✓ {selected?.label || '—'}
        </div>
      )}
    </div>
  )
}

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

// Card id → WindfallScheme.schemeType in the database
const CARD_TO_SCHEME_TYPE: Record<string, string> = {
  grocery:    'GROCERY_CLUB',
  savings:    'SAVINGS_POOL',
  property:   'PROPERTY',
  loans:      'LOANS',
  investment: 'INVESTMENT',
  assets:     'ASSETS',
}

function WindfallSchemesHub({ groupId, groupMembers }: { groupId: string; groupMembers: any[] }) {
  const TEAL2 = '#0F6E56'; const NAVY2 = '#0D2137'
  const [activeId, setActiveId] = useState<string|null>(null)

  // Scheme rows from the WindfallScheme table — drives Remove / Enable.
  // One lightweight fetch when the Schemes tab opens (the hub only mounts then).
  const [schemeRows, setSchemeRows]           = useState<any[]>([])
  const [confirmRemoveId, setConfirmRemoveId] = useState<string|null>(null)
  const [removingId, setRemovingId]           = useState<string|null>(null)
  const [enablingId, setEnablingId]           = useState<string|null>(null)
  const [schemeError, setSchemeError]         = useState<{ cardId: string; blockers: string[] }|null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/windfall?groupId=${groupId}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setSchemeRows(d.success ? (d.data || []) : []) })
      .catch(() => { if (!cancelled) setSchemeRows([]) })
    return () => { cancelled = true }
  }, [groupId])

  // Legacy mode: if the group has no WindfallScheme rows at all, the grid
  // behaves exactly as before (no Remove/Enable controls shown).
  const managed = schemeRows.length > 0

  function activeRowFor(cardId: string) {
    const type = CARD_TO_SCHEME_TYPE[cardId]
    return schemeRows.find((r: any) => r.schemeType === type && r.status === 'ACTIVE') || null
  }

  // ── Remove a scheme (Group Admin) ───────────────────────────
  // The API is the source of truth for the financial-integrity rule:
  // a scheme with ANY transactions or financial records cannot be removed.
  async function handleRemoveScheme(cardId: string) {
    const row = activeRowFor(cardId)
    if (!row || removingId) return
    setRemovingId(cardId)
    setSchemeError(null)
    try {
      const res  = await fetch(`/api/windfall?id=${row.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setSchemeRows(prev => prev.filter((r: any) => r.id !== row.id))
      } else {
        setSchemeError({ cardId, blockers: data.blockers?.length ? data.blockers : [data.error || 'Could not remove scheme'] })
      }
    } catch { setSchemeError({ cardId, blockers: ['Network error — please try again'] }) }
    finally { setRemovingId(null); setConfirmRemoveId(null) }
  }

  // ── Re-enable a removed scheme ──────────────────────────────
  async function handleEnableScheme(cardId: string) {
    if (enablingId) return
    const meta = SCHEMES.find(s => s.id === cardId)
    setEnablingId(cardId)
    setSchemeError(null)
    try {
      const res  = await fetch('/api/windfall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, schemeType: CARD_TO_SCHEME_TYPE[cardId], name: meta ? meta.label : cardId }),
      })
      const data = await res.json()
      if (data.success && data.data && data.data.id) {
        setSchemeRows(prev => [...prev, { id: data.data.id, groupId, schemeType: CARD_TO_SCHEME_TYPE[cardId], name: meta ? meta.label : cardId, status: 'ACTIVE' }])
      } else {
        setSchemeError({ cardId, blockers: [data.error || 'Could not enable scheme'] })
      }
    } catch { setSchemeError({ cardId, blockers: ['Network error — please try again'] }) }
    finally { setEnablingId(null) }
  }

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
        <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>Select a scheme to manage for this group. Members can participate in multiple schemes simultaneously.{managed ? ' Schemes without any transactions can be removed.' : ''}</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px' }}>
        {SCHEMES.map(s => {
          const row        = activeRowFor(s.id)
          const isDisabled = managed && !row
          const confirming = confirmRemoveId === s.id
          const cardError  = schemeError && schemeError.cardId === s.id ? schemeError : null
          return (
            <div key={s.id}
              onClick={() => { if (!isDisabled && !confirming) setActiveId(s.id) }}
              style={{ background:'white', borderRadius:'14px', border:`2px solid ${s.available ? '#E2E8F0' : '#F1F5F9'}`,
                padding:'20px 16px', cursor: isDisabled ? 'default' : 'pointer', transition:'all 0.2s', position:'relative', textAlign:'center',
                opacity: isDisabled ? 0.55 : 1 }}
              onMouseEnter={e => {
                if (isDisabled) return
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
              {row && !confirming && (
                <button type="button" title="Remove this scheme"
                  onClick={e => { e.stopPropagation(); setSchemeError(null); setConfirmRemoveId(s.id) }}
                  style={{ position:'absolute', top:'8px', left:'8px', background:'#FEF2F2', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'6px', fontSize:'11px', padding:'2px 6px', cursor:'pointer', lineHeight:'1.4' }}>
                  🗑️
                </button>
              )}
              <div style={{ width:'52px', height:'52px', borderRadius:'14px', background:s.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'24px', margin:'0 auto 12px' }}>
                {s.icon}
              </div>
              <div style={{ fontSize:'14px', fontWeight:'700', color:NAVY2, marginBottom:'6px' }}>{s.label}</div>
              <div style={{ fontSize:'11px', color:'#94A3B8', lineHeight:'1.5', marginBottom:'12px' }}>{s.desc}</div>
              {cardError && (
                <div onClick={e => e.stopPropagation()}
                  style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'8px', padding:'8px 10px', marginBottom:'10px', textAlign:'left' }}>
                  <div style={{ fontSize:'11px', fontWeight:'700', color:'#991B1B', marginBottom:'4px' }}>🚫 Cannot remove:</div>
                  {cardError.blockers.map((b: string, i: number) => (
                    <div key={i} style={{ fontSize:'11px', color:'#991B1B', marginBottom:'2px' }}>• {b}</div>
                  ))}
                  <button type="button" onClick={e => { e.stopPropagation(); setSchemeError(null) }}
                    style={{ marginTop:'4px', padding:'3px 10px', background:'white', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'5px', fontSize:'10px', cursor:'pointer' }}>
                    Dismiss
                  </button>
                </div>
              )}
              {confirming ? (
                <div onClick={e => e.stopPropagation()}
                  style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'11px', fontWeight:'600', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'999px', padding:'4px 10px' }}>
                  <span style={{ color:'#991B1B' }}>Remove?</span>
                  <button type="button" onClick={() => handleRemoveScheme(s.id)} disabled={removingId === s.id}
                    style={{ padding:'2px 10px', background:'#991B1B', color:'white', border:'none', borderRadius:'999px', fontSize:'11px', fontWeight:'600', cursor: removingId === s.id ? 'not-allowed' : 'pointer' }}>
                    {removingId === s.id ? '⏳' : 'Yes'}
                  </button>
                  <button type="button" onClick={() => setConfirmRemoveId(null)}
                    style={{ padding:'2px 10px', background:'white', color:'#475569', border:'1px solid #E2E8F0', borderRadius:'999px', fontSize:'11px', cursor:'pointer' }}>
                    No
                  </button>
                </div>
              ) : isDisabled ? (
                <button type="button" onClick={e => { e.stopPropagation(); handleEnableScheme(s.id) }} disabled={enablingId === s.id}
                  style={{ display:'inline-flex', alignItems:'center', gap:'4px', fontSize:'11px', fontWeight:'600',
                    color:'#475569', background:'#F1F5F9', border:'1px dashed #CBD5E1',
                    padding:'4px 12px', borderRadius:'999px', cursor: enablingId === s.id ? 'not-allowed' : 'pointer' }}>
                  {enablingId === s.id ? '⏳ Enabling...' : '＋ Enable'}
                </button>
              ) : (
                <div style={{ display:'inline-flex', alignItems:'center', gap:'4px', fontSize:'11px', fontWeight:'600',
                  color: s.available ? s.color : '#94A3B8',
                  background: s.available ? s.bg : '#F8FAFC',
                  padding:'4px 12px', borderRadius:'999px' }}>
                  {s.available ? 'Open →' : 'Coming Soon'}
                </div>
              )}
            </div>
          )
        })}
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
      {!value && <p style={{ fontSize:'11px', color:'#94A3B8', margin:0 }}>Optional — you can add or change this later in Settings.</p>}
    </div>
  )
}


// ── Group Banking & Documents panels ──────────────────────────
// Both are MODULE-LEVEL components. Defining them inside GroupsPage's
// render would remount them on every keystroke and lose cursor focus in
// their inputs — the recurring failure on this page.
//
// Both mount only when their accordion section is open, so neither adds
// a request to initial page load.
//
// Every button is type="button": these render inside the settings
// <form onSubmit={handleUpdate}>, and an untyped button there defaults
// to submit and would save the whole group instead.

const MANDATE_ROLES = [
  { value: 'CHAIRPERSON', label: 'Chairperson' },
  { value: 'TREASURER',   label: 'Treasurer'   },
  { value: 'SECRETARY',   label: 'Secretary'   },
  { value: 'MEMBER',      label: 'Member'      },
]

const ACCOUNT_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  PENDING_VERIFICATION: { bg:'#FEF3C7', color:'#92400E', label:'Pending' },
  ACTIVE:               { bg:'#DCFCE7', color:'#166534', label:'Active'  },
  SUSPENDED:            { bg:'#FEE2E2', color:'#991B1B', label:'Suspended' },
  CLOSED:               { bg:'#F1F5F9', color:'#475569', label:'Closed'  },
}

const EMPTY_ACCOUNT = {
  id: '', accountType: 'BANK', bankName: '', accountName: '', accountNumber: '',
  branchName: '', branchCode: '', swiftCode: '',
  walletProvider: '', walletNumber: '', walletName: '',
  currency: 'USD', country: '', signatoriesRequired: '2', isPrimary: false, notes: '',
}

function BankField({ label, value, onChange, placeholder = '', required = false, hint = '' }: any) {
  return (
    <div>
      <label style={{ display:'block', fontSize:'11px', fontWeight:'600', color:'#64748B', marginBottom:'4px', textTransform:'uppercase', letterSpacing:'0.04em' }}>
        {label}{required && <span style={{ color:'#DC2626' }}> *</span>}
      </label>
      <input value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box', minHeight:'40px' }} />
      {hint && <p style={{ fontSize:'10px', color:'#94A3B8', margin:'3px 0 0' }}>{hint}</p>}
    </div>
  )
}

function GroupBankingPanel({ groupId, currency, groupMembers, notify }:
  { groupId: string; currency: string; groupMembers: any[]; notify: (m: string, t: 'success'|'error') => void }) {

  const [accounts, setAccounts] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState<any>({ ...EMPTY_ACCOUNT, currency })
  const [saving, setSaving]     = useState(false)
  const [busyId, setBusyId]     = useState<string|null>(null)
  const [sigFor, setSigFor]     = useState<string|null>(null)
  const [sigUser, setSigUser]   = useState('')
  const [sigRole, setSigRole]   = useState('MEMBER')

  // notify is recreated on every parent render. Holding it in a ref keeps
  // load's identity stable — with notify in the dependency array, the
  // mount effect below would refire on every render, forever.
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/groups/bank-accounts?groupId=${groupId}`)
      const j = await r.json()
      setAccounts(j.success ? (j.data || []) : [])
      if (!j.success) notifyRef.current(j.error || 'Could not load bank accounts', 'error')
    } catch {
      notifyRef.current('Could not load bank accounts', 'error')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { load() }, [load])

  const setF = (k: string) => (v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  async function saveAccount() {
    if (!form.accountName?.trim()) { notify('Account name is required', 'error'); return }
    if (form.accountType === 'BANK' && !form.accountNumber?.trim()) { notify('Account number is required', 'error'); return }
    if (form.accountType === 'MOBILE_WALLET' && !form.walletNumber?.trim()) { notify('Wallet number is required', 'error'); return }

    setSaving(true)
    try {
      const isEdit = !!form.id
      const r = await fetch('/api/groups/bank-accounts', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, groupId, signatoriesRequired: Number(form.signatoriesRequired) || 2 }),
      })
      const j = await r.json()
      if (j.success) {
        notify(j.message || 'Saved', 'success')
        setShowForm(false)
        setForm({ ...EMPTY_ACCOUNT, currency })
        await load()
      } else {
        notify(j.error || 'Could not save', 'error')
      }
    } catch {
      notify('Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(id: string, status: string) {
    setBusyId(id)
    try {
      const r = await fetch('/api/groups/bank-accounts', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-status', id, status }),
      })
      const j = await r.json()
      notify(j.success ? (j.message || 'Updated') : (j.error || 'Could not update'), j.success ? 'success' : 'error')
      if (j.success) await load()
    } catch {
      notify('Could not update', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function addSignatory(accountId: string) {
    if (!sigUser) { notify('Select a member', 'error'); return }
    setBusyId(accountId)
    try {
      const r = await fetch('/api/groups/bank-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-signatory', bankAccountId: accountId, userId: sigUser, mandateRole: sigRole }),
      })
      const j = await r.json()
      notify(j.success ? (j.message || 'Signatory added') : (j.error || 'Could not add'), j.success ? 'success' : 'error')
      if (j.success) { setSigFor(null); setSigUser(''); setSigRole('MEMBER'); await load() }
    } catch {
      notify('Could not add signatory', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function removeSignatory(signatoryId: string, accountId: string) {
    setBusyId(accountId)
    try {
      const r = await fetch('/api/groups/bank-accounts', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resign-signatory', signatoryId }),
      })
      const j = await r.json()
      notify(j.success ? (j.message || 'Removed') : (j.error || 'Could not remove'), j.success ? 'success' : 'error')
      if (j.success) await load()
    } catch {
      notify('Could not remove signatory', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function removeAccount(id: string) {
    setBusyId(id)
    try {
      const r = await fetch(`/api/groups/bank-accounts?id=${id}`, { method: 'DELETE' })
      const j = await r.json()
      notify(j.success ? (j.message || 'Removed') : (j.error || 'Could not remove'), j.success ? 'success' : 'error')
      if (j.success) await load()
    } catch {
      notify('Could not remove account', 'error')
    } finally {
      setBusyId(null)
    }
  }

  function startEdit(a: any) {
    setForm({
      id: a.id, accountType: a.accountType, bankName: a.bankName || '', accountName: a.accountName || '',
      accountNumber: a.accountNumber || '', branchName: a.branchName || '', branchCode: a.branchCode || '',
      swiftCode: a.swiftCode || '', walletProvider: a.walletProvider || '', walletNumber: a.walletNumber || '',
      walletName: a.walletName || '', currency: a.currency || currency, country: a.country || '',
      signatoriesRequired: String(a.signatoriesRequired ?? 2), isPrimary: !!a.isPrimary, notes: a.notes || '',
    })
    setShowForm(true)
  }

  const BTN: React.CSSProperties = { padding:'7px 12px', borderRadius:'7px', fontSize:'11px', fontWeight:'600', cursor:'pointer', minHeight:'34px' }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>

      <div style={{ background:'#F0F9FF', border:'1px solid #BAE6FD', borderRadius:'10px', padding:'11px 13px' }}>
        <div style={{ fontSize:'12px', fontWeight:'600', color:'#075985', marginBottom:'3px' }}>🏦 The group&apos;s own account</div>
        <div style={{ fontSize:'11px', color:'#0C4A6E', lineHeight:'1.5' }}>
          Windfall never holds this money. These details record where the group&apos;s funds live so contributions
          and payouts can be instructed and reconciled. An account cannot be activated until every required
          signatory has been appointed.
        </div>
      </div>

      {loading && <p style={{ fontSize:'12px', color:'#94A3B8', margin:0 }}>Loading accounts…</p>}

      {!loading && accounts.length === 0 && !showForm && (
        <div style={{ textAlign:'center', padding:'22px 14px', background:'#FAFBFC', border:'1.5px dashed #E2E8F0', borderRadius:'10px' }}>
          <div style={{ fontSize:'26px', marginBottom:'6px' }}>🏦</div>
          <p style={{ fontSize:'12px', color:'#64748B', margin:'0 0 12px' }}>No bank account recorded for this group yet.</p>
          <button type="button" onClick={() => { setForm({ ...EMPTY_ACCOUNT, currency }); setShowForm(true) }}
            style={{ ...BTN, background:TEAL, color:'white', border:'none', padding:'9px 18px', fontSize:'12px' }}>
            + Add bank account
          </button>
        </div>
      )}

      {!loading && accounts.map((a: any) => {
        const st  = ACCOUNT_STATUS_STYLE[a.status] || ACCOUNT_STATUS_STYLE.CLOSED
        const sigs = Array.isArray(a.signatories) ? a.signatories : []
        const need = Number(a.signatoriesRequired || 0)
        const short = Math.max(0, need - sigs.length)
        const taken = new Set(sigs.map((s: any) => s.userId))
        const available = (groupMembers || []).filter((m: any) => !taken.has(m.userId || m.id))

        return (
          <div key={a.id} style={{ border:'1px solid #E2E8F0', borderRadius:'10px', background:'white', overflow:'hidden' }}>

            <div style={{ padding:'12px 14px', borderBottom:'1px solid #F1F5F9' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'6px' }}>
                <span style={{ fontSize:'16px' }}>{a.accountType === 'BANK' ? '🏦' : '📱'}</span>
                <span style={{ fontSize:'13px', fontWeight:'700', color:NAVY }}>{a.accountName}</span>
                {a.isPrimary && (
                  <span style={{ background:'#EEF2FF', color:'#3730A3', fontSize:'10px', fontWeight:'700', padding:'2px 7px', borderRadius:'999px' }}>PRIMARY</span>
                )}
                <span style={{ background:st.bg, color:st.color, fontSize:'10px', fontWeight:'700', padding:'2px 7px', borderRadius:'999px' }}>{st.label}</span>
                <span style={{ marginLeft:'auto', fontSize:'11px', color:'#64748B', fontWeight:'600' }}>{a.currency}</span>
              </div>
              <div style={{ fontSize:'11px', color:'#64748B', lineHeight:'1.6' }}>
                {a.accountType === 'BANK' ? (
                  <>
                    {a.bankName && <div>{a.bankName}{a.branchName ? ` · ${a.branchName}` : ''}</div>}
                    <div style={{ fontFamily:'ui-monospace, monospace' }}>{a.accountNumber}</div>
                    {(a.branchCode || a.swiftCode) && (
                      <div>{a.branchCode ? `Branch ${a.branchCode}` : ''}{a.branchCode && a.swiftCode ? ' · ' : ''}{a.swiftCode ? `SWIFT ${a.swiftCode}` : ''}</div>
                    )}
                  </>
                ) : (
                  <>
                    {a.walletProvider && <div>{a.walletProvider}</div>}
                    <div style={{ fontFamily:'ui-monospace, monospace' }}>{a.walletNumber}</div>
                    {a.walletName && <div>{a.walletName}</div>}
                  </>
                )}
              </div>
            </div>

            <div style={{ padding:'12px 14px', background:'#FAFBFC', borderBottom:'1px solid #F1F5F9' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
                <span style={{ fontSize:'11px', fontWeight:'700', color:NAVY, textTransform:'uppercase', letterSpacing:'0.04em' }}>Mandate signatories</span>
                <span style={{ background: short > 0 ? '#FEF3C7' : '#DCFCE7', color: short > 0 ? '#92400E' : '#166534',
                  fontSize:'10px', fontWeight:'700', padding:'2px 7px', borderRadius:'999px' }}>
                  {sigs.length} of {need}
                </span>
              </div>

              {sigs.length === 0 && (
                <p style={{ fontSize:'11px', color:'#94A3B8', margin:'0 0 8px' }}>No signatories appointed.</p>
              )}

              {sigs.map((s: any) => (
                <div key={s.id} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'6px 0', borderBottom:'1px solid #F1F5F9' }}>
                  <span style={{ fontSize:'13px' }}>✍️</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:'12px', fontWeight:'600', color:NAVY }}>{s.fullName}</div>
                    <div style={{ fontSize:'10px', color:'#94A3B8' }}>{s.email}</div>
                  </div>
                  <span style={{ background:'#F1F5F9', color:'#475569', fontSize:'10px', fontWeight:'700', padding:'2px 7px', borderRadius:'999px' }}>
                    {(MANDATE_ROLES.find(r => r.value === s.mandateRole) || { label: s.mandateRole }).label}
                  </span>
                  <button type="button" disabled={busyId === a.id} onClick={() => removeSignatory(s.id, a.id)}
                    style={{ ...BTN, background:'white', color:'#991B1B', border:'1.5px solid #FECACA', padding:'4px 9px' }}>
                    Remove
                  </button>
                </div>
              ))}

              {sigFor === a.id ? (
                <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginTop:'9px' }}>
                  <select value={sigUser} onChange={e => setSigUser(e.target.value)}
                    style={{ flex:'1 1 150px', padding:'8px 10px', border:'1.5px solid #E2E8F0', borderRadius:'7px', fontSize:'12px', minHeight:'36px' }}>
                    <option value="">Select a member…</option>
                    {available.map((m: any) => (
                      <option key={m.userId || m.id} value={m.userId || m.id}>{m.fullName || m.name}</option>
                    ))}
                  </select>
                  <select value={sigRole} onChange={e => setSigRole(e.target.value)}
                    style={{ flex:'0 1 130px', padding:'8px 10px', border:'1.5px solid #E2E8F0', borderRadius:'7px', fontSize:'12px', minHeight:'36px' }}>
                    {MANDATE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button type="button" disabled={busyId === a.id} onClick={() => addSignatory(a.id)}
                    style={{ ...BTN, background:TEAL, color:'white', border:'none' }}>Add</button>
                  <button type="button" onClick={() => { setSigFor(null); setSigUser('') }}
                    style={{ ...BTN, background:'white', color:'#64748B', border:'1.5px solid #E2E8F0' }}>Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => { setSigFor(a.id); setSigUser(''); setSigRole('MEMBER') }}
                  style={{ ...BTN, background:'white', color:TEAL, border:`1.5px solid ${TEAL}40`, marginTop:'9px' }}>
                  + Appoint signatory
                </button>
              )}

              {short > 0 && (
                <p style={{ fontSize:'10px', color:'#92400E', margin:'8px 0 0' }}>
                  ⚠️ {short} more {short === 1 ? 'signatory' : 'signatories'} required before this account can be activated.
                </p>
              )}
            </div>

            <div style={{ padding:'10px 14px', display:'flex', gap:'6px', flexWrap:'wrap' }}>
              {a.status !== 'ACTIVE' && (
                <button type="button" disabled={busyId === a.id} onClick={() => setStatus(a.id, 'ACTIVE')}
                  style={{ ...BTN, background:'#DCFCE7', color:'#166534', border:'1.5px solid #BBF7D0' }}>
                  ✓ Activate
                </button>
              )}
              {a.status === 'ACTIVE' && (
                <button type="button" disabled={busyId === a.id} onClick={() => setStatus(a.id, 'SUSPENDED')}
                  style={{ ...BTN, background:'#FEF3C7', color:'#92400E', border:'1.5px solid #FDE68A' }}>
                  ⏸ Suspend
                </button>
              )}
              <button type="button" onClick={() => startEdit(a)}
                style={{ ...BTN, background:'white', color:NAVY, border:'1.5px solid #E2E8F0' }}>✏️ Edit</button>
              <button type="button" disabled={busyId === a.id} onClick={() => removeAccount(a.id)}
                style={{ ...BTN, background:'white', color:'#991B1B', border:'1.5px solid #FECACA', marginLeft:'auto' }}>
                🗑️ Remove
              </button>
            </div>
          </div>
        )
      })}

      {!loading && accounts.length > 0 && !showForm && (
        <button type="button" onClick={() => { setForm({ ...EMPTY_ACCOUNT, currency }); setShowForm(true) }}
          style={{ ...BTN, background:'white', color:TEAL, border:`1.5px solid ${TEAL}40`, alignSelf:'flex-start' }}>
          + Add another account
        </button>
      )}

      {showForm && (
        <div style={{ border:`1.5px solid ${TEAL}30`, borderRadius:'10px', background:'white', padding:'14px' }}>
          <div style={{ fontSize:'13px', fontWeight:'700', color:NAVY, marginBottom:'12px' }}>
            {form.id ? 'Edit account' : 'New account'}
          </div>

          <div style={{ display:'flex', gap:'8px', marginBottom:'12px' }}>
            {[{ v:'BANK', l:'🏦 Bank account' }, { v:'MOBILE_WALLET', l:'📱 Mobile wallet' }].map(t => (
              <button key={t.v} type="button" onClick={() => setF('accountType')(t.v)}
                style={{ flex:1, padding:'9px', borderRadius:'8px', fontSize:'12px', fontWeight:'600', cursor:'pointer', minHeight:'40px',
                  background: form.accountType === t.v ? TEAL : 'white',
                  color:      form.accountType === t.v ? 'white' : '#64748B',
                  border:     form.accountType === t.v ? 'none' : '1.5px solid #E2E8F0' }}>
                {t.l}
              </button>
            ))}
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px' }}>
            <BankField label="Account name" value={form.accountName} onChange={setF('accountName')} required
              placeholder="Group name as registered" hint="Should match the group's registered name" />
            {form.accountType === 'BANK' ? (
              <>
                <BankField label="Account number" value={form.accountNumber} onChange={setF('accountNumber')} required />
                <BankField label="Bank name" value={form.bankName} onChange={setF('bankName')} />
                <BankField label="Branch name" value={form.branchName} onChange={setF('branchName')} />
                <BankField label="Branch code" value={form.branchCode} onChange={setF('branchCode')} />
                <BankField label="SWIFT / BIC" value={form.swiftCode} onChange={setF('swiftCode')} hint="Only for international transfers" />
              </>
            ) : (
              <>
                <BankField label="Wallet number" value={form.walletNumber} onChange={setF('walletNumber')} required
                  placeholder="+263 …" />
                <BankField label="Provider" value={form.walletProvider} onChange={setF('walletProvider')}
                  placeholder="EcoCash, M-Pesa, MTN MoMo" />
                <BankField label="Registered wallet name" value={form.walletName} onChange={setF('walletName')} />
              </>
            )}
            <BankField label="Currency" value={form.currency} onChange={setF('currency')} required />
            <BankField label="Signatories required" value={form.signatoriesRequired} onChange={setF('signatoriesRequired')}
              hint="Must match the bank mandate — two or more is recommended" />
          </div>

          <label style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'12px', cursor:'pointer', minHeight:'36px' }}>
            <input type="checkbox" checked={!!form.isPrimary} onChange={e => setF('isPrimary')(e.target.checked)}
              style={{ width:'16px', height:'16px', cursor:'pointer' }} />
            <span style={{ fontSize:'12px', color:'#475569' }}>Primary account for {form.currency || currency}</span>
          </label>

          <div style={{ display:'flex', gap:'8px' }}>
            <button type="button" disabled={saving} onClick={saveAccount}
              style={{ ...BTN, background:TEAL, color:'white', border:'none', padding:'9px 18px', fontSize:'12px' }}>
              {saving ? 'Saving…' : (form.id ? 'Save changes' : 'Add account')}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setForm({ ...EMPTY_ACCOUNT, currency }) }}
              style={{ ...BTN, background:'white', color:'#64748B', border:'1.5px solid #E2E8F0', padding:'9px 18px', fontSize:'12px' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const DOC_KINDS = [
  { key:'CONSTITUTION',     label:'Constitution',     desc:'Group rules, governance and banking mandate', icon:'📜', bg:'#EEF2FF', color:'#3730A3', template:'/templates/windfall-constitution-template.docx' },
  { key:'WELCOME_LETTER',   label:'Welcome Letter',   desc:'Sent to new members on joining',              icon:'👋', bg:'#F0FDF4', color:'#166534', template:'' },
  { key:'DISMISSAL_LETTER', label:'Dismissal Letter', desc:'Formal exit or removal notice',               icon:'📨', bg:'#FEF2F2', color:'#991B1B', template:'' },
  { key:'RESOLUTION',       label:'Board Resolution', desc:'Signed resolution the bank will act on',      icon:'⚖️', bg:'#FFFBEB', color:'#92400E', template:'' },
]

function GroupDocumentsPanel({ groupId, notify }:
  { groupId: string; notify: (m: string, t: 'success'|'error') => void }) {

  const [docs, setDocs]         = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [busyKey, setBusyKey]   = useState<string|null>(null)

  // Ref for the same reason as GroupBankingPanel: a notify in the
  // dependency array would make the mount effect loop.
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/groups/documents?groupId=${groupId}`)
      const j = await r.json()
      setDocs(j.success ? (j.data || []) : [])
      if (!j.success) notifyRef.current(j.error || 'Could not load documents', 'error')
    } catch {
      notifyRef.current('Could not load documents', 'error')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { load() }, [load])

  async function upload(docType: string, file: File) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { notify('File must be 10 MB or smaller', 'error'); return }

    setBusyKey(docType)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('groupId', groupId)
      fd.append('docType', docType)
      const r = await fetch('/api/groups/documents', { method: 'POST', body: fd })
      const j = await r.json()
      notify(j.success ? (j.message || 'Uploaded') : (j.error || 'Upload failed'), j.success ? 'success' : 'error')
      if (j.success) await load()
    } catch {
      notify('Upload failed', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  async function download(docId: string, docType: string) {
    setBusyKey(docType)
    try {
      const r = await fetch(`/api/groups/documents?action=download&id=${docId}`)
      const j = await r.json()
      if (j.success && j.data?.url) {
        window.open(j.data.url, '_blank', 'noopener,noreferrer')
      } else {
        notify(j.error || 'Could not open document', 'error')
      }
    } catch {
      notify('Could not open document', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  async function removeDoc(docId: string, docType: string) {
    setBusyKey(docType)
    try {
      const r = await fetch(`/api/groups/documents?id=${docId}`, { method: 'DELETE' })
      const j = await r.json()
      notify(j.success ? (j.message || 'Removed') : (j.error || 'Could not remove'), j.success ? 'success' : 'error')
      if (j.success) await load()
    } catch {
      notify('Could not remove document', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const BTN: React.CSSProperties = { padding:'6px 11px', borderRadius:'7px', fontSize:'11px', fontWeight:'600', cursor:'pointer', minHeight:'34px' }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>

      {loading && <p style={{ fontSize:'12px', color:'#94A3B8', margin:0 }}>Loading documents…</p>}

      {!loading && DOC_KINDS.map(kind => {
        const current = docs.find((d: any) => d.docType === kind.key && d.isCurrent)
        const busy    = busyKey === kind.key

        return (
          <div key={kind.key} style={{ background:kind.bg, borderRadius:'10px', border:`1px solid ${kind.color}20`, padding:'12px 14px' }}>
            <div style={{ display:'flex', alignItems:'flex-start', gap:'12px', flexWrap:'wrap' }}>
              <span style={{ fontSize:'22px', flexShrink:0 }}>{kind.icon}</span>
              <div style={{ flex:'1 1 180px', minWidth:0 }}>
                <div style={{ fontSize:'13px', fontWeight:'600', color:kind.color }}>{kind.label}</div>
                <div style={{ fontSize:'11px', color:'#64748B' }}>{kind.desc}</div>
                {current && (
                  <div style={{ fontSize:'11px', color:'#475569', marginTop:'5px' }}>
                    <span style={{ background:'white', color:kind.color, fontSize:'10px', fontWeight:'700', padding:'1px 6px', borderRadius:'999px', marginRight:'6px' }}>
                      v{current.version}
                    </span>
                    {current.fileName}
                    {current.sizeBytes ? ` · ${(current.sizeBytes / 1024).toFixed(0)} KB` : ''}
                    {current.uploadedByName ? ` · ${current.uploadedByName}` : ''}
                  </div>
                )}
                {!current && (
                  <div style={{ fontSize:'11px', color:'#94A3B8', marginTop:'5px' }}>Not uploaded yet</div>
                )}
              </div>

              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center' }}>
                {kind.template && (
                  <a href={kind.template} download
                    style={{ ...BTN, background:'white', color:kind.color, border:`1.5px solid ${kind.color}40`,
                      textDecoration:'none', display:'inline-flex', alignItems:'center' }}>
                    📥 Template
                  </a>
                )}
                <label style={{ ...BTN, background:'white', color:kind.color, border:`1.5px solid ${kind.color}40`,
                  display:'inline-flex', alignItems:'center', opacity: busy ? 0.6 : 1 }}>
                  {busy ? '⏳ Working…' : (current ? '⬆️ Replace' : '⬆️ Upload')}
                  <input type="file" disabled={busy}
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) upload(kind.key, f)
                    }}
                    style={{ display:'none' }} />
                </label>
                {current && (
                  <button type="button" disabled={busy} onClick={() => download(current.id, kind.key)}
                    style={{ ...BTN, background:'white', color:'#475569', border:'1.5px solid #E2E8F0' }}>
                    ⬇️ Download
                  </button>
                )}
                {current && (
                  <button type="button" disabled={busy} onClick={() => removeDoc(current.id, kind.key)}
                    style={{ ...BTN, background:'white', color:'#991B1B', border:'1.5px solid #FECACA' }}>
                    🗑️
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {!loading && (
        <p style={{ fontSize:'11px', color:'#94A3B8', margin:'2px 0 0', lineHeight:'1.5' }}>
          Documents are stored privately. Download links are signed and expire after five minutes.
          Uploading a replacement creates a new version — earlier versions are retained, not overwritten.
        </p>
      )}
    </div>
  )
}


// ── PageIntro ─────────────────────────────────────────────────
// Page-level guidance. One always-visible line, plus an optional
// expandable body and numbered steps.
//
// WHY IT IS BUILT THIS WAY
//   A paragraph above a form is the thing users scroll past fastest,
//   and on a phone it pushes the first field below the fold. So the
//   only text that is always on screen is a single sentence saying what
//   the page is for. Everything else is one tap away.
//
//   Open by default on desktop, collapsed on mobile — the constraint is
//   vertical space, and only the phone has that problem.
//
// Module-level, like every other helper on this page, so it is not
// redefined on each render.

function PageIntro({ title, summary, body, steps, tone = 'teal' }: {
  title: string
  summary: string
  body?: string[]
  steps?: { label: string; text: string }[]
  tone?: 'teal' | 'navy'
}) {
  const isMobile = useIsMobile()
  // Desktop opens expanded; mobile starts collapsed. Deliberately not
  // persisted — there is no dismissal state to get wrong, and a user who
  // wants it gone simply collapses it.
  const [open, setOpen] = useState(!isMobile)
  const hasMore = (body && body.length > 0) || (steps && steps.length > 0)

  const accent = tone === 'navy' ? NAVY : TEAL
  const bg     = tone === 'navy' ? '#F1F5F9' : '#F0FDF4'
  const border = tone === 'navy' ? '#CBD5E1' : '#BBF7D0'

  return (
    <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:'12px', padding:'13px 15px', marginBottom:'18px' }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:'10px' }}>
        <span style={{ fontSize:'16px', lineHeight:1.3, flexShrink:0 }}>💡</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:'13px', fontWeight:'700', color:accent, marginBottom:'2px' }}>{title}</div>
          <div style={{ fontSize:'12px', color:'#475569', lineHeight:1.6 }}>{summary}</div>
        </div>
        {hasMore && (
          <button type="button" onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            style={{ background:'white', border:`1px solid ${border}`, borderRadius:'8px',
              padding:'6px 11px', cursor:'pointer', fontSize:'11px', fontWeight:'600',
              color:accent, whiteSpace:'nowrap', minHeight:'32px', flexShrink:0 }}>
            {open ? 'Hide' : 'How it works'}
          </button>
        )}
      </div>

      {open && hasMore && (
        <div style={{ marginTop:'11px', paddingTop:'11px', borderTop:`1px solid ${border}` }}>
          {body?.map((p, i) => (
            <p key={i} style={{ fontSize:'12px', color:'#475569', lineHeight:1.65, margin:i === 0 ? '0 0 8px' : '0 0 8px' }}>{p}</p>
          ))}
          {steps && steps.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:'7px', marginTop: body?.length ? '4px' : 0 }}>
              {steps.map((s, i) => (
                <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:'9px' }}>
                  <span style={{ background:accent, color:'white', borderRadius:'50%', width:'19px', height:'19px',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px',
                    fontWeight:'700', flexShrink:0, marginTop:'1px' }}>{i + 1}</span>
                  <div style={{ fontSize:'12px', color:'#475569', lineHeight:1.55 }}>
                    <strong style={{ color:NAVY }}>{s.label}</strong> — {s.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


export default function GroupsPage() {
  const isMobile = useIsMobile()
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
  // Non-null when the roster request failed. Kept separate from an empty
  // roster so the two can never render the same way again.
  const [membersError, setMembersError]     = useState<string|null>(null)
  const [blockedRemoveIds, setBlockedRemoveIds] = useState<Set<string>>(new Set())
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [editForm, setEditForm]          = useState<any>(null)
  const [editSaving, setEditSaving]      = useState(false)
  const [editLocation, setEditLocation]  = useState({ countryCode:'', provinceCode:'', city:'', currency:'' })
  const [deleteSaving, setDeleteSaving]  = useState(false)
  const [deleteCheck, setDeleteCheck]    = useState<any>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [openAccordion, setOpenAccordion]  = useState<string[]>(['group-details'])
  const [allBrands, setAllBrands]          = useState<any[]>([])
  const [refCurrencies, setRefCurrencies]  = useState<any[]>([])
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null)
  const [invitations, setInvitations]      = useState<any[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [inviteActionId, setInviteActionId] = useState<string | null>(null)
  const [pendingPayments, setPendingPayments] = useState<any[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [paymentActionId, setPaymentActionId] = useState<string | null>(null)
  const [joinRequests, setJoinRequests]       = useState<any[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [requestActionId, setRequestActionId] = useState<string | null>(null)
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null)

  // Lazy-load the full currency list only when the Settings tab first opens
  useEffect(() => {
    if (detailTab !== 'settings' || refCurrencies.length > 0) return
    fetch('/api/reference?type=currencies')
      .then(r => r.json())
      .then(d => { if (d.success) setRefCurrencies([...d.data].sort((a:any,b:any)=>a.id.localeCompare(b.id))) })
      .catch(() => {})
  }, [detailTab, refCurrencies.length])

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
          publicAdvert:        editForm.publicAdvert || '',
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
          publicAdvert:        editForm.publicAdvert || '',
          // editForm carries only the officer IDs. Without these two the
          // patch would leave the OLD treasurerName/secretaryName on
          // selectedGroup, so reassigning an officer would show the
          // previous person's name until the next full reload.
          //
          // Resolved from the roster where possible; where the officer
          // is not in the roster (non-ACTIVE membership) we clear the
          // name and let the helper fall back to the em-dash until
          // fetchGroups supplies the authoritative value.
          treasurerName: editForm.treasurerId
            ? (groupMembers.find((m:any)=>(m.userId||m.id)===editForm.treasurerId)?.fullName || '')
            : '',
          secretaryName: editForm.secretaryId
            ? (groupMembers.find((m:any)=>(m.userId||m.id)===editForm.secretaryId)?.fullName || '')
            : '',
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
  //
  // A failed request must NEVER render as "No members yet". Before this,
  // a 404 on /api/members produced an HTML error page, mRes.json() threw
  // parsing it, and the catch below set an empty array — so a dead
  // endpoint and an empty group looked identical on screen. The route
  // file was named api-members-route.ts instead of route.ts and had
  // never resolved in production; the UI reported "No members yet" for
  // every group for as long as that was true.
  //
  // membersError is now set on any non-OK response, non-JSON body, or
  // { success: false } payload, and the Members tab renders a retry
  // panel with the status code instead of the friendly empty state.
  const fetchGroupMembers = useCallback(async (groupId: string) => {
    setMembersLoading(true)
    setMembersError(null)
    try {
      // Roster + the set of members with a financial footprint (blocked from
      // removal) fetched in parallel — never sequential.
      const [mRes, bRes] = await Promise.all([
        fetch(`/api/members?groupId=${groupId}`),
        fetch(`/api/members/remove?groupId=${groupId}`),
      ])

      // Check transport BEFORE parsing. A 404 or 500 returns HTML, and
      // .json() on HTML throws a SyntaxError that says nothing useful.
      if (!mRes.ok) {
        setGroupMembers([])
        setMembersError(
          mRes.status === 404
            ? 'Member service not found (404). The /api/members route is not deployed.'
            : `Could not load members (HTTP ${mRes.status}).`
        )
      } else {
        let data: any = null
        try {
          data = await mRes.json()
        } catch {
          setGroupMembers([])
          setMembersError('Member service returned an unreadable response.')
        }

        if (data) {
          if (data.success) {
            const members = data.data || []
            // Normalise: ensure every member has a userId field
            const normalised = members.map((m: any) => ({
              ...m,
              userId: m.userId || m.user?.id || m.id,
              fullName: m.fullName || m.user?.fullName || m.name || '?',
            }))
            setGroupMembers(normalised)
          } else {
            setGroupMembers([])
            setMembersError(data.error || 'Could not load members.')
          }
        }
      }

      try {
        const bData = await bRes.json()
        setBlockedRemoveIds(new Set<string>(bData?.success ? (bData.data?.blockedUserIds || []) : []))
      } catch { setBlockedRemoveIds(new Set<string>()) }
    } catch (e: any) {
      setGroupMembers([])
      setBlockedRemoveIds(new Set<string>())
      setMembersError('Network error while loading members.')
    }
    finally { setMembersLoading(false) }
  }, [])

  // ── Remove a member from the group ──────────────────────────
  // Soft-remove (status → EXITED). The API is the source of truth for the
  // financial-integrity rule: a member with ANY transaction under the group,
  // across every Windfall Scheme, cannot be removed.
  async function handleRemoveMember(groupId: string, userId: string, memberName: string) {
    if (removingMemberId) return
    if (!window.confirm(`Remove ${memberName} from this group? They can be re-invited later.\n\nMembers with any group transactions cannot be removed.`)) return
    setRemovingMemberId(userId)
    try {
      const res  = await fetch(`/api/members/remove?groupId=${groupId}&userId=${userId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        showToast(data.message || 'Member removed')
        fetchGroupMembers(groupId)
        fetchGroups()
      } else {
        // Blocked by the financial-integrity rule → keep the button locked.
        if (data.blocked) setBlockedRemoveIds(prev => new Set(prev).add(userId))
        showToast(data.error || 'Could not remove member', 'error')
      }
    } catch { showToast('Network error', 'error') }
    finally { setRemovingMemberId(null) }
  }

  // ── Invitations: lazy-load list for a group ─────────────────
  const fetchInvitations = useCallback(async (groupId: string) => {
    setInvitesLoading(true)
    try {
      const res  = await fetch(`/api/invitations?groupId=${groupId}`)
      const data = await res.json()
      setInvitations(data.success ? (data.data || []) : [])
    } catch { setInvitations([]) }
    finally { setInvitesLoading(false) }
  }, [])

  // Resend an invitation (extends expiry 7 days, re-sends email)
  async function handleResendInvite(invitationId: string, groupId: string) {
    if (inviteActionId) return
    setInviteActionId(invitationId)
    try {
      const res  = await fetch('/api/invitations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'RESEND', invitationId }),
      })
      const data = await res.json()
      if (data.success) { showToast(data.message || 'Invitation resent'); fetchInvitations(groupId) }
      else showToast(data.error || 'Resend failed', 'error')
    } catch { showToast('Network error', 'error') }
    finally { setInviteActionId(null) }
  }

  // Cancel an invitation (revokes the link)
  async function handleCancelInvite(invitationId: string, email: string, groupId: string) {
    if (inviteActionId) return
    if (!window.confirm(`Cancel the invitation for ${email}? The link will stop working.`)) return
    setInviteActionId(invitationId)
    try {
      const res  = await fetch('/api/invitations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'CANCEL', invitationId }),
      })
      const data = await res.json()
      if (data.success) { showToast(data.message || 'Invitation cancelled'); fetchInvitations(groupId) }
      else showToast(data.error || 'Cancel failed', 'error')
    } catch { showToast('Network error', 'error') }
    finally { setInviteActionId(null) }
  }

  // ── Pending payments (treasurer confirmation) ───────────────
  const fetchPendingPayments = useCallback(async (groupId: string) => {
    setPaymentsLoading(true)
    try {
      const res  = await fetch(`/api/payments?groupId=${groupId}`)
      const data = await res.json()
      setPendingPayments(data.success ? (data.data || []) : [])
    } catch { setPendingPayments([]) }
    finally { setPaymentsLoading(false) }
  }, [])

  async function handlePaymentAction(transactionId: string, action: 'CONFIRM' | 'REJECT', groupId: string) {
    if (paymentActionId) return
    if (action === 'REJECT' && !window.confirm('Reject this payment? The member will need to resubmit.')) return
    setPaymentActionId(transactionId)
    try {
      const res  = await fetch('/api/payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, transactionId }),
      })
      const data = await res.json()
      if (data.success) { showToast(data.message || 'Done'); fetchPendingPayments(groupId) }
      else showToast(data.error || 'Action failed', 'error')
    } catch { showToast('Network error', 'error') }
    finally { setPaymentActionId(null) }
  }

  // ── Join requests (Public group discovery) ──────────────────
  const fetchJoinRequests = useCallback(async (groupId: string) => {
    setRequestsLoading(true)
    try {
      const res  = await fetch(`/api/discover?pendingFor=${groupId}`)
      const data = await res.json()
      setJoinRequests(data.success ? (data.data || []) : [])
    } catch { setJoinRequests([]) }
    finally { setRequestsLoading(false) }
  }, [])

  async function handleJoinRequest(requestId: string, action: 'APPROVE' | 'DECLINE', groupId: string) {
    if (requestActionId) return
    if (action === 'DECLINE' && !window.confirm('Decline this join request?')) return
    setRequestActionId(requestId)
    try {
      const res  = await fetch('/api/discover', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, requestId }),
      })
      const data = await res.json()
      if (data.success) { showToast(data.message || 'Done'); fetchJoinRequests(groupId); fetchGroupMembers(groupId) }
      else showToast(data.error || 'Action failed', 'error')
    } catch { showToast('Network error', 'error') }
    finally { setRequestActionId(null) }
  }

  // ── Change group status ─────────────────────────────────────
  async function handleStatusChange(groupId: string, newStatus: string, groupName: string) {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    if (statusChangingId) return   // guard against double-clicks
    setStatusChangingId(groupId)
    try {
      // ── Activation is a PAID action ─────────────────────────
      // Business rule: the group subscription is charged at activation,
      // priced by the group's country + configured capacity (maxMembers).
      // Start the Stripe checkout; the webhook flips the group to ACTIVE
      // once payment lands. If a live subscription already exists (409 —
      // e.g. reactivating from PAUSED while billing continued), fall
      // through to the plain status update below, which the API permits.
      if (newStatus === 'ACTIVE') {
        const payRes = await fetch('/api/payments/group-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId }),
        })
        const pay = await payRes.json()
        if (pay.success && pay.data?.checkoutUrl) {
          const tierLabel = pay.data.tierMax
            ? `up to ${pay.data.tierMax} members`
            : `${pay.data.tierMin ?? 1}+ members`
          showToast(`Group subscription: ${pay.data.currency} ${Number(pay.data.amount).toFixed(2)}/month (${tierLabel}) — redirecting to checkout…`)
          window.location.href = pay.data.checkoutUrl
          return
        }
        if (payRes.status !== 409) {
          showToast(pay.error || 'Could not start the group subscription', 'error')
          return
        }
        // 409 = live subscription exists → plain reactivation below
      }

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
          publicAdvert: group.publicAdvert||'',
        }),
      })
      const data = await res.json()
      if (data.success) {
        const msg = newStatus === 'ACTIVE'
          ? `✅ "${groupName}" has been activated`
          : newStatus === 'PAUSED'
          ? `"${groupName}" has been paused`
          : `"${groupName}" is now ${newStatus}`
        showToast(msg)
        setSelectedGroup((prev: any) => prev ? { ...prev, status: newStatus } : prev)
        fetchGroups()
      } else {
        showToast(data.error || 'Status change failed', 'error')
      }
    } catch { showToast('Network error', 'error') }
    finally { setStatusChangingId(null) }
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

  // ── Returning from Stripe group-subscription checkout ───────
  // ?activated=1 means Stripe redirected back after payment — the
  // WEBHOOK flips the group to ACTIVE, and it can lag the redirect by
  // a few seconds, so refetch once now and again shortly after.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('activated') === '1') {
      showToast('✅ Payment received — activating your group…')
      window.history.replaceState({}, '', '/dashboard/groups')
      const t1 = setTimeout(() => fetchGroups(), 3000)
      const t2 = setTimeout(() => fetchGroups(), 8000)
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
    if (params.get('activation_cancelled') === '1') {
      showToast('Group activation cancelled — no charge was made', 'error')
      window.history.replaceState({}, '', '/dashboard/groups')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchGroups])

  // Auto-fetch members when a group detail is opened
  useEffect(() => {
    if (selectedGroup) {
      setGroupMembers([])
      setInvitations([])
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
          publicAdvert:        form.publicAdvert || '',
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

  // ── MOBILE BRANCHES ─────────────────────────────────────────
  // Phone layouts return early; the desktop JSX below is untouched.
  // DETAIL IS CHECKED FIRST — with the order reversed, tapping a group
  // on a phone falls straight back to the list.
  if (isMobile && view === 'detail' && selectedGroup) {
    return (
      <MobileGroupDetail
        group={selectedGroup}
        members={groupMembers}
        membersLoading={membersLoading}
        currentUserId={currentUserId}
        canManage={selectedGroup.adminUserId === currentUserId}
        onBack={() => { setView('list'); setSelectedGroup(null) }}
        onInvite={() => { setInviteGroupId(selectedGroup.id); setShowInviteModal(true) }}
        onOpenScheme={() => { setDetailTab('schemes') }}
      />
    )
  }

  if (isMobile && view === 'list') {
    return (
      <MobileGroupsList
        groups={groups}
        loading={loading}
        currentUserId={currentUserId}
        onOpenGroup={(g: any) => { setSelectedGroup(g); setView('detail') }}
        onCreateGroup={() => setView('create')}
      />
    )
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
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={() => { window.location.href = '/portal' }} style={{ background:'white', color:NAVY, border:'1.5px solid #E2E8F0', borderRadius:'8px', padding:'10px 16px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
            👤 My Portal
          </button>
          <button onClick={() => setView('create')} style={{ background:TEAL, color:'white', border:'none', borderRadius:'8px', padding:'10px 18px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
            + Create Group
          </button>
        </div>
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
                {['Group Name','Country','City','Type','Status','Members','Date Created','Actions'].map(h => (
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:'11px', fontWeight:'600', color:'#64748B', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((g: any, i: number) => {
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

                    {/* Country */}
                    <td style={{ padding:'12px 14px', fontSize:'12px', color:'#475569', whiteSpace:'nowrap' }}>
                      {countryName(g.country)}
                    </td>

                    {/* City */}
                    <td style={{ padding:'12px 14px', fontSize:'12px', color:'#475569', whiteSpace:'nowrap' }}>
                      {g.city || '—'}
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

                    {/* Date Created */}
                    <td style={{ padding:'12px 14px', fontSize:'12px', color:'#475569', whiteSpace:'nowrap' }}>
                      {g.createdAt ? new Date(g.createdAt).toLocaleDateString(undefined, { day:'2-digit', month:'short', year:'numeric' }) : '—'}
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

      <PageIntro
        title="Creating your group"
        summary="Fill in the details below. Your group can run one or more Windfall Schemes — savings, grocery, loans, assets, property or investment."
        body={[
          'A group is the people. The schemes are what they save for. You set the schemes up afterwards, so nothing here locks you in.',
        ]}
        steps={[
          { label: 'Create the group',  text: 'Name, country, currency and contribution settings.' },
          { label: 'Invite members',    text: 'They join automatically when they accept the email.' },
          { label: 'Add your schemes',  text: 'Set up each Windfall Scheme once your members are in.' },
        ]}
      />

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
            { id:'cr-branding', icon:'🏷️', label:'Branding',      required:false },
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
                          {form.groupType === 'PUBLIC' && (
                            <div style={{ marginTop:'10px' }}>
                              <label style={LABEL}>Public Advert <span style={{ color:'#94A3B8', fontWeight:400 }}>(shown to pool members on Discover Groups)</span></label>
                              <textarea value={form.publicAdvert} onChange={e => setForm(f => ({...f, publicAdvert: e.target.value}))} maxLength={600} rows={3}
                                placeholder="e.g. We are interested in members of the public living in Zimbabwe around the Bulawayo area. Interested members should be able to provide 2 referees."
                                style={{ ...INPUT, resize:'vertical' as any, fontFamily:'inherit', lineHeight:1.5 }} />
                              <div style={{ fontSize:'10px', color:'#94A3B8', textAlign:'right' }}>{(form.publicAdvert||'').length}/600</div>
                            </div>
                          )}
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
                          onNameSuggested={name => setForm(f => {
                            // ONLY fill an EMPTY name field.
                            //
                            // CountrySelector emits the local savings term for
                            // the chosen country — Mukando, Chama, Stokvel — and
                            // re-emits on every province and city change too.
                            // Applied unconditionally it wiped whatever the user
                            // had typed, every time they touched Location. The
                            // edit form has always passed a no-op here for the
                            // same reason.
                            if (f.name && f.name.trim()) return f
                            return { ...f, name }
                          })}
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
                          Optionally choose the local savings tradition that best represents this group. It appears on the group dashboard, and can be set or changed later in Settings.
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
              disabled={statusChangingId === g.id}
              style={{ padding:'8px 16px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor: statusChangingId === g.id ? 'wait' : 'pointer', opacity: statusChangingId === g.id ? 0.6 : 1, transition:'opacity 0.15s' }}>
              {statusChangingId === g.id ? '⏳ Activating…' : '▶️ Activate Group'}
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
            <button key={t} onClick={() => { setDetailTab(t); if (t === 'members' || t === 'schemes') fetchGroupMembers(g.id); if (t === 'members') { fetchInvitations(g.id); fetchPendingPayments(g.id); fetchJoinRequests(g.id) } }} style={{
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
                  disabled={statusChangingId === g.id}
                  style={{ padding:'9px 18px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor: statusChangingId === g.id ? 'wait' : 'pointer', flexShrink:0, opacity: statusChangingId === g.id ? 0.6 : 1, transition:'opacity 0.15s' }}>
                  {statusChangingId === g.id ? '⏳ Activating…' : '▶️ Activate Now'}
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
                                ['Treasurer',    officerName(g.treasurerName, g.treasurerId, groupMembers)],
                                ['Secretary',    officerName(g.secretaryName, g.secretaryId, groupMembers)],
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
                  {membersLoading ? '...' : membersError ? 'Roster unavailable' : `${groupMembers.length} of ${g.maxMembers} members`}
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

            {/* ── Join Requests (Public group discovery) ── */}
            {(() => {
              if (requestsLoading && joinRequests.length === 0) return null
              if (joinRequests.length === 0) return null
              return (
                <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
                  <div style={{ padding:'12px 16px', background:'#EFF6FF', borderBottom:'1px solid #BFDBFE', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:'12px', fontWeight:'700', color:NAVY, textTransform:'uppercase', letterSpacing:'0.03em' }}>
                      🙋 Join Requests ({joinRequests.length})
                    </span>
                    <button onClick={() => fetchJoinRequests(g.id)} style={{ padding:'5px 10px', background:'white', border:'1px solid #E2E8F0', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#475569' }}>↻ Refresh</button>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    {joinRequests.map((r: any) => {
                      const busy = requestActionId === r.id
                      const open = expandedRequestId === r.id
                      const app  = r.application || null
                      const QA_SECTIONS: [string, [string, string][]][] = app ? [
                        ['About the applicant', [
                          ['Full Name', app.fullName], ['Preferred Name', app.preferredName],
                          ['Nationality', app.nationality], ['Country of Residence', app.countryOfResidence],
                          ['Residential Address', app.residentialAddress], ['Mobile', app.mobileNumber],
                          ['Email', app.emailAddress], ['Occupation', app.occupation], ['Employer / Business', app.employer],
                        ]],
                        ['Membership suitability', [
                          ['Why join this stokvel?', app.whyJoin],
                          ['Belonged to a savings group before?', app.belongedBefore],
                          ['Which one?', app.prevGroupName], ['How long a member?', app.membershipDuration],
                          ['Why did they leave?', app.whyLeft],
                          ['Ever defaulted on contributions?', app.everDefaulted],
                          ['Ever expelled from a savings group?', app.everExpelled],
                        ]],
                        ['Financial commitment', [
                          ['Able to contribute the required amount?', app.canContribute],
                          ['Preferred payment method', (app.paymentMethod||'').replace('_',' ')],
                          ['Account details', app.paymentDetail],
                          ['Preferred payout method', (app.payoutMethod||'').replace('_',' ')],
                          ['Understands late-payment penalties', app.understandPenalties ? 'YES' : 'NO'],
                          ['Agrees to the constitution', app.agreeConstitution ? 'YES' : 'NO'],
                        ]],
                      ] : []
                      return (
                        <div key={r.id} style={{ borderBottom:'1px solid #F1F5F9' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px 16px' }}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                                {r.fullName}
                              </div>
                              <div style={{ fontSize:'11px', color:'#94A3B8', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                                {r.email || r.phone} · requested {new Date(r.requestedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                              </div>
                            </div>
                            {app && (
                              <button onClick={() => setExpandedRequestId(open ? null : r.id)}
                                style={{ padding:'6px 12px', background:'#EFF6FF', color:'#1E40AF', border:'1px solid #BFDBFE', borderRadius:'7px', fontSize:'11px', fontWeight:'600', cursor:'pointer', whiteSpace:'nowrap' }}>
                                {open ? '▲ Hide application' : '📋 View application'}
                              </button>
                            )}
                            <button onClick={() => handleJoinRequest(r.id, 'APPROVE', g.id)} disabled={busy}
                              style={{ padding:'6px 12px', background:TEAL, color:'white', border:'none', borderRadius:'7px', fontSize:'11px', fontWeight:'600', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace:'nowrap' }}>
                              {busy ? '…' : '✓ Admit'}
                            </button>
                            <button onClick={() => handleJoinRequest(r.id, 'DECLINE', g.id)} disabled={busy}
                              style={{ padding:'6px 12px', background:'white', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'7px', fontSize:'11px', fontWeight:'600', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace:'nowrap' }}>
                              Decline
                            </button>
                          </div>
                          {open && app && (
                            <div style={{ padding:'0 16px 14px' }}>
                              {QA_SECTIONS.map(([secTitle, rows]) => (
                                <div key={secTitle} style={{ marginBottom:'10px' }}>
                                  <div style={{ fontSize:'10px', fontWeight:'700', color:TEAL, textTransform:'uppercase', letterSpacing:'0.04em', margin:'8px 0 6px' }}>{secTitle}</div>
                                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:'6px' }}>
                                    {rows.filter(([,v]) => v !== '' && v != null).map(([q, v]) => (
                                      <div key={q} style={{ background:'#F8FAFC', borderRadius:'8px', padding:'8px 10px' }}>
                                        <div style={{ fontSize:'10px', color:'#94A3B8', marginBottom:'2px' }}>{q}</div>
                                        <div style={{ fontSize:'12px', color:NAVY, fontWeight:500, wordBreak:'break-word' }}>
                                          {v === 'YES' ? '✅ Yes' : v === 'NO' ? '❌ No' : String(v)}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* ── Pending Payments (treasurer confirmation) ── */}
            {(() => {
              if (paymentsLoading && pendingPayments.length === 0) return (
                <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'18px', textAlign:'center', color:'#94A3B8', fontSize:'12px' }}>
                  ⏳ Loading payments...
                </div>
              )
              if (pendingPayments.length === 0) return null
              return (
                <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
                  <div style={{ padding:'12px 16px', background:'#FFFBEB', borderBottom:'1px solid #FDE68A', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:'12px', fontWeight:'700', color:NAVY, textTransform:'uppercase', letterSpacing:'0.03em' }}>
                      💳 Payments Awaiting Confirmation ({pendingPayments.length})
                    </span>
                    <button onClick={() => fetchPendingPayments(g.id)} style={{ padding:'5px 10px', background:'white', border:'1px solid #E2E8F0', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#475569' }}>↻ Refresh</button>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    {pendingPayments.map((p: any) => {
                      const busy = paymentActionId === p.id
                      return (
                        <div key={p.id} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px 16px', borderBottom:'1px solid #F1F5F9' }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {p.memberName} · {p.currency === 'USD' ? '$' : p.currency + ' '}{Number(p.amount).toLocaleString()}
                            </div>
                            <div style={{ fontSize:'11px', color:'#94A3B8', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {(p.method || '').replace(/_/g,' ')} · Ref {p.reference || '—'}{p.description ? ` · ${p.description}` : ''}
                            </div>
                          </div>
                          <span style={{ fontSize:'10px', fontWeight:'600', padding:'3px 9px', borderRadius:'6px', whiteSpace:'nowrap', background: p.kind === 'SAVINGS' ? '#EDE9FE' : '#DBEAFE', color: p.kind === 'SAVINGS' ? '#5B21B6' : '#1E40AF' }}>
                            {p.kind === 'SAVINGS' ? '💰 Savings' : '📅 Group'}
                          </span>
                          <button onClick={() => handlePaymentAction(p.id, 'CONFIRM', g.id)} disabled={busy}
                            style={{ padding:'6px 12px', background:TEAL, color:'white', border:'none', borderRadius:'7px', fontSize:'11px', fontWeight:'600', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace:'nowrap' }}>
                            {busy ? '…' : '✓ Confirm'}
                          </button>
                          <button onClick={() => handlePaymentAction(p.id, 'REJECT', g.id)} disabled={busy}
                            style={{ padding:'6px 12px', background:'white', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'7px', fontSize:'11px', fontWeight:'600', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace:'nowrap' }}>
                            Reject
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* ── Pending Invitations ── */}
            {(() => {
              const pending = invitations.filter((i: any) => i.status === 'PENDING' || i.status === 'EXPIRED')
              if (invitesLoading && invitations.length === 0) return (
                <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'18px', textAlign:'center', color:'#94A3B8', fontSize:'12px' }}>
                  ⏳ Loading invitations...
                </div>
              )
              if (pending.length === 0) return null
              return (
                <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
                  <div style={{ padding:'12px 16px', background:'#F8FAFC', borderBottom:'1px solid #E2E8F0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:'12px', fontWeight:'700', color:NAVY, textTransform:'uppercase', letterSpacing:'0.03em' }}>
                      ✉️ Pending Invitations ({pending.length})
                    </span>
                    <button onClick={() => fetchInvitations(g.id)} style={{ padding:'5px 10px', background:'white', border:'1px solid #E2E8F0', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#475569' }}>↻ Refresh</button>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    {pending.map((inv: any) => {
                      const isExpired = inv.status === 'EXPIRED'
                      const busy = inviteActionId === inv.id
                      return (
                        <div key={inv.id} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px 16px', borderBottom:'1px solid #F1F5F9' }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {inv.fullName || inv.email || inv.phone || 'Invited member'}
                            </div>
                            <div style={{ fontSize:'11px', color:'#94A3B8', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {inv.email || inv.phone} · {inv.role || 'MEMBER'}
                            </div>
                          </div>
                          <span style={{ fontSize:'10px', fontWeight:'600', padding:'3px 9px', borderRadius:'6px', whiteSpace:'nowrap', background: isExpired ? '#FEE2E2' : '#FEF9C3', color: isExpired ? '#991B1B' : '#854D0E' }}>
                            {isExpired ? '⌛ Expired' : '⏳ Pending'}
                          </span>
                          <button onClick={() => handleResendInvite(inv.id, g.id)} disabled={busy}
                            style={{ padding:'6px 12px', background:TEAL, color:'white', border:'none', borderRadius:'7px', fontSize:'11px', fontWeight:'600', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace:'nowrap' }}>
                            {busy ? '…' : '↻ Resend'}
                          </button>
                          <button onClick={() => handleCancelInvite(inv.id, inv.email || inv.phone || 'this member', g.id)} disabled={busy}
                            style={{ padding:'6px 12px', background:'white', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'7px', fontSize:'11px', fontWeight:'600', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace:'nowrap' }}>
                            Cancel
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Loading */}
            {membersLoading && (
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'40px', textAlign:'center', color:'#94A3B8', fontSize:'13px' }}>
                ⏳ Loading members...
              </div>
            )}

            {/* Load failure — deliberately distinct from the empty state.
                Shows the reason and a retry rather than implying the
                group has no members. */}
            {!membersLoading && membersError && (
              <div style={{ background:'#FEF2F2', borderRadius:'12px', border:'1.5px solid #FECACA', padding:'28px', textAlign:'center' }}>
                <div style={{ fontSize:'32px', marginBottom:'10px' }}>⚠️</div>
                <h4 style={{ fontSize:'14px', fontWeight:'600', color:'#991B1B', margin:'0 0 6px' }}>Could not load members</h4>
                <p style={{ fontSize:'13px', color:'#B91C1C', margin:'0 0 4px' }}>{membersError}</p>
                <p style={{ fontSize:'11px', color:'#DC2626', margin:'0 0 16px' }}>
                  This group may still have members — the roster could not be read.
                </p>
                <button onClick={() => fetchGroupMembers(g.id)} style={{ padding:'9px 20px', background:'#B91C1C', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>↻ Retry</button>
              </div>
            )}

            {/* Empty state — only after a SUCCESSFUL load returning zero rows */}
            {!membersLoading && !membersError && groupMembers.length === 0 && (
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
                      {['#','Member','Contact','Country','Tier','KYC','Score','Status','Joined','Actions'].map(h => (
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
                          <td style={{ padding:'10px 12px', whiteSpace:'nowrap' }}>
                            {(() => {
                              const uid      = m.userId || m.id
                              const isOwner  = uid === g.adminUserId
                              const isExited = m.status === 'EXITED'
                              const blocked  = blockedRemoveIds.has(uid)
                              const busy     = removingMemberId === uid
                              if (isOwner)  return <span style={{ fontSize:'10px', color:'#94A3B8', fontWeight:'600' }}>Owner</span>
                              if (isExited) return <span style={{ fontSize:'10px', color:'#94A3B8' }}>Removed</span>
                              const disabled = blocked || busy
                              return (
                                <button
                                  onClick={() => handleRemoveMember(g.id, uid, m.fullName)}
                                  disabled={disabled}
                                  title={blocked ? 'This member has group transactions and cannot be removed' : 'Remove member from group'}
                                  style={{ padding:'6px 12px',
                                    background: disabled ? '#F1F5F9' : 'white',
                                    color:      disabled ? '#94A3B8' : '#991B1B',
                                    border:     `1px solid ${disabled ? '#E2E8F0' : '#FECACA'}`,
                                    borderRadius:'7px', fontSize:'11px', fontWeight:'600',
                                    cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace:'nowrap' }}>
                                  {busy ? '…' : blocked ? '🔒 Locked' : '✕ Remove'}
                                </button>
                              )
                            })()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'#F8FAFC', borderTop:'2px solid #E2E8F0' }}>
                      <td colSpan={10} style={{ padding:'10px 12px', fontSize:'12px', color:'#64748B' }}>
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
                { id:'banking',        icon:'🏦', label:'Bank Account & Signatories' },
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
                                  {ef.groupType === 'PUBLIC' && (
                                    <div style={{ marginTop:'10px' }}>
                                      <label style={LABEL}>Public Advert <span style={{ color:'#94A3B8', fontWeight:400 }}>(shown on Discover Groups)</span></label>
                                      <textarea value={ef.publicAdvert||''} onChange={e=>setEditForm((p: any) => ({...p, publicAdvert: e.target.value}))} maxLength={600} rows={3}
                                        placeholder="e.g. We are interested in members of the public living in Zimbabwe around the Bulawayo area. Interested members should be able to provide 2 referees."
                                        style={{...INPUT, resize:'vertical' as any, fontFamily:'inherit', lineHeight:1.5}}/>
                                      <div style={{ fontSize:'10px', color:'#94A3B8', textAlign:'right' }}>{(ef.publicAdvert||'').length}/600</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {sec.id === 'members' && (
                              <div style={GRID2}>
                                <div style={{ gridColumn:'1/-1' }}>
                                  <label style={LABEL}>Group Admin</label>
                                  <div style={{...INPUT, background:'#F8FAFC', color:'#64748B'}}>{g.adminName || '—'}</div>
                                </div>
                                <OfficerSelect
                                  label="Treasurer"
                                  valueId={ef.treasurerId || ''}
                                  serverName={g.treasurerName}
                                  roster={groupMembers}
                                  onChange={setEf('treasurerId')}
                                  inputStyle={INPUT}
                                  labelStyle={LABEL}
                                />
                                <OfficerSelect
                                  label="Secretary"
                                  valueId={ef.secretaryId || ''}
                                  serverName={g.secretaryName}
                                  roster={groupMembers}
                                  onChange={setEf('secretaryId')}
                                  inputStyle={INPUT}
                                  labelStyle={LABEL}
                                />
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
                                  {refCurrencies.length > 0
                                    ? refCurrencies.map((c:any)=>(
                                        <option key={c.id} value={c.id}>{c.id} — {c.name}</option>
                                      ))
                                    : CURRENCIES.map(c=>(
                                        <option key={c} value={c}>{c}</option>
                                      ))}
                                  {ef.currency
                                    && !refCurrencies.some((c:any)=>c.id===ef.currency)
                                    && (refCurrencies.length > 0 || !CURRENCIES.includes(ef.currency)) && (
                                    <option value={ef.currency}>{ef.currency}</option>
                                  )}
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
                                  Optionally choose the local savings tradition that best represents this group. It appears on the group dashboard, and can be set or changed later in Settings.
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

                            {sec.id === 'banking' && (
                              <GroupBankingPanel
                                groupId={g.id}
                                currency={ef.currency || g.currency || 'USD'}
                                groupMembers={groupMembers}
                                notify={showToast}
                              />
                            )}

                            {sec.id === 'documentation' && (
                              <GroupDocumentsPanel groupId={g.id} notify={showToast} />
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
