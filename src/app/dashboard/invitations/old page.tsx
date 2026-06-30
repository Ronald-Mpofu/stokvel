'use client'
import { useState, useEffect, useCallback } from 'react'
import SendInviteModal from './SendInviteModal'

const TEAL = '#0F6E56'; const NAVY = '#0D2137'

const STATUS_META: Record<string, any> = {
  PENDING:   { bg:'#DBEAFE', color:'#1E40AF', icon:'⏳', label:'Pending'   },
  ACCEPTED:  { bg:'#DCFCE7', color:'#166534', icon:'✅', label:'Accepted'  },
  EXPIRED:   { bg:'#FEE2E2', color:'#991B1B', icon:'⏰', label:'Expired'   },
  CANCELLED: { bg:'#F1F5F9', color:'#475569', icon:'🚫', label:'Cancelled' },
  RESENT:    { bg:'#FEF9C3', color:'#854D0E', icon:'📤', label:'Resent'    },
}

function Toast({ msg, type, onClose }: any) {
  useEffect(() => { const t = setTimeout(onClose, 5000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position:'fixed', top:'20px', right:'20px', zIndex:9999, padding:'12px 20px', borderRadius:'10px', fontWeight:'500', fontSize:'13px', boxShadow:'0 8px 25px rgba(0,0,0,0.15)', background:type==='success'?'#166534':'#991B1B', color:'white', display:'flex', alignItems:'center', gap:'10px', maxWidth:'420px' }}>
      <span>{type==='success'?'✅':'❌'}</span><span style={{ flex:1 }}>{msg}</span>
      <button onClick={onClose} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:'18px' }}>×</button>
    </div>  )
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

