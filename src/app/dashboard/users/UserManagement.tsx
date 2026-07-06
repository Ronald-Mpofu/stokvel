'use client'
// src/app/dashboard/users/UserManagement.tsx — v1.0
import { useState, useEffect, useCallback } from 'react'

const TEAL  = '#0F6E56'
const NAVY  = '#0D2137'
const RED   = '#DC2626'
const AMBER = '#B45309'

// ── Types ─────────────────────────────────────────────────────
type User = {
  id: string; fullName: string; email: string; phone: string
  role: string; status: string; kycStatus: string; tier: string
  reputationScore: number; country: string; city: string
  createdAt: string; lastLoginAt: string | null
  emailVerifiedAt: string | null; groupCount: number
  isBlacklisted: boolean; blacklistReason: string | null
}

// ── Constants ─────────────────────────────────────────────────
const ROLES = ['SYSTEM_ADMIN','NATIONAL_ADMIN','GROUP_ADMIN','TREASURER','INVESTMENT_MANAGER','MEMBER','AUDITOR']
const STATUSES = ['ACTIVE','SUSPENDED','DEFAULTED','EXITED','BLACKLISTED']
const KYC_STATUSES = ['PENDING','UNDER_REVIEW','VERIFIED','REJECTED']
const TIERS = ['BRONZE','SILVER','GOLD','PLATINUM']

const ROLE_COLORS: Record<string, [string,string]> = {
  SYSTEM_ADMIN:       ['#EDE9FE','#5B21B6'],
  NATIONAL_ADMIN:     ['#DBEAFE','#1E40AF'],
  GROUP_ADMIN:        ['#DCFCE7','#166534'],
  TREASURER:          ['#FEF9C3','#854D0E'],
  INVESTMENT_MANAGER: ['#FFE4E6','#9F1239'],
  MEMBER:             ['#F1F5F9','#475569'],
  AUDITOR:            ['#FEE2E2','#991B1B'],
}

const STATUS_COLORS: Record<string, [string,string]> = {
  ACTIVE:      ['#DCFCE7','#166534'],
  SUSPENDED:   ['#FEF9C3','#854D0E'],
  DEFAULTED:   ['#FEE2E2','#991B1B'],
  EXITED:      ['#F1F5F9','#475569'],
  BLACKLISTED: ['#1E293B','#F8FAFC'],
}

const KYC_COLORS: Record<string, [string,string]> = {
  PENDING:      ['#FEF9C3','#854D0E'],
  UNDER_REVIEW: ['#DBEAFE','#1E40AF'],
  VERIFIED:     ['#DCFCE7','#166534'],
  REJECTED:     ['#FEE2E2','#991B1B'],
}

const TIER_COLORS: Record<string, [string,string]> = {
  BRONZE:   ['#FEE2E2','#7F1D1D'],
  SILVER:   ['#F1F5F9','#475569'],
  GOLD:     ['#FEF3C7','#92400E'],
  PLATINUM: ['#EDE9FE','#5B21B6'],
}

// ── Badge helpers ─────────────────────────────────────────────
function Badge({ text, colors, size = 11 }: { text: string; colors: [string,string]; size?: number }) {
  return (
    <span style={{ background: colors[0], color: colors[1], fontSize: `${size}px`, fontWeight: '600',
      padding: '2px 8px', borderRadius: '999px', whiteSpace: 'nowrap' as any }}>
      {text.replace(/_/g,' ')}
    </span>
  )
}

function Toast({ msg, type, onClose }: any) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position:'fixed', top:'20px', right:'20px', zIndex:9999, padding:'12px 20px',
      borderRadius:'10px', fontWeight:'500', fontSize:'13px', boxShadow:'0 8px 25px rgba(0,0,0,0.15)',
      background: type==='success' ? '#166534' : '#991B1B', color:'white',
      display:'flex', alignItems:'center', gap:'10px' }}>
      <span>{type==='success' ? '✅' : '❌'}</span><span>{msg}</span>
      <button onClick={onClose} style={{ background:'none', border:'none', color:'white', cursor:'pointer', fontSize:'18px' }}>×</button>
    </div>
  )
}

