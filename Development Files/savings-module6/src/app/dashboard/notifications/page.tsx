'use client'
import { useState, useEffect, useCallback } from 'react'

const TEAL = '#0F6E56'; const NAVY = '#0D2137'

function Toast({ msg, type, onClose }: any) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{ position:'fixed', top:'20px', right:'20px', zIndex:9999, padding:'12px 20px', borderRadius:'10px', fontWeight:'500', fontSize:'13px', boxShadow:'0 8px 25px rgba(0,0,0,0.15)', background:type==='success'?'#166534':'#991B1B', color:'white', display:'flex', alignItems:'center', gap:'10px' }}>
      <span>{type==='success'?'✅':'❌'}</span><span>{msg}</span>
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

export default function NotificationsPage() {
  const [groups, setGroups]         = useState<any[]>([])
  const [toast, setToast]           = useState<any>(null)
  const [triggerRunning, setTrigger] = useState(false)
  const [triggerResult, setResult]  = useState<any>(null)
  const [announce, setAnnounce]     = useState({ groupId:'', title:'', message:'', channels:['IN_APP','EMAIL'] })
  const [sending, setSending]       = useState(false)

  const showToast = (msg: string, type = 'success') => setToast({ msg, type })

  useEffect(() => {
    fetch('/api/groups').then(r => r.json()).then(d => { if (d.success) setGroups(d.data) })
  }, [])

  async function runTrigger(trigger: string) {
    setTrigger(true); setResult(null)
    try {
      const res  = await fetch(`/api/notifications/triggers?trigger=${trigger}`)
      const data = await res.json()
      if (data.success) { setResult(data.data); showToast('Trigger completed') }
      else showToast(data.error || 'Failed', 'error')
    } catch { showToast('Network error', 'error') }
    finally { setTrigger(false) }
  }

  async function sendAnnouncement(e: React.FormEvent) {
    e.preventDefault(); setSending(true)
    try {
      const res  = await fetch('/api/notifications', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'SEND_ANNOUNCEMENT', ...announce }),
      })
      const data = await res.json()
      if (data.success) { showToast(data.message); setAnnounce(a => ({ ...a, title:'', message:'' })) }
      else showToast(data.error || 'Failed', 'error')
    } catch { showToast('Network error', 'error') }
    finally { setSending(false) }
  }

  const TRIGGERS = [
    { id:'CONTRIBUTION_REMINDERS', icon:'💸', label:'Contribution Reminders',  desc:'Send 3-day, due-today, and overdue reminders to all active members' },
    { id:'QUEUE_CHECKS',           icon:'🔄', label:'Queue Status Updates',     desc:'Notify members whose queue status changed in the last 24 hours'     },
    { id:'PAYOUT_REMINDERS',       icon:'🏆', label:'Payout Reminders',         desc:'Notify members whose payout is scheduled within 7 days'             },
    { id:'ALL',                    icon:'🔔', label:'Run All Triggers',          desc:'Run all notification triggers at once'                              },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'24px' }}>

      <VersionBadge label="🔔 Notifications" ver="v1.1" />
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div>
        <h2 style={{ fontSize:'20px', fontWeight:'700', color:NAVY, margin:'0 0 4px' }}>🔔 Notifications</h2>
        <p style={{ fontSize:'13px', color:'#64748B', margin:0 }}>Send announcements, run reminder triggers, and manage notification delivery</p>
      </div>

      {/* How it works banner */}
      <div style={{ background:'#EEF2FF', border:'1px solid #C7D2FE', borderRadius:'12px', padding:'16px 20px', fontSize:'13px', color:'#3730A3' }}>
        <strong>How notifications work:</strong> Contribution reminders and queue updates are triggered automatically when you click the buttons below — or set up a daily cron job calling <code style={{ background:'#C7D2FE', padding:'1px 5px', borderRadius:'4px' }}>/api/notifications/triggers</code> to run automatically at 8am every day.
      </div>

      {/* Manual triggers */}
      <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px' }}>
        <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 16px' }}>⚡ Manual Triggers</h3>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'10px' }}>
          {TRIGGERS.map(t => (
            <div key={t.id} style={{ background:'#F8FAFC', borderRadius:'10px', padding:'14px 16px', border:'1px solid #E2E8F0' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'6px' }}>
                <div>
                  <span style={{ fontSize:'18px', marginRight:'8px' }}>{t.icon}</span>
                  <span style={{ fontSize:'13px', fontWeight:'600', color:NAVY }}>{t.label}</span>
                </div>
                <button onClick={() => runTrigger(t.id)} disabled={triggerRunning}
                  style={{ padding:'5px 12px', background:triggerRunning?'#94A3B8':TEAL, color:'white', border:'none', borderRadius:'6px', fontSize:'11px', fontWeight:'600', cursor:triggerRunning?'not-allowed':'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
                  {triggerRunning ? '⏳' : 'Run'}
                </button>
              </div>
              <p style={{ fontSize:'12px', color:'#64748B', margin:0 }}>{t.desc}</p>
            </div>
          ))}
        </div>

        {/* Trigger results */}
        {triggerResult && (
          <div style={{ marginTop:'14px', background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:'8px', padding:'12px 16px' }}>
            <div style={{ fontSize:'12px', fontWeight:'600', color:'#166534', marginBottom:'6px' }}>✅ Trigger Results</div>
            {Object.entries(triggerResult).map(([key, val]: any) => (
              <div key={key} style={{ fontSize:'12px', color:'#166534' }}>
                {key}: <strong>{val} notification{val !== 1 ? 's' : ''} sent</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cron setup guide */}
      <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px' }}>
        <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 12px' }}>⏰ Automated Daily Cron Setup</h3>
        <p style={{ fontSize:'13px', color:'#64748B', marginBottom:'14px', lineHeight:'1.6' }}>
          To run notifications automatically every day at 8am, add this as a cron job. On Vercel, use <a href="https://vercel.com/docs/cron-jobs" target="_blank" rel="noopener noreferrer" style={{ color:TEAL }}>Vercel Cron Jobs</a>. Locally use any scheduler.
        </p>
        <div style={{ background:'#F8FAFC', borderRadius:'8px', padding:'14px', border:'1px solid #E2E8F0', fontFamily:'monospace', fontSize:'12px', color:'#374151' }}>
          <div style={{ color:'#94A3B8', marginBottom:'8px' }}># vercel.json — add to your project root</div>
          <div>{`{`}</div>
          <div style={{ paddingLeft:'16px' }}>{`"crons": [`}</div>
          <div style={{ paddingLeft:'32px' }}>{`{`}</div>
          <div style={{ paddingLeft:'48px' }}>{`"path": "/api/notifications/triggers",`}</div>
          <div style={{ paddingLeft:'48px' }}>{`"schedule": "0 8 * * *"`}</div>
          <div style={{ paddingLeft:'32px' }}>{`}`}</div>
          <div style={{ paddingLeft:'16px' }}>{`]`}</div>
          <div>{`}`}</div>
        </div>
        <div style={{ marginTop:'10px', background:'#FEF9C3', borderRadius:'8px', padding:'10px 14px', fontSize:'12px', color:'#854D0E' }}>
          ⚠️ Add <strong>CRON_SECRET=your-secret</strong> to your .env and use it as a Bearer token when calling the trigger endpoint from external schedulers.
        </div>
      </div>

      {/* Send announcement */}
      <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px' }}>
        <h3 style={{ fontSize:'14px', fontWeight:'600', color:NAVY, margin:'0 0 16px' }}>📢 Send Group Announcement</h3>
        <form onSubmit={sendAnnouncement}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
            <div>
              <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Group <span style={{ color:'#DC2626' }}>*</span></label>
              <select value={announce.groupId} onChange={e => setAnnounce(a => ({ ...a, groupId:e.target.value }))} required
                style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'white', boxSizing:'border-box' as any }}>
                <option value="">Select group...</option>
                {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Send Via</label>
              <div style={{ display:'flex', gap:'8px' }}>
                {[['IN_APP','🔔 In-app'],['EMAIL','📧 Email'],['SMS','📱 SMS']].map(([v,l]) => (
                  <label key={v} style={{ display:'flex', alignItems:'center', gap:'6px', cursor:'pointer', fontSize:'12px', color:NAVY }}>
                    <input type="checkbox" checked={announce.channels.includes(v)}
                      onChange={e => setAnnounce(a => ({ ...a, channels: e.target.checked ? [...a.channels, v] : a.channels.filter(c => c !== v) }))} />
                    {l}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginBottom:'14px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Title <span style={{ color:'#DC2626' }}>*</span></label>
            <input type="text" value={announce.title} onChange={e => setAnnounce(a => ({ ...a, title:e.target.value }))} required
              placeholder="e.g. Collection date changed to the 5th"
              style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any }} />
          </div>
          <div style={{ marginBottom:'16px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' }}>Message <span style={{ color:'#DC2626' }}>*</span></label>
            <textarea value={announce.message} onChange={e => setAnnounce(a => ({ ...a, message:e.target.value }))} required rows={4}
              placeholder="Type your announcement to all group members..."
              style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', boxSizing:'border-box' as any, resize:'vertical' as any }} />
          </div>
          <button type="submit" disabled={sending}
            style={{ padding:'10px 24px', background:sending?'#94A3B8':`linear-gradient(135deg,${NAVY},${TEAL})`, color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:sending?'not-allowed':'pointer' }}>
            {sending ? '⏳ Sending...' : '📢 Send Announcement'}
          </button>
        </form>
      </div>
    </div>
  )
}
