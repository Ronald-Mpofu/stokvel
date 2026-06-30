'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

const NAVY = '#0D2137'
const TEAL = '#0F6E56'

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0)  return `${d}d ago`
  if (h > 0)  return `${h}h ago`
  if (m > 0)  return `${m}m ago`
  return 'just now'
}

function notifIcon(subject: string) {
  if (subject.includes('contribution') || subject.includes('Contribution')) return '💸'
  if (subject.includes('payout') || subject.includes('Payout'))             return '🏆'
  if (subject.includes('Queue') || subject.includes('queue'))               return '🔄'
  if (subject.includes('Welcome'))                                           return '🎉'
  if (subject.includes('📢'))                                                return '📢'
  if (subject.includes('OVERDUE') || subject.includes('overdue'))           return '⚠️'
  if (subject.includes('delivered') || subject.includes('Delivered'))       return '✅'
  return '🔔'
}

export default function NotificationBell({ userId }: { userId: string }) {
  const [open, setOpen]            = useState(false)
  const [notifications, setNotifs] = useState<any[]>([])
  const [unreadCount, setUnread]   = useState(0)
  const ref                        = useRef<HTMLDivElement>(null)

  const fetchNotifs = useCallback(async () => {
    if (!userId) return
    try {
      const res  = await fetch(`/api/notifications?userId=${userId}&limit=20`)
      const data = await res.json()
      if (data.success) { setNotifs(data.data.notifications); setUnread(data.data.unreadCount) }
    } catch {}
  }, [userId])

  useEffect(() => {
    fetchNotifs()
    const interval = setInterval(fetchNotifs, 30000)
    return () => clearInterval(interval)
  }, [fetchNotifs])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function markRead(id: string) {
    await fetch('/api/notifications', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'MARK_READ', notificationId:id }) })
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead:true } : n))
    setUnread(prev => Math.max(0, prev - 1))
  }

  async function markAllRead() {
    await fetch('/api/notifications', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'MARK_ALL_READ', userId }) })
    setNotifs(prev => prev.map(n => ({ ...n, isRead:true })))
    setUnread(0)
  }

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button onClick={() => { setOpen(o=>!o); if (!open) fetchNotifs() }}
        style={{ position:'relative', width:'36px', height:'36px', background:open?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.1)', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'18px', display:'flex', alignItems:'center', justifyContent:'center' }}
        title="Notifications">
        🔔
        {unreadCount > 0 && (
          <span style={{ position:'absolute', top:'-4px', right:'-4px', background:'#DC2626', color:'white', fontSize:'9px', fontWeight:'700', width:'16px', height:'16px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', border:'2px solid #0D2137' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position:'absolute', top:'44px', right:0, width:'360px', maxHeight:'480px', background:'white', borderRadius:'12px', boxShadow:'0 8px 32px rgba(0,0,0,0.18)', border:'1px solid #E2E8F0', overflow:'hidden', zIndex:9999, display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'14px 16px', borderBottom:'1px solid #F1F5F9', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#FAFAFA', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ fontSize:'14px', fontWeight:'700', color:NAVY }}>Notifications</span>
              {unreadCount > 0 && <span style={{ background:'#DC2626', color:'white', fontSize:'10px', fontWeight:'700', padding:'1px 6px', borderRadius:'999px' }}>{unreadCount} new</span>}
            </div>
            {unreadCount > 0 && <button onClick={markAllRead} style={{ fontSize:'11px', color:TEAL, background:'none', border:'none', cursor:'pointer', fontWeight:'500' }}>Mark all read</button>}
          </div>

          <div style={{ overflowY:'auto', flex:1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding:'40px', textAlign:'center', color:'#94A3B8' }}>
                <div style={{ fontSize:'28px', marginBottom:'8px' }}>🔔</div>
                <div style={{ fontSize:'13px' }}>No notifications yet</div>
              </div>
            ) : notifications.map(n => (
              <div key={n.id} onClick={() => !n.isRead && markRead(n.id)}
                style={{ padding:'12px 16px', borderBottom:'1px solid #F8FAFC', background:n.isRead?'white':'#F0FDF4', cursor:n.isRead?'default':'pointer', display:'flex', gap:'10px', alignItems:'flex-start' }}>
                <span style={{ fontSize:'20px', flexShrink:0, marginTop:'1px' }}>{notifIcon(n.subject||'')}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:'12px', fontWeight:n.isRead?'400':'600', color:n.isRead?'#374151':NAVY, marginBottom:'2px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{n.subject}</div>
                  <div style={{ fontSize:'11px', color:'#64748B', lineHeight:'1.4', display:'-webkit-box' as any, WebkitLineClamp:2 as any, WebkitBoxOrient:'vertical' as any, overflow:'hidden' }}>{n.body}</div>
                  <div style={{ fontSize:'10px', color:'#94A3B8', marginTop:'4px' }}>{timeAgo(n.createdAt)}</div>
                </div>
                {!n.isRead && <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:TEAL, flexShrink:0, marginTop:'4px' }}/>}
              </div>
            ))}
          </div>

          <div style={{ padding:'10px 16px', borderTop:'1px solid #F1F5F9', background:'#FAFAFA', flexShrink:0, textAlign:'center' }}>
            <button onClick={fetchNotifs} style={{ fontSize:'11px', color:TEAL, background:'none', border:'none', cursor:'pointer' }}>↻ Refresh</button>
          </div>
        </div>
      )}
    </div>
  )
}