// ── Email Notification Modal ──────────────────────────────────
function EmailModal({ user, onClose, onSent }: { user: User; onClose: () => void; onSent: (msg: string) => void }) {
  const [template, setTemplate] = useState('WELCOME')
  const [subject, setSubject]   = useState('')
  const [body, setBody]         = useState('')
  const [sending, setSending]   = useState(false)
  const [error, setError]       = useState('')

  const TEMPLATES: Record<string, { subject: string; body: string }> = {
    WELCOME: {
      subject: `Welcome to Windfall Community Deals, ${user.fullName}!`,
      body: `Dear ${user.fullName},\n\nWelcome to Windfall Community Deals! Your account has been created successfully.\n\nYou can now log in at https://stokvel-six.vercel.app and explore your dashboard.\n\nIf you have any questions, please don't hesitate to reach out.\n\nWarm regards,\nWindfall Community Deals Team`,
    },
    KYC_APPROVED: {
      subject: 'Your KYC Verification is Approved ✅',
      body: `Dear ${user.fullName},\n\nGreat news! Your identity verification (KYC) has been approved.\n\nYou now have full access to all platform features including loan applications and asset contributions.\n\nLog in at https://stokvel-six.vercel.app\n\nWarm regards,\nWindfall Community Deals Team`,
    },
    KYC_REJECTED: {
      subject: 'Action Required: KYC Verification Update',
      body: `Dear ${user.fullName},\n\nUnfortunately, your identity verification documents could not be verified at this time.\n\nPlease resubmit clearer copies of your:\n• National ID or Passport\n• Proof of address (utility bill or bank statement)\n\nLog in at https://stokvel-six.vercel.app to resubmit.\n\nIf you believe this is an error, please contact support.\n\nWarm regards,\nWindfall Community Deals Team`,
    },
    ACCOUNT_SUSPENDED: {
      subject: 'Your Account Has Been Suspended',
      body: `Dear ${user.fullName},\n\nYour Windfall Community Deals account has been temporarily suspended.\n\nThis may be due to:\n• Missed contribution payments\n• Outstanding loan obligations\n• Compliance requirements\n\nPlease contact your group administrator to resolve this matter.\n\nWarm regards,\nWindfall Community Deals Team`,
    },
    ROLE_CHANGED: {
      subject: 'Your Platform Role Has Been Updated',
      body: `Dear ${user.fullName},\n\nYour role on the Windfall Community Deals platform has been updated to: ${user.role.replace(/_/g,' ')}.\n\nThis change is effective immediately. Log in to see your updated permissions and features.\n\nhttps://stokvel-six.vercel.app\n\nWarm regards,\nWindfall Community Deals Team`,
    },
    CUSTOM: {
      subject: '',
      body: '',
    },
  }

  useEffect(() => {
    const t = TEMPLATES[template]
    setSubject(t.subject)
    setBody(t.body)
  }, [template])

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return setError('Subject and body are required')
    setSending(true); setError('')
    try {
      const res = await fetch('/api/users/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, email: user.email, fullName: user.fullName, subject, body, template }),
      })
      const data = await res.json()
      if (data.success) { onSent(`Email sent to ${user.email}`); onClose() }
      else setError(data.error || 'Failed to send email')
    } catch { setError('Network error') }
    finally { setSending(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'16px' }}>
      <div style={{ background:'white', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'560px', boxShadow:'0 25px 50px rgba(0,0,0,0.25)', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'20px' }}>
          <div>
            <h3 style={{ fontSize:'16px', fontWeight:'700', color:NAVY, margin:'0 0 4px' }}>📧 Send Email Notification</h3>
            <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>To: {user.fullName} · {user.email}</p>
          </div>
          <button onClick={onClose} style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', width:'32px', height:'32px', cursor:'pointer', fontSize:'18px', color:'#64748B' }}>×</button>
        </div>

        {/* Template selector */}
        <div style={{ marginBottom:'14px' }}>
          <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'6px' }}>Email Template</label>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
            {Object.keys(TEMPLATES).map(t => (
              <button key={t} onClick={() => setTemplate(t)}
                style={{ padding:'8px 10px', borderRadius:'8px', cursor:'pointer', fontSize:'11px', fontWeight:'600', textAlign:'left' as any,
                  border: `2px solid ${template===t ? TEAL : '#E2E8F0'}`,
                  background: template===t ? '#F0FDF4' : 'white',
                  color: template===t ? TEAL : '#475569' }}>
                {t==='WELCOME' && '👋 Welcome'}
                {t==='KYC_APPROVED' && '✅ KYC Approved'}
                {t==='KYC_REJECTED' && '❌ KYC Rejected'}
                {t==='ACCOUNT_SUSPENDED' && '🔒 Suspended'}
                {t==='ROLE_CHANGED' && '🔄 Role Changed'}
                {t==='CUSTOM' && '✏️ Custom Message'}
              </button>
            ))}
          </div>
        </div>

        {/* Subject */}
        <div style={{ marginBottom:'12px' }}>
          <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Subject *</label>
          <input value={subject} onChange={e => setSubject(e.target.value)}
            style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }} />
        </div>

        {/* Body */}
        <div style={{ marginBottom:'16px' }}>
          <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Message *</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
            style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', outline:'none', boxSizing:'border-box' as any, resize:'vertical' as any, fontFamily:'system-ui' }} />
        </div>

        {error && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'8px', padding:'10px', color:'#991B1B', fontSize:'12px', marginBottom:'12px' }}>❌ {error}</div>}

        <div style={{ display:'flex', gap:'10px' }}>
          <button onClick={onClose} style={{ flex:1, padding:'10px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#475569' }}>Cancel</button>
          <button onClick={handleSend} disabled={sending}
            style={{ flex:2, padding:'10px', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:sending?'not-allowed':'pointer',
              background: sending ? '#94A3B8' : `linear-gradient(135deg,${NAVY},${TEAL})`, color:'white' }}>
            {sending ? '⏳ Sending...' : '📧 Send Email'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── User Detail Panel ─────────────────────────────────────────
function UserDetail({ user, onBack, onUpdate, onEmail }: { user: User; onBack: () => void; onUpdate: (msg: string) => void; onEmail: () => void }) {
  const [tab, setTab]       = useState<'overview'|'actions'|'security'>('overview')
  const [saving, setSaving] = useState(false)
  const [form, setForm]     = useState({ role: user.role, status: user.status, kycStatus: user.kycStatus, tier: user.tier })
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteCheck, setDeleteCheck]         = useState<{ canDelete: boolean; blockers: string[] } | null>(null)
  const [deleting, setDeleting]               = useState(false)

  async function openDeleteModal() {
    setShowDeleteModal(true)
    setDeleteCheck(null)
    try {
      const res  = await fetch(`/api/users/${user.id}/deletion-check`)
      const data = await res.json()
      if (data.success) setDeleteCheck(data.data)
      else { onUpdate('Could not check deletion eligibility'); setShowDeleteModal(false) }
    } catch { onUpdate('Network error'); setShowDeleteModal(false) }
  }

  async function confirmDelete() {
    setDeleting(true)
    try {
      const res  = await fetch(`/api/users/${user.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        onUpdate(data.message || `${user.fullName} deleted`)
        onBack()
      } else {
        onUpdate(data.error || 'Deletion failed')
        setShowDeleteModal(false)
      }
    } catch { onUpdate('Network error during deletion') }
    finally { setDeleting(false) }
  }

  async function handleUpdate() {
    setSaving(true)
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.success) onUpdate(`${user.fullName} updated successfully`)
      else onUpdate('Update failed: ' + (data.error || 'Unknown error'))
    } catch { onUpdate('Network error during update') }
    finally { setSaving(false) }
  }

  async function handleAction(action: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/users/${user.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      onUpdate(data.message || `Action ${action} completed`)
    } catch { onUpdate('Action failed') }
    finally { setSaving(false) }
  }

  const TABS = [
    { id:'overview', label:'👤 Overview'  },
    { id:'actions',  label:'⚙️ Manage'    },
    { id:'security', label:'🔒 Security'  },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'0', borderRadius:'16px', overflow:'hidden', boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>
      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,${NAVY} 0%,#1E3A5F 100%)`, padding:'22px 24px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'14px' }}>
          <div style={{ width:'52px', height:'52px', borderRadius:'50%', background:TEAL, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:'18px', fontWeight:'700', flexShrink:0 }}>
            {user.fullName.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'4px' }}>
              <span style={{ fontSize:'17px', fontWeight:'700', color:'white' }}>{user.fullName}</span>
              <Badge text={user.role} colors={ROLE_COLORS[user.role] || ['#F1F5F9','#475569']} />
              <Badge text={user.status} colors={STATUS_COLORS[user.status] || ['#F1F5F9','#475569']} />
            </div>
            <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.6)' }}>{user.email} · {user.phone}</div>
          </div>
          <div style={{ display:'flex', gap:'8px', flexShrink:0 }}>
            <button onClick={onEmail}
              style={{ padding:'8px 14px', background:'rgba(255,255,255,0.15)', color:'white', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', fontWeight:'500' }}>
              📧 Email
            </button>
            <button onClick={onBack}
              style={{ padding:'8px 14px', background:'rgba(255,255,255,0.15)', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer' }}>
              ← Back
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px', marginTop:'16px', paddingTop:'14px', borderTop:'1px solid rgba(255,255,255,0.1)' }}>
          {[
            { l:'KYC Status',   v: user.kycStatus },
            { l:'Tier',         v: user.tier },
            { l:'Rep Score',    v: user.reputationScore },
            { l:'Groups',       v: `${user.groupCount} group${user.groupCount!==1?'s':''}` },
          ].map(s => (
            <div key={s.l}>
              <div style={{ fontSize:'9px', color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'2px' }}>{s.l}</div>
              <div style={{ fontSize:'15px', fontWeight:'700', color:'white' }}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab nav */}
      <div style={{ display:'flex', background:'white', borderBottom:'1px solid #E2E8F0' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{ padding:'11px 20px', background:'none', border:'none',
              borderBottom: tab===t.id ? `2px solid ${TEAL}` : '2px solid transparent',
              color: tab===t.id ? TEAL : '#64748B',
              fontWeight: tab===t.id ? '600' : '400',
              fontSize:'13px', cursor:'pointer', marginBottom:'-1px', whiteSpace:'nowrap' as any }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ background:'#F8FAFC', padding:'20px', minHeight:'280px' }}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
            {/* Personal info */}
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'16px' }}>
              <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY, marginBottom:'12px' }}>👤 Personal Details</div>
              {[
                ['Full Name',    user.fullName],
                ['Email',        user.email],
                ['Phone',        user.phone],
                ['City',         user.city || '—'],
                ['Country',      user.country || '—'],
                ['Registered',   new Date(user.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })],
                ['Last Login',   user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : 'Never'],
                ['Email Verified', user.emailVerifiedAt ? '✅ Verified' : '⏳ Pending'],
              ].map(([l,v]) => (
                <div key={l} style={{ display:'grid', gridTemplateColumns:'120px 1fr', gap:'8px', padding:'6px 0', borderBottom:'1px solid #F8FAFC', fontSize:'12px' }}>
                  <span style={{ color:'#64748B' }}>{l}</span>
                  <span style={{ color:NAVY, fontWeight:'500' }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Account info */}
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'16px' }}>
              <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY, marginBottom:'12px' }}>🔐 Account Status</div>
              {[
                ['Role',         <Badge key="r" text={user.role} colors={ROLE_COLORS[user.role] || ['#F1F5F9','#475569']} />],
                ['Status',       <Badge key="s" text={user.status} colors={STATUS_COLORS[user.status] || ['#F1F5F9','#475569']} />],
                ['KYC',          <Badge key="k" text={user.kycStatus} colors={KYC_COLORS[user.kycStatus] || ['#F1F5F9','#475569']} />],
                ['Tier',         <Badge key="t" text={user.tier} colors={TIER_COLORS[user.tier] || ['#F1F5F9','#475569']} />],
                ['Rep Score',    <span key="rs" style={{ fontSize:'14px', fontWeight:'700', color:TEAL }}>{user.reputationScore}</span>],
                ['Blacklisted',  user.isBlacklisted ? '⛔ Yes' : '✅ No'],
                ['Blacklist Reason', user.blacklistReason || '—'],
                ['Groups',       `${user.groupCount}`],
              ].map(([l,v]) => (
                <div key={String(l)} style={{ display:'grid', gridTemplateColumns:'120px 1fr', gap:'8px', padding:'6px 0', borderBottom:'1px solid #F8FAFC', fontSize:'12px', alignItems:'center' }}>
                  <span style={{ color:'#64748B' }}>{l}</span>
                  <span style={{ color:NAVY, fontWeight:'500' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MANAGE */}
        {tab === 'actions' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px' }}>
              <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY, marginBottom:'16px' }}>⚙️ Update Role & Status</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
                {/* Role */}
                <div>
                  <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Role</label>
                  <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                    style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white' }}>
                    {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
                  </select>
                </div>
                {/* Status */}
                <div>
                  <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                    style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white' }}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {/* KYC */}
                <div>
                  <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>KYC Status</label>
                  <select value={form.kycStatus} onChange={e => setForm(p => ({ ...p, kycStatus: e.target.value }))}
                    style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white' }}>
                    {KYC_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                  </select>
                </div>
                {/* Tier */}
                <div>
                  <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Tier</label>
                  <select value={form.tier} onChange={e => setForm(p => ({ ...p, tier: e.target.value }))}
                    style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white' }}>
                    {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={handleUpdate} disabled={saving}
                style={{ marginTop:'16px', padding:'10px 24px', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:saving?'not-allowed':'pointer',
                  background: saving ? '#94A3B8' : `linear-gradient(135deg,${NAVY},${TEAL})`, color:'white' }}>
                {saving ? '⏳ Saving...' : '✓ Save Changes'}
              </button>
            </div>

            {/* Quick actions */}
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px' }}>
              <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY, marginBottom:'14px' }}>⚡ Quick Actions</div>
              <div style={{ display:'flex', gap:'10px', flexWrap:'wrap' as any }}>
                <button onClick={() => handleAction('VERIFY_KYC')}
                  style={{ padding:'8px 16px', background:'#DCFCE7', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#166534', fontWeight:'600' }}>
                  ✅ Approve KYC
                </button>
                <button onClick={() => handleAction('REJECT_KYC')}
                  style={{ padding:'8px 16px', background:'#FEE2E2', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#991B1B', fontWeight:'600' }}>
                  ❌ Reject KYC
                </button>
                <button onClick={() => handleAction('SUSPEND')}
                  style={{ padding:'8px 16px', background:'#FEF9C3', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#854D0E', fontWeight:'600' }}>
                  🔒 Suspend
                </button>
                <button onClick={() => handleAction('REINSTATE')}
                  style={{ padding:'8px 16px', background:'#DBEAFE', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#1E40AF', fontWeight:'600' }}>
                  🔓 Reinstate
                </button>
                <button onClick={() => handleAction('RESET_PASSWORD')}
                  style={{ padding:'8px 16px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#475569', fontWeight:'600' }}>
                  🔑 Send Password Reset
                </button>
                <button onClick={onEmail}
                  style={{ padding:'8px 16px', background:'#EDE9FE', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#5B21B6', fontWeight:'600' }}>
                  📧 Send Email
                </button>
              </div>
            </div>

            {/* Danger Zone — Rule 1: delete from User Management UI */}
            <div style={{ background:'#FEF2F2', borderRadius:'12px', border:'1px solid #FECACA', padding:'20px' }}>
              <div style={{ fontSize:'13px', fontWeight:'600', color:'#991B1B', marginBottom:'8px' }}>🗑️ Danger Zone</div>
              <p style={{ fontSize:'12px', color:'#991B1B', margin:'0 0 14px', lineHeight:1.6 }}>
                Permanently delete this user account. Only possible if the user has no group memberships,
                no payment transactions or contributions, and no Windfall scheme participation. This cannot be undone.
              </p>
              <button onClick={openDeleteModal}
                style={{ padding:'9px 18px', background:'#DC2626', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'white', fontWeight:'600' }}>
                🗑️ Delete User Account
              </button>
            </div>
          </div>
        )}

        {/* ── Delete Confirmation Modal ─────────────────────────── */}
        {showDeleteModal && (
          <div style={{ position:'fixed', inset:0, background:'rgba(13,33,55,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1100, padding:'24px' }}>
            <div style={{ background:'white', borderRadius:'18px', padding:'28px', width:'100%', maxWidth:'440px', boxShadow:'0 32px 64px rgba(0,0,0,0.35)' }}>
              {!deleteCheck ? (
                <div style={{ textAlign:'center', padding:'20px' }}>
                  <div style={{ fontSize:'32px', marginBottom:'12px' }}>⏳</div>
                  <p style={{ color:'#64748B', fontSize:'14px' }}>Checking deletion eligibility...</p>
                </div>
              ) : deleteCheck.canDelete ? (
                <>
                  <div style={{ textAlign:'center', marginBottom:'20px' }}>
                    <div style={{ fontSize:'44px', marginBottom:'10px' }}>⚠️</div>
                    <h3 style={{ fontSize:'17px', fontWeight:'700', color:'#0D2137', margin:'0 0 8px' }}>Permanently delete {user.fullName}?</h3>
                    <p style={{ fontSize:'13px', color:'#64748B', margin:0, lineHeight:1.6 }}>
                      This user has no groups, transactions, or scheme participation, so deletion is allowed.
                      This action <strong>cannot be undone</strong>.
                    </p>
                  </div>
                  <div style={{ display:'flex', gap:'10px' }}>
                    <button onClick={() => setShowDeleteModal(false)} disabled={deleting}
                      style={{ flex:1, padding:'11px', background:'#F1F5F9', border:'none', borderRadius:'10px', fontSize:'13px', fontWeight:'500', cursor:'pointer', color:'#475569' }}>
                      Cancel
                    </button>
                    <button onClick={confirmDelete} disabled={deleting}
                      style={{ flex:1, padding:'11px', border:'none', borderRadius:'10px', fontSize:'13px', fontWeight:'600',
                        cursor: deleting ? 'not-allowed' : 'pointer',
                        background: deleting ? '#94A3B8' : '#DC2626', color:'white' }}>
                      {deleting ? '⏳ Deleting...' : '🗑️ Delete Permanently'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ textAlign:'center', marginBottom:'16px' }}>
                    <div style={{ fontSize:'44px', marginBottom:'10px' }}>🚫</div>
                    <h3 style={{ fontSize:'17px', fontWeight:'700', color:'#0D2137', margin:'0 0 8px' }}>Cannot delete {user.fullName}</h3>
                    <p style={{ fontSize:'13px', color:'#64748B', margin:0 }}>
                      This user has active records that must be resolved first:
                    </p>
                  </div>
                  <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'10px', padding:'14px 16px', marginBottom:'18px', maxHeight:'220px', overflowY:'auto' }}>
                    {deleteCheck.blockers.map((b, i) => (
                      <div key={i} style={{ fontSize:'12px', color:'#991B1B', padding:'4px 0', display:'flex', gap:'8px' }}>
                        <span>•</span><span>{b}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setShowDeleteModal(false)}
                    style={{ width:'100%', padding:'11px', background:'#F1F5F9', border:'none', borderRadius:'10px', fontSize:'13px', fontWeight:'500', cursor:'pointer', color:'#475569' }}>
                    Close
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* SECURITY */}
        {tab === 'security' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'16px' }}>
              <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY, marginBottom:'12px' }}>🔒 Security Details</div>
              {[
                ['Last Login',       user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'],
                ['Email Verified',   user.emailVerifiedAt ? `✅ ${new Date(user.emailVerifiedAt).toLocaleDateString()}` : '⏳ Not verified'],
                ['Blacklisted',      user.isBlacklisted ? '⛔ Yes' : '✅ No'],
                ['Blacklist Reason', user.blacklistReason || '—'],
                ['Account Status',   user.status],
              ].map(([l,v]) => (
                <div key={l} style={{ display:'grid', gridTemplateColumns:'160px 1fr', gap:'8px', padding:'7px 0', borderBottom:'1px solid #F8FAFC', fontSize:'12px' }}>
                  <span style={{ color:'#64748B' }}>{l}</span>
                  <span style={{ color:NAVY, fontWeight:'500' }}>{v}</span>
                </div>
              ))}
            </div>
            {user.isBlacklisted && (
              <div style={{ background:'#FEF2F2', borderRadius:'12px', border:'1px solid #FECACA', padding:'16px' }}>
                <div style={{ fontSize:'13px', fontWeight:'600', color:'#991B1B', marginBottom:'6px' }}>⛔ Blacklist Notice</div>
                <p style={{ fontSize:'12px', color:'#991B1B', margin:0 }}>{user.blacklistReason || 'No reason recorded.'}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main User Management Page ─────────────────────────────────
export default function UserManagement() {
  const [users, setUsers]         = useState<User[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<User | null>(null)
  const [emailUser, setEmailUser] = useState<User | null>(null)
  const [toast, setToast]         = useState<any>(null)
  const [search, setSearch]       = useState('')
  const [filterRole, setFilterRole]     = useState('ALL')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [filterKyc, setFilterKyc]       = useState('ALL')

  function showToast(msg: string, type: 'success'|'error' = 'success') {
    setToast({ msg, type })
  }

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterRole   !== 'ALL') params.set('role', filterRole)
      if (filterStatus !== 'ALL') params.set('status', filterStatus)
      if (filterKyc    !== 'ALL') params.set('kycStatus', filterKyc)
      if (search.trim()) params.set('search', search.trim())

      const res  = await fetch(`/api/users?${params}`)
      const data = await res.json()
      if (data.success) setUsers(data.data)
      else showToast('Failed to load users', 'error')
    } catch { showToast('Network error', 'error') }
    finally { setLoading(false) }
  }, [filterRole, filterStatus, filterKyc, search])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  // Stats
  const total      = users.length
  const verified   = users.filter(u => u.kycStatus === 'VERIFIED').length
  const pending    = users.filter(u => u.kycStatus === 'PENDING' || u.kycStatus === 'UNDER_REVIEW').length
  const suspended  = users.filter(u => u.status === 'SUSPENDED' || u.status === 'BLACKLISTED').length

  if (selected) return (
    <>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {emailUser && <EmailModal user={emailUser} onClose={() => setEmailUser(null)} onSent={msg => showToast(msg)} />}
      <UserDetail
        user={selected}
        onBack={() => { setSelected(null); fetchUsers() }}
        onUpdate={msg => { showToast(msg); fetchUsers() }}
        onEmail={() => setEmailUser(selected)}
      />
    </>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'20px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {emailUser && <EmailModal user={emailUser} onClose={() => setEmailUser(null)} onSent={msg => showToast(msg)} />}

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'10px' }}>
        <div>
          <h2 style={{ fontSize:'20px', fontWeight:'700', color:NAVY, margin:'0 0 4px' }}>👥 User Management</h2>
          <p style={{ fontSize:'13px', color:'#64748B', margin:0 }}>Manage members, roles, KYC verification and notifications</p>
        </div>
        <button onClick={fetchUsers} style={{ padding:'8px 14px', background:'#F1F5F9', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', cursor:'pointer', color:'#475569' }}>
          ↻ Refresh
        </button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'12px' }}>
        {[
          { icon:'👥', label:'Total Users',     value: total,     color: NAVY,    bg:'#F8FAFC' },
          { icon:'✅', label:'KYC Verified',    value: verified,  color: '#166534', bg:'#F0FDF4' },
          { icon:'⏳', label:'Pending KYC',     value: pending,   color: AMBER,   bg:'#FFFBEB' },
          { icon:'🔒', label:'Suspended',       value: suspended, color: RED,     bg:'#FEF2F2' },
        ].map(s => (
          <div key={s.label} style={{ background:s.bg, borderRadius:'12px', padding:'16px', border:'1px solid #E2E8F0' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
              <span style={{ fontSize:'18px' }}>{s.icon}</span>
              <span style={{ fontSize:'11px', color:'#64748B', fontWeight:'500' }}>{s.label}</span>
            </div>
            <div style={{ fontSize:'28px', fontWeight:'700', color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', alignItems:'center' }}>
        <input placeholder="Search name, email, phone..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding:'8px 14px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', width:'240px', outline:'none' }} />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          style={{ padding:'8px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white' }}>
          <option value="ALL">All Roles</option>
          {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding:'8px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white' }}>
          <option value="ALL">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterKyc} onChange={e => setFilterKyc(e.target.value)}
          style={{ padding:'8px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white' }}>
          <option value="ALL">All KYC</option>
          {KYC_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'32px', marginBottom:'12px' }}>⏳</div>
          <p style={{ color:'#64748B' }}>Loading users...</p>
        </div>
      )}

      {/* Empty */}
      {!loading && users.length === 0 && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'60px', textAlign:'center' }}>
          <div style={{ fontSize:'48px', marginBottom:'12px' }}>👥</div>
          <h3 style={{ fontSize:'16px', fontWeight:'600', color:NAVY, margin:'0 0 8px' }}>No users found</h3>
          <p style={{ color:'#64748B', fontSize:'13px' }}>Try adjusting your filters</p>
        </div>
      )}

      {/* User table */}
      {!loading && users.length > 0 && (
        <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#F8FAFC' }}>
                {['Member','Role','Status','KYC','Tier','Score','Groups','Actions'].map(h => (
                  <th key={h} style={{ padding:'11px 14px', textAlign:'left', fontSize:'10px', fontWeight:'600',
                    color:'#64748B', borderBottom:'1px solid #E2E8F0', textTransform:'uppercase', whiteSpace:'nowrap' as any }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id} style={{ borderBottom:'1px solid #F8FAFC', background: i%2===0?'white':'#FAFAFA' }}>
                  <td style={{ padding:'12px 14px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                      <div style={{ width:'34px', height:'34px', borderRadius:'50%', background:'#E1F5EE', color:TEAL,
                        display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:'700', flexShrink:0 }}>
                        {u.fullName.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize:'13px', fontWeight:'600', color:NAVY }}>{u.fullName}</div>
                        <div style={{ fontSize:'11px', color:'#64748B' }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding:'12px 14px' }}><Badge text={u.role} colors={ROLE_COLORS[u.role] || ['#F1F5F9','#475569']} /></td>
                  <td style={{ padding:'12px 14px' }}><Badge text={u.status} colors={STATUS_COLORS[u.status] || ['#F1F5F9','#475569']} /></td>
                  <td style={{ padding:'12px 14px' }}><Badge text={u.kycStatus} colors={KYC_COLORS[u.kycStatus] || ['#F1F5F9','#475569']} /></td>
                  <td style={{ padding:'12px 14px' }}><Badge text={u.tier} colors={TIER_COLORS[u.tier] || ['#F1F5F9','#475569']} /></td>
                  <td style={{ padding:'12px 14px', fontSize:'13px', fontWeight:'700', color:TEAL }}>{u.reputationScore}</td>
                  <td style={{ padding:'12px 14px', fontSize:'13px', color:'#374151' }}>{u.groupCount}</td>
                  <td style={{ padding:'12px 14px' }}>
                    <div style={{ display:'flex', gap:'6px' }}>
                      <button onClick={() => setSelected(u)}
                        style={{ padding:'5px 10px', background:'#F1F5F9', border:'none', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:NAVY, fontWeight:'500' }}>
                        View →
                      </button>
                      <button onClick={() => setEmailUser(u)}
                        style={{ padding:'5px 10px', background:'#EDE9FE', border:'none', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#5B21B6', fontWeight:'500' }}>
                        📧
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding:'12px 16px', borderTop:'1px solid #F1F5F9', fontSize:'12px', color:'#64748B' }}>
            Showing {users.length} user{users.length!==1?'s':''}
          </div>
        </div>
      )}
    </div>
  )
}
