'use client'
import { useState } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'

interface Props {
  groups: { id: string; name: string; currency?: string }[]
  preselectedGroupId?: string    // locks the group dropdown when opened from Groups module
  currentUserId: string
  onClose: () => void
  onSuccess: (message: string) => void
}

export default function SendInviteModal({ groups, preselectedGroupId, currentUserId, onClose, onSuccess }: Props) {
  const [form, setForm] = useState({
    groupId:         preselectedGroupId || '',
    email:           '',
    phone:           '',
    fullName:        '',
    role:            'MEMBER',
    channel:         'BOTH',
    personalMessage: '',
  })
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [result, setResult]   = useState<any>(null)

  const set = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }))
  const selectedGroup = groups.find(g => g.id === form.groupId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.email && !form.phone) return setError('At least one of email or phone is required.')
    setSaving(true); setError('')
    try {
      const res  = await fetch('/api/invitations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...form, invitedById: currentUserId }),
      })
      const data = await res.json()
      if (data.success) setResult(data)
      else setError(data.error || 'Failed to send invitation')
    } catch { setError('Network error — please try again') }
    finally { setSaving(false) }
  }

  // ── Success screen ─────────────────────────────────────────
  if (result) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'20px' }}>
      <div style={{ background:'white', borderRadius:'16px', padding:'36px 32px', width:'100%', maxWidth:'480px', boxShadow:'0 25px 50px rgba(0,0,0,0.25)', textAlign:'center' }}>
        <div style={{ fontSize:'56px', marginBottom:'16px' }}>🎉</div>
        <h3 style={{ fontSize:'20px', fontWeight:'700', color:NAVY, margin:'0 0 8px' }}>Invitation Sent!</h3>
        <p style={{ fontSize:'14px', color:'#475569', margin:'0 0 24px', lineHeight:'1.6' }}>{result.message}</p>

        {/* Delivery status */}
        <div style={{ display:'flex', gap:'8px', justifyContent:'center', marginBottom:'20px', flexWrap:'wrap' }}>
          {result.data.emailSent && <span style={{ background:'#DCFCE7', color:'#166534', fontSize:'12px', padding:'5px 12px', borderRadius:'6px', fontWeight:'500' }}>📧 Email sent</span>}
          {result.data.smsSent   && <span style={{ background:'#DBEAFE', color:'#1E40AF', fontSize:'12px', padding:'5px 12px', borderRadius:'6px', fontWeight:'500' }}>📱 SMS sent</span>}
          {result.data.errors?.map((e: string) => (
            <span key={e} style={{ background:'#FEF9C3', color:'#854D0E', fontSize:'11px', padding:'5px 10px', borderRadius:'6px' }}>⚠️ {e}</span>
          ))}
        </div>

        {/* Invite link — for manual sharing */}
        <div style={{ background:'#F8FAFC', borderRadius:'10px', padding:'14px', marginBottom:'24px', border:'1px solid #E2E8F0', textAlign:'left' }}>
          <div style={{ fontSize:'11px', color:'#94A3B8', marginBottom:'6px', fontWeight:'600', textTransform:'uppercase', letterSpacing:'0.04em' }}>
            Invitation link — share manually if needed
          </div>
          <div style={{ fontSize:'12px', color:TEAL, wordBreak:'break-all', fontFamily:'monospace', marginBottom:'8px' }}>
            {result.data.inviteUrl}
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(result.data.inviteUrl) }}
            style={{ padding:'5px 12px', background:'#F1F5F9', border:'1px solid #E2E8F0', borderRadius:'6px', fontSize:'11px', cursor:'pointer', color:'#475569' }}>
            📋 Copy Link
          </button>
        </div>

        <div style={{ display:'flex', gap:'10px' }}>
          <button
            onClick={() => { setResult(null); setForm({ groupId: preselectedGroupId || '', email:'', phone:'', fullName:'', role:'MEMBER', channel:'BOTH', personalMessage:'' }); setError('') }}
            style={{ flex:1, padding:'11px', background:'#F1F5F9', border:'none', borderRadius:'10px', fontSize:'13px', cursor:'pointer', color:'#475569' }}>
            Send Another
          </button>
          <button
            onClick={() => { onSuccess(result.message); onClose() }}
            style={{ flex:2, padding:'11px', background:`linear-gradient(135deg,${NAVY},${TEAL})`, color:'white', border:'none', borderRadius:'10px', fontSize:'14px', fontWeight:'600', cursor:'pointer' }}>
            Done ✓
          </button>
        </div>
      </div>
    </div>
  )

  // ── Send form ──────────────────────────────────────────────
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'20px' }}>
      <div style={{ background:'white', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'520px', boxShadow:'0 25px 50px rgba(0,0,0,0.25)', maxHeight:'92vh', overflowY:'auto' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'20px' }}>
          <div>
            <h3 style={{ fontSize:'17px', fontWeight:'700', color:NAVY, margin:'0 0 3px' }}>✉️ Send Invitation</h3>
            <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>
              {selectedGroup ? `Inviting to: ${selectedGroup.name}` : 'Invite a new member to join a group'}
            </p>
          </div>
          <button onClick={onClose} style={{ background:'#F1F5F9', border:'none', borderRadius:'8px', width:'32px', height:'32px', cursor:'pointer', fontSize:'18px', color:'#64748B' }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>

          {/* Group selector — locked if preselected */}
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
              Group <span style={{ color:'#DC2626' }}>*</span>
            </label>
            {preselectedGroupId ? (
              <div style={{ padding:'9px 12px', background:'#F0FDF4', border:'1.5px solid #BBF7D0', borderRadius:'8px', fontSize:'13px', color:'#166534', fontWeight:'500' }}>
                ✓ {selectedGroup?.name || 'Selected group'}
              </div>
            ) : (
              <select value={form.groupId} onChange={e => set('groupId')(e.target.value)} required
                style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white', boxSizing:'border-box' as any }}>
                <option value="">Select a group...</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>

          {/* Name + Role */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Full Name</label>
              <input type="text" value={form.fullName} onChange={e => set('fullName')(e.target.value)}
                placeholder="Prospective member's name"
                style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }} />
            </div>
            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Role</label>
              <select value={form.role} onChange={e => set('role')(e.target.value)}
                style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white', boxSizing:'border-box' as any }}>
                <option value="MEMBER">Member</option>
                <option value="TREASURER">Treasurer</option>
                <option value="INVESTMENT_MANAGER">Investment Manager</option>
                <option value="GROUP_ADMIN">Group Admin</option>
              </select>
            </div>
          </div>

          {/* Email */}
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
              Email Address <span style={{ color:'#94A3B8', fontWeight:'400' }}>(required if no phone)</span>
            </label>
            <input type="email" value={form.email} onChange={e => set('email')(e.target.value)}
              placeholder="member@example.com"
              style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }} />
          </div>

          {/* Phone */}
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
              Phone Number <span style={{ color:'#94A3B8', fontWeight:'400' }}>(required if no email)</span>
            </label>
            <input type="tel" value={form.phone} onChange={e => set('phone')(e.target.value)}
              placeholder="+263 77 xxx xxxx"
              style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }} />
          </div>

          {/* Channel */}
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'6px' }}>Send Via</label>
            <div style={{ display:'flex', gap:'8px' }}>
              {[
                ['BOTH',  '📧📱 Email + SMS'],
                ['EMAIL', '📧 Email only'],
                ['SMS',   '📱 SMS only'],
              ].map(([v, l]) => (
                <div key={v} onClick={() => set('channel')(v)}
                  style={{ flex:1, padding:'9px 6px', borderRadius:'8px', cursor:'pointer', border:`2px solid ${form.channel===v?TEAL:'#E2E8F0'}`, background:form.channel===v?'#F0FDF4':'white', fontSize:'11px', fontWeight:'500', color:NAVY, textAlign:'center' }}>
                  {l}
                </div>
              ))}
            </div>
          </div>

          {/* Personal message */}
          <div style={{ marginBottom:'18px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>
              Personal Message <span style={{ color:'#94A3B8', fontWeight:'400' }}>(optional)</span>
            </label>
            <textarea
              value={form.personalMessage}
              onChange={e => set('personalMessage')(e.target.value)}
              placeholder="Add a personal note that will appear in the invitation email..."
              rows={3}
              style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any, resize:'vertical' as any }}
            />
          </div>

          {/* Info note */}
          <div style={{ background:'#EEF2FF', border:'1px solid #C7D2FE', borderRadius:'8px', padding:'10px 14px', marginBottom:'16px', fontSize:'12px', color:'#3730A3' }}>
            💡 The invitee will receive a link valid for <strong>7 days</strong>. They can create their own account and join the group by clicking it — no admin action needed after sending.
          </div>

          {error && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:'8px', padding:'10px 14px', color:'#991B1B', fontSize:'12px', marginBottom:'14px' }}>
              ❌ {error}
            </div>
          )}

          <div style={{ display:'flex', gap:'10px' }}>
            <button type="button" onClick={onClose}
              style={{ flex:1, padding:'11px', background:'#F1F5F9', border:'none', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#475569', fontWeight:'500' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              style={{ flex:2, padding:'11px', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:saving?'not-allowed':'pointer', background:saving?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`, color:'white' }}>
              {saving ? '⏳ Sending...' : '✉️ Send Invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