export default function InvitationsPage() {
  const [invitations, setInvitations]   = useState<any[]>([])
  const [groups, setGroups]             = useState<any[]>([])
  const [loading, setLoading]           = useState(true)
  const [toast, setToast]               = useState<any>(null)
  const [showSend, setShowSend]         = useState(false)
  const [filterGroup, setFilterGroup]   = useState('ALL')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [search, setSearch]             = useState('')
  const [expandedId, setExpandedId]     = useState<string|null>(null)
  const [currentUserId, setCurrentUserId] = useState<string>('')

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => { if (d.success && d.data?.id) setCurrentUserId(d.data.id) })
      .catch(() => {})
  }, [])

  function showToast(msg: string, type = 'success') { setToast({ msg, type }) }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [gRes] = await Promise.all([fetch('/api/groups')])
      const gData  = await gRes.json()
      if (gData.success) {
        setGroups(gData.data)
        // Fetch invitations for all groups
        const allInvs: any[] = []
        for (const g of gData.data) {
          const iRes  = await fetch(`/api/invitations?groupId=${g.id}`)
          const iData = await iRes.json()
          if (iData.success) allInvs.push(...iData.data)
        }
        allInvs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setInvitations(allInvs)
      }
    } catch { showToast('Failed to load data', 'error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleCancel(invId: string) {
    try {
      const res  = await fetch('/api/invitations', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'CANCEL', invitationId: invId }) })
      const data = await res.json()
      if (data.success) { showToast('Invitation cancelled'); fetchData() }
      else showToast(data.error || 'Failed', 'error')
    } catch { showToast('Network error', 'error') }
  }

  async function handleResend(invId: string) {
    try {
      const res  = await fetch('/api/invitations', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'RESEND', invitationId: invId }) })
      const data = await res.json()
      if (data.success) { showToast(data.message); fetchData() }
      else showToast(data.error || 'Failed', 'error')
    } catch { showToast('Network error', 'error') }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url)
    showToast('Invitation link copied to clipboard!')
  }

  const filtered = invitations.filter(inv => {
    const ms  = (inv.fullName||'').toLowerCase().includes(search.toLowerCase()) || (inv.email||'').toLowerCase().includes(search.toLowerCase()) || (inv.phone||'').includes(search)
    const mg  = filterGroup  === 'ALL' || inv.groupId  === filterGroup
    const mst = filterStatus === 'ALL' || inv.status   === filterStatus
    return ms && mg && mst
  })

  const summary = {
    total:    invitations.length,
    pending:  invitations.filter(i => i.status === 'PENDING').length,
    accepted: invitations.filter(i => i.status === 'ACCEPTED').length,
    expired:  invitations.filter(i => ['EXPIRED','CANCELLED'].includes(i.status)).length,
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'20px' }}>

      <VersionBadge label="✉️ Invitations" ver="v1.2" />
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {showSend && <SendInviteModal groups={groups} currentUserId={currentUserId} onClose={() => setShowSend(false)} onSuccess={() => { fetchData() }} />}

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <h2 style={{ fontSize:'20px', fontWeight:'700', color:NAVY, margin:'0 0 4px' }}>✉️ Member Invitations</h2>
          <p style={{ fontSize:'13px', color:'#64748B', margin:0 }}>Invite, track and manage membership invitations</p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={fetchData} style={{ padding:'8px 12px', background:'#F1F5F9', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#475569' }}>↻</button>
          <button onClick={() => setShowSend(true)} style={{ padding:'10px 18px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>+ Send Invitation</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px' }}>
        {[
          { label:'Total Sent',  value:loading?'—':summary.total,    color:NAVY    },
          { label:'Pending',     value:loading?'—':summary.pending,  color:'#1A5EA8' },
          { label:'Accepted',   value:loading?'—':summary.accepted, color:TEAL    },
          { label:'Expired',    value:loading?'—':summary.expired,  color:'#991B1B' },
        ].map(s => (
          <div key={s.label} style={{ background:'white', borderRadius:'10px', padding:'14px 16px', border:'1px solid #E2E8F0' }}>
            <div style={{ fontSize:'11px', color:'#64748B', marginBottom:'4px' }}>{s.label}</div>
            <div style={{ fontSize:'24px', fontWeight:'700', color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', alignItems:'center' }}>
        <input placeholder="Search by name, email or phone..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding:'8px 14px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', width:'260px', outline:'none' }} />
        <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
          style={{ padding:'8px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white' }}>
          <option value="ALL">All Groups</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        {['ALL','PENDING','ACCEPTED','EXPIRED','CANCELLED'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{ padding:'6px 14px', borderRadius:'999px', fontSize:'12px', fontWeight:'500', cursor:'pointer', background:filterStatus===s?TEAL:'white', color:filterStatus===s?'white':'#64748B', border:filterStatus===s?'none':'1.5px solid #E2E8F0' }}>{s}</button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'28px', marginBottom:'10px' }}>⏳</div><p style={{ color:'#64748B' }}>Loading invitations...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'40px', marginBottom:'12px' }}>✉️</div>
          <h3 style={{ fontSize:'16px', fontWeight:'600', color:NAVY, margin:'0 0 8px' }}>
            {invitations.length === 0 ? 'No invitations sent yet' : 'No invitations match your filter'}
          </h3>
          {invitations.length === 0 && <button onClick={() => setShowSend(true)} style={{ padding:'10px 20px', background:TEAL, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer', marginTop:'12px' }}>+ Send First Invitation</button>}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
          {filtered.map(inv => {
            const sm      = STATUS_META[inv.status] || STATUS_META.PENDING
            const isOpen  = expandedId === inv.id
            const grp     = groups.find(g => g.id === inv.groupId)
            return (
              <div key={inv.id} style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
                {/* Main row */}
                <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'14px 18px', flexWrap:'wrap' }}>
                  {/* Avatar */}
                  <div style={{ width:'40px', height:'40px', borderRadius:'50%', background:'#E1F5EE', color:TEAL, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', fontWeight:'700', flexShrink:0 }}>
                    {inv.fullName ? inv.fullName.split(' ').map((n: string) => n[0]).join('').slice(0,2) : '?'}
                  </div>

                  {/* Details */}
                  <div style={{ flex:1, minWidth:'160px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                      <span style={{ fontSize:'14px', fontWeight:'600', color:NAVY }}>{inv.fullName || 'Unknown'}</span>
                      <span style={{ background:sm.bg, color:sm.color, fontSize:'10px', fontWeight:'600', padding:'2px 7px', borderRadius:'4px' }}>{sm.icon} {sm.label}</span>
                      <span style={{ fontSize:'11px', color:'#94A3B8' }}>{inv.role}</span>
                    </div>
                    <div style={{ fontSize:'12px', color:'#64748B', marginTop:'2px' }}>
                      {inv.email && <span>📧 {inv.email} </span>}
                      {inv.phone && <span>📱 {inv.phone} </span>}
                      {grp && <span style={{ color:'#94A3B8' }}>· {grp.name}</span>}
                    </div>
                  </div>

                  {/* Meta */}
                  <div style={{ fontSize:'11px', color:'#94A3B8', textAlign:'right', flexShrink:0 }}>
                    <div>Sent {new Date(inv.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
                    {inv.status === 'PENDING' && <div style={{ color:'#854D0E' }}>Expires in {inv.daysLeft}d</div>}
                    {inv.status === 'ACCEPTED' && inv.acceptedAt && <div style={{ color:TEAL }}>Joined {new Date(inv.acceptedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>}
                    <div style={{ display:'flex', gap:'4px', marginTop:'4px', justifyContent:'flex-end' }}>
                      {inv.emailSentAt && <span title="Email sent" style={{ fontSize:'14px' }}>📧</span>}
                      {inv.smsSentAt  && <span title="SMS sent"   style={{ fontSize:'14px' }}>📱</span>}
                      {inv.resendCount > 0 && <span style={{ fontSize:'10px', color:'#854D0E' }}>↻{inv.resendCount}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display:'flex', gap:'6px', flexShrink:0 }}>
                    <button onClick={() => copyLink(inv.inviteUrl)} title="Copy link"
                      style={{ padding:'6px 10px', background:'#EEF2FF', color:'#3730A3', border:'none', borderRadius:'6px', fontSize:'12px', cursor:'pointer' }}>
                      🔗
                    </button>
                    {inv.status === 'PENDING' && (
                      <>
                        <button onClick={() => handleResend(inv.id)}
                          style={{ padding:'6px 10px', background:'#FEF9C3', color:'#854D0E', border:'1px solid #FCD34D', borderRadius:'6px', fontSize:'11px', cursor:'pointer', fontWeight:'500' }}>
                          ↻ Resend
                        </button>
                        <button onClick={() => handleCancel(inv.id)}
                          style={{ padding:'6px 10px', background:'#FEF2F2', color:'#991B1B', border:'1px solid #FECACA', borderRadius:'6px', fontSize:'11px', cursor:'pointer' }}>
                          Cancel
                        </button>
                    ))}
                    <button onClick={() => setExpandedId(isOpen ? null : inv.id)}
                      style={{ padding:'6px 10px', background:'#F1F5F9', border:'none', borderRadius:'6px', fontSize:'12px', cursor:'pointer', color:'#475569' }}>
                      {isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {isOpen && (
                  <div style={{ padding:'14px 18px', borderTop:'1px solid #F1F5F9', background:'#FAFAFA' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', marginBottom:'12px' }}>
                      {[
                        ['Invitation Link', inv.inviteUrl],
                        ['Channel',        inv.channel],
                        ['Resend Count',   inv.resendCount],
                        ['Email Sent',     inv.emailSentAt ? new Date(inv.emailSentAt).toLocaleDateString('en-GB') : 'Not sent'],
                        ['SMS Sent',       inv.smsSentAt   ? new Date(inv.smsSentAt).toLocaleDateString('en-GB')   : 'Not sent'],
                        ['Expires',        new Date(inv.expiresAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})],
                      ].map(([l, v]) => (
                        <div key={l} style={{ background:'white', borderRadius:'8px', padding:'10px 12px', border:'1px solid #E2E8F0' }}>
                          <div style={{ fontSize:'10px', color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:'3px' }}>{l}</div>
                          <div style={{ fontSize:'12px', color:NAVY, wordBreak:'break-all' }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {inv.personalMessage && (
                      <div style={{ background:'#F0FDF4', borderRadius:'8px', padding:'10px 12px', border:'1px solid #BBF7D0', fontSize:'12px', color:'#166534', fontStyle:'italic' }}>
                        "{inv.personalMessage}"
                      </div>
                    )}
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
