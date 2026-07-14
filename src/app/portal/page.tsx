'use client'
import { useState, useEffect, useCallback } from 'react'
import NotificationBell from '../dashboard/notifications/NotificationBell'
import LogoutButton from '../../components/LogoutButton'

const TEAL   = '#0F6E56'
const NAVY   = '#0D2137'
const PURPLE = '#7C3AED'

const fmt = (n: number, dec = 2) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)

const ASSET_TYPE_ICONS: Record<string, string> = {
  VEHICLE: '🚗', AGRICULTURAL_MACHINERY: '🚜', INDUSTRIAL_MACHINERY: '⚙️',
  COMPUTER_EQUIPMENT: '💻', HOME: '🏠', OTHER: '📦',
}

const QUEUE_STATUS_META: Record<string, any> = {
  WAITING:   { bg:'#F1F5F9', color:'#475569', icon:'⏳', label:'Waiting'   },
  FUNDING:   { bg:'#DBEAFE', color:'#1E40AF', icon:'💰', label:'Funding'   },
  SOURCING:  { bg:'#FEF9C3', color:'#854D0E', icon:'🔍', label:'Sourcing'  },
  ORDERED:   { bg:'#F3E8FF', color:'#6B21A8', icon:'📦', label:'Ordered'   },
  DELIVERED: { bg:'#DCFCE7', color:'#166534', icon:'✅', label:'Delivered' },
}

// ── Helpers ───────────────────────────────────────────────────
function Pill({ bg, color, children }: any) {
  return <span style={{ background: bg, color, fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px', display:'inline-block', whiteSpace:'nowrap' }}>{children}</span>
}

function KpiCard({ label, value, sub, color, icon }: any) {
  return (
    <div style={{ background: 'white', borderRadius: '12px', padding: '18px', border: '1px solid #E2E8F0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <span style={{ fontSize: '24px' }}>{icon}</span>
      </div>
      <div style={{ fontSize: '24px', fontWeight: '700', color: color || NAVY, marginBottom: '4px' }}>{value}</div>
      <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>{sub}</div>}
    </div>  )
}

function SectionCard({ title, children, action }: any) {
  return (
    <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: 0 }}>{title}</h3>
        {action}
      </div>
      <div style={{ padding: '16px 18px' }}>{children}</div>
    </div>
  )
}

function EmptyState({ icon, text }: any) {
  return (
    <div style={{ textAlign: 'center', padding: '32px', color: '#94A3B8' }}>
      <div style={{ fontSize: '32px', marginBottom: '8px' }}>{icon}</div>
      <div style={{ fontSize: '13px' }}>{text}</div>
    </div>
  )
}

// ── Pay Modal — record a contribution payment (member self-service) ──
function PayModal({ item, userId, onClose, onPaid, onError }: any) {
  const [method, setMethod]       = useState('')
  const [reference, setReference] = useState('')
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState('')
  const [methods, setMethods]     = useState<{ code: string; name: string }[]>([])
  const [methodsLoading, setMethodsLoading] = useState(true)

  // Fallback if the country has no configured methods or the lookup fails
  const FALLBACK: { code: string; name: string }[] = [
    { code: 'BANK_TRANSFER', name: 'Bank Transfer' },
    { code: 'CARD',          name: 'Card' },
  ]

  // Load the payment methods available in this contribution's country
  useEffect(() => {
    let alive = true
    setMethodsLoading(true)
    const finish = (list: { code: string; name: string }[], def?: string) => {
      if (!alive) return
      const m = list.length ? list : FALLBACK
      setMethods(m)
      setMethod(def || m[0]?.code || 'BANK_TRANSFER')
      setMethodsLoading(false)
    }
    if (!item.country) { finish(FALLBACK); return () => { alive = false } }
    fetch(`/api/reference?countryId=${encodeURIComponent(item.country)}`)
      .then(r => r.json())
      .then(d => {
        const pms = (d?.success && d?.data?.paymentMethods) ? d.data.paymentMethods : []
        const list = (pms as any[]).map(p => ({ code: p.code, name: p.name }))
        const def  = (pms as any[]).find(p => p.isDefault)?.code
        finish(list, def)
      })
      .catch(() => finish(FALLBACK))
    return () => { alive = false }
  }, [item.country])

  const sym = item.currency === 'USD' ? '$' : item.currency + ' '

  async function submit() {
    setErr('')
    if (!method) { setErr('Select a payment method.'); return }
    if (!reference.trim()) { setErr('Enter the reference/confirmation code from your payment.'); return }
    setSaving(true)
    try {
      const payload: any = {
        action: 'PAY', userId, type: item.type,
        paymentMethod: method, reference: reference.trim(),
        amount: item.amount, currency: item.currency,
      }
      if (item.type === 'GROUP')   { payload.groupId = item.groupId; payload.periodKey = item.periodKey; payload.groupName = item.groupName }
      if (item.type === 'SAVINGS') { payload.contributionId = item.contributionId }
      const res = await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d   = await res.json()
      if (d.success) onPaid(d.message || 'Payment submitted')
      else { setErr(d.error || 'Payment failed'); onError?.(d.error || 'Payment failed') }
    } catch { setErr('Network error. Please try again.') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '26px', width: '100%', maxWidth: '420px', boxShadow: '0 25px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
          <h3 style={{ fontSize: '17px', fontWeight: '700', color: NAVY, margin: 0 }}>Pay Contribution</h3>
          <button onClick={onClose} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', width: '30px', height: '30px', cursor: 'pointer', fontSize: '17px', color: '#64748B' }}>×</button>
        </div>
        <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 16px' }}>{item.groupName}</p>

        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '10px', padding: '14px', marginBottom: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#166534', marginBottom: '2px' }}>Amount due</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: TEAL }}>{sym}{fmt(item.amount)}</div>
        </div>

        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>Payment method</label>
        {methodsLoading ? (
          <div style={{ padding: '14px', textAlign: 'center', color: '#94A3B8', fontSize: '12px', marginBottom: '16px' }}>Loading methods…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {methods.map(m => (
              <div key={m.code} onClick={() => setMethod(m.code)}
                style={{ padding: '9px 4px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center', fontSize: '11px', fontWeight: '600',
                  border: `2px solid ${method === m.code ? TEAL : '#E2E8F0'}`, background: method === m.code ? '#F0FDF4' : 'white', color: NAVY }}>
                {m.name}
              </div>
            ))}
          </div>
        )}

        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>Payment reference</label>
        <input value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. EcoCash confirmation code"
          style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E2E8F0', borderRadius: '9px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any, marginBottom: '6px' }} />
        <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 16px' }}>Pay via your mobile-money or bank app, then enter the reference here. Your treasurer confirms receipt.</p>

        {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '9px', padding: '10px 12px', color: '#991B1B', fontSize: '12px', marginBottom: '14px' }}>❌ {err}</div>}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#F1F5F9', border: 'none', borderRadius: '9px', fontSize: '13px', cursor: 'pointer', color: '#475569', fontWeight: '500' }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ flex: 2, padding: '11px', background: saving ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', border: 'none', borderRadius: '9px', fontSize: '14px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? '⏳ Submitting…' : 'Submit Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Overview Tab ──────────────────────────────────────────────
function OverviewTab({ data, onViewCert, onPay }: any) {
  const { user, memberships, summary, recentContributions, upcomingContributions, payoutPositions, assetOwnerships, queueEntries, recentIncome } = data

  const nextDue = upcomingContributions?.[0]
  const myPayout = payoutPositions?.find((p: any) => p.status === 'PENDING')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Welcome banner */}
      <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, borderRadius: '16px', padding: '24px 28px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginBottom: '4px' }}>Welcome back</div>
          <div style={{ fontSize: '24px', fontWeight: '700' }}>👋 {user.fullName.split(' ')[0]}</div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)', marginTop: '4px' }}>
            {memberships.length} group{memberships.length !== 1 ? 's' : ''} · Reputation score: <strong>{Number(user.reputationScore).toFixed(0)}</strong>
          </div>
        </div>
        {nextDue && (
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: '12px', padding: '14px 18px', textAlign: 'center', backdropFilter: 'blur(4px)' }}>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', marginBottom: '4px' }}>Next contribution due</div>
            <div style={{ fontSize: '20px', fontWeight: '700' }}>{nextDue.currency === 'USD' ? '$' : nextDue.currency}{fmt(nextDue.amount)}</div>
            <div style={{ fontSize: '12px', color: nextDue.daysUntil <= 3 ? '#FCD34D' : 'rgba(255,255,255,0.75)', marginTop: '2px' }}>
              {nextDue.daysUntil === 0 ? '⚠️ Due today!' : nextDue.daysUntil === 1 ? '⚠️ Due tomorrow!' : `in ${nextDue.daysUntil} days`}
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>{nextDue.groupName}</div>
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <KpiCard icon="💸" label="Total Contributed"   value={`$${fmt(summary.totalContributed)}`}  color={TEAL}   sub={`across ${summary.totalGroups} group${summary.totalGroups !== 1 ? 's' : ''}`} />
        <KpiCard icon="🏆" label="Payout Position"     value={myPayout ? `#${myPayout.position}` : '—'}            color={NAVY}   sub={myPayout ? myPayout.groupName : 'No active payout'} />
        <KpiCard icon="🏭" label="Asset Stakes"         value={summary.totalAssets}                  color={PURPLE}  sub={`${assetOwnerships.length} owned + ${queueEntries.length} in queue`} />
        <KpiCard icon="💵" label="Income Received"      value={`$${fmt(summary.totalIncome)}`}       color="#166534" sub="from asset distributions" />
      </div>

      {/* Two column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* Upcoming contributions */}
        <SectionCard title="📅 Upcoming Contributions">
          {!upcomingContributions?.length ? <EmptyState icon="✅" text="No upcoming contributions" /> :
            upcomingContributions.slice(0, 6).map((c: any) => (
              <div key={c.payId} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: '1px solid #F8FAFC' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: c.daysUntil <= 3 ? '#FEF9C3' : '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                  {c.type === 'SAVINGS' ? '💰' : c.daysUntil <= 3 ? '⚠️' : '📅'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: '500', color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.groupName}</div>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                    Due {new Date(c.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    {c.daysUntil <= 7 && <span style={{ color: c.daysUntil <= 3 ? '#DC2626' : '#854D0E', marginLeft: '4px', fontWeight: '600' }}>({c.daysUntil <= 0 ? 'DUE' : `${c.daysUntil}d`})</span>}
                  </div>
                </div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: TEAL, whiteSpace: 'nowrap' }}>{c.currency === 'USD' ? '$' : c.currency}{fmt(c.amount)}</div>
                {c.paymentSubmitted
                  ? <span style={{ fontSize: '11px', fontWeight: 600, color: '#1E40AF', background: '#DBEAFE', padding: '5px 10px', borderRadius: '7px', whiteSpace: 'nowrap' }}>⏳ Submitted</span>
                  : <button onClick={() => onPay?.(c)} style={{ fontSize: '12px', fontWeight: 700, color: 'white', background: TEAL, border: 'none', padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Pay</button>}
              </div>
            ))
          }
        </SectionCard>

        {/* Payout schedule */}
        <SectionCard title="🏆 My Payout Positions">
          {!payoutPositions?.length ? <EmptyState icon="⏳" text="No payout positions yet" /> :
            payoutPositions.slice(0, 4).map((p: any) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: '1px solid #F8FAFC' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: p.status === 'PAID' ? '#DCFCE7' : '#F3E8FF', color: p.status === 'PAID' ? '#166534' : PURPLE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', flexShrink: 0 }}>
                  #{p.position}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: '500', color: NAVY }}>{p.groupName}</div>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>Cycle {p.cycleNumber} · {p.status}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: p.status === 'PAID' ? TEAL : NAVY }}>{p.currency === 'USD' ? '$' : p.currency}{fmt(p.payoutAmount)}</div>
                  {p.scheduledDate && <div style={{ fontSize: '10px', color: '#94A3B8' }}>{new Date(p.scheduledDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}
                </div>
              </div>
            ))
          }
        </SectionCard>
      </div>

      {/* My Groups */}
      {memberships.length > 0 && (
        <SectionCard title="👥 My Groups">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
            {memberships.map((m: any) => (
              <div key={m.groupId} style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px', border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: NAVY }}>{m.groupName}</div>
                    <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
                      {m.role.replace('_', ' ')} · Joined {new Date(m.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <Pill bg={m.groupStatus === 'ACTIVE' ? '#DCFCE7' : '#F1F5F9'} color={m.groupStatus === 'ACTIVE' ? '#166534' : '#475569'}>{m.groupStatus}</Pill>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                  {[
                    { label: 'Contribution', value: `${m.currency === 'USD' ? '$' : m.currency}${fmt(m.contribution)}/mo` },
                    { label: 'Members',      value: `${m.memberCount}/${m.maxMembers}` },
                    { label: 'Escrow',       value: `${m.currency === 'USD' ? '$' : m.currency}${fmt(m.escrowBalance)}` },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'white', borderRadius: '6px', padding: '7px 8px' }}>
                      <div style={{ fontSize: '9px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: NAVY, marginTop: '1px' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Asset queue entries */}
      {queueEntries.length > 0 && (
        <SectionCard title="🔄 My Round Robin Queue Positions">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {queueEntries.map((q: any) => {
              const sm = QUEUE_STATUS_META[q.status] || QUEUE_STATUS_META.WAITING
              return (
                <div key={q.assetId} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#F8FAFC', borderRadius: '10px', padding: '12px 14px', border: `1px solid ${q.status === 'FUNDING' ? '#93C5FD' : '#E2E8F0'}` }}>
                  <span style={{ fontSize: '24px', flexShrink: 0 }}>{ASSET_TYPE_ICONS[q.assetType] || '📦'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: NAVY }}>{q.assetName}</span>
                      <Pill bg={sm.bg} color={sm.color}>{sm.icon} {sm.label}</Pill>
                      <span style={{ fontSize: '11px', color: '#94A3B8' }}>{q.groupName} · Position #{q.position}</span>
                    </div>
                    {['FUNDING','SOURCING','ORDERED'].includes(q.status) && (
                      <div style={{ marginTop: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>
                          <span>Funding progress</span>
                          <span style={{ fontWeight: '600' }}>{q.fundingPct}% · ${fmt(q.raisedAmount)} of ${fmt(q.targetAmount)}</span>
                        </div>
                        <div style={{ height: '6px', background: '#E2E8F0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: TEAL, borderRadius: '3px', width: `${q.fundingPct}%` }} />
                        </div>
                      </div>
                    )}
                    {q.status === 'DELIVERED' && (
                      <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                        Delivered {q.deliveredAt ? new Date(q.deliveredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                        {q.serialNumber && <span style={{ fontFamily: 'monospace', marginLeft: '8px', color: TEAL }}>S/N: {q.serialNumber}</span>}
                        <button onClick={() => onViewCert(q)} style={{ marginLeft: '12px', padding: '2px 8px', background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', fontWeight: '600' }}>📜 Certificate</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* Recent contributions */}
      {recentContributions.length > 0 && (
        <SectionCard title="💸 Recent Contributions" action={<span style={{ fontSize: '11px', color: '#94A3B8' }}>Last 10 transactions</span>}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Group', 'Amount', 'Status', 'Date'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: '10px', fontWeight: '600', color: '#64748B', textTransform: 'uppercase', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentContributions.map((c: any) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #F8FAFC' }}>
                  <td style={{ padding: '9px 10px', fontSize: '13px', color: NAVY }}>{c.groupName}</td>
                  <td style={{ padding: '9px 10px', fontSize: '13px', fontWeight: '600', color: TEAL }}>{c.currency === 'USD' ? '$' : c.currency}{fmt(c.amount)}</td>
                  <td style={{ padding: '9px 10px' }}>
                    <Pill bg={c.status === 'COMPLETED' ? '#DCFCE7' : c.status === 'PENDING' ? '#DBEAFE' : '#FEE2E2'} color={c.status === 'COMPLETED' ? '#166534' : c.status === 'PENDING' ? '#1E40AF' : '#991B1B'}>{c.status}</Pill>
                  </td>
                  <td style={{ padding: '9px 10px', fontSize: '11px', color: '#94A3B8' }}>{new Date(c.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}

      {/* Recent income */}
      {recentIncome.length > 0 && (
        <SectionCard title="💰 Recent Income Distributions">
          {recentIncome.map((i: any) => (
            <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: '1px solid #F8FAFC' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>💵</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: '500', color: NAVY }}>{i.assetName}</div>
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>{i.type} · {new Date(i.incomeDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {Number(i.ownershipPct).toFixed(2)}% ownership</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#166534' }}>+${fmt(i.shareAmount)}</div>
                <Pill bg={i.status === 'PAID' ? '#DCFCE7' : '#FEF9C3'} color={i.status === 'PAID' ? '#166534' : '#854D0E'}>{i.status}</Pill>
              </div>
            </div>
          ))}
        </SectionCard>
      )}
    </div>
  )
}

// ── Contributions Tab ─────────────────────────────────────────
function ContributionsTab({ userId }: { userId: string }) {
  const [data, setData]     = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ALL')

  useEffect(() => {
    fetch(`/api/portal?userId=${userId}&section=contributions`)
      .then(r => r.json()).then(d => { if (d.success) setData(d.data) })
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#94A3B8' }}>⏳ Loading...</div>
  if (!data)   return <div style={{ textAlign: 'center', padding: '60px', color: '#94A3B8' }}>No data</div>

  const contributions = data.contributions.filter((c: any) => filter === 'ALL' || c.status === filter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        {[
          { label: 'Total Paid',  value: `$${fmt(data.totalPaid)}`,         color: TEAL         },
          { label: 'Completed',   value: data.byStatus.completed,           color: '#166534'    },
          { label: 'Pending',     value: data.byStatus.pending,             color: '#1E40AF'    },
          { label: 'Late',        value: data.byStatus.late,                color: '#991B1B'    },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '10px', padding: '14px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>{s.label}</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {['ALL', 'COMPLETED', 'PENDING', 'LATE'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: '500', cursor: 'pointer', background: filter === s ? TEAL : 'white', color: filter === s ? 'white' : '#64748B', border: filter === s ? 'none' : '1.5px solid #E2E8F0' }}>{s}</button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Group', 'Amount', 'Method', 'Reference', 'Status', 'Description', 'Date'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '600', color: '#64748B', textTransform: 'uppercase', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contributions.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>No contributions found</td></tr>
            ) : contributions.map((c: any, i: number) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #F8FAFC', background: i % 2 === 0 ? 'white' : '#FAFAFA' }}>
                <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '500', color: NAVY }}>{c.groupName}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '700', color: TEAL }}>{c.currency === 'USD' ? '$' : c.currency}{fmt(c.amount)}</td>
                <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569' }}>{c.paymentMethod?.replace(/_/g, ' ') || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: '11px', color: '#94A3B8', fontFamily: 'monospace' }}>{c.reference || '—'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <Pill bg={c.status==='COMPLETED'?'#DCFCE7':c.status==='PENDING'?'#DBEAFE':'#FEE2E2'} color={c.status==='COMPLETED'?'#166534':c.status==='PENDING'?'#1E40AF':'#991B1B'}>{c.status}</Pill>
                </td>
                <td style={{ padding: '10px 14px', fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap' }}>
                  {c.dueDate ? new Date(c.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                </td>
                <td style={{ padding: '10px 14px', fontSize: '11px', color: '#94A3B8', whiteSpace: 'nowrap' }}>
                  {new Date(c.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Assets Tab ────────────────────────────────────────────────
function AssetsTab({ data, onViewCert }: any) {
  const { assetOwnerships, queueEntries } = data
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Owned assets */}
      {assetOwnerships.length > 0 && (
        <SectionCard title="🏭 My Asset Stakes">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {assetOwnerships.map((a: any) => (
              <div key={a.assetId} style={{ display: 'flex', alignItems: 'center', gap: '14px', background: '#F8FAFC', borderRadius: '10px', padding: '14px', border: '1px solid #E2E8F0' }}>
                <span style={{ fontSize: '28px', flexShrink: 0 }}>{ASSET_TYPE_ICONS[a.assetType] || '📦'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: NAVY, marginBottom: '3px' }}>{a.assetName}</div>
                  <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: '#64748B', flexWrap: 'wrap' }}>
                    <span>Type: {a.assetType.replace(/_/g, ' ')}</span>
                    <span>Status: <strong style={{ color: a.assetStatus === 'ACQUIRED' ? TEAL : '#854D0E' }}>{a.assetStatus}</strong></span>
                    <span>Contributed: <strong style={{ color: NAVY }}>${fmt(a.contributed)}</strong></span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: PURPLE }}>{Number(a.ownershipPct).toFixed(2)}%</div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>ownership</div>
                  {a.currentValue > 0 && <div style={{ fontSize: '12px', fontWeight: '600', color: TEAL, marginTop: '2px' }}>Value: ${fmt(a.myValue)}</div>}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Queue positions */}
      {queueEntries.length > 0 && (
        <SectionCard title="🔄 Round Robin Queue Positions">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {queueEntries.map((q: any) => {
              const sm = QUEUE_STATUS_META[q.status] || QUEUE_STATUS_META.WAITING
              return (
                <div key={q.assetId} style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px', border: `2px solid ${q.status === 'FUNDING' ? '#93C5FD' : '#E2E8F0'}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '28px', flexShrink: 0 }}>{ASSET_TYPE_ICONS[q.assetType] || '📦'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: NAVY }}>{q.assetName}</span>
                        <Pill bg={sm.bg} color={sm.color}>{sm.icon} {sm.label}</Pill>
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '8px' }}>
                        {q.groupName} · Position #{q.position} · Target: ${fmt(q.targetAmount)}
                      </div>
                      {['FUNDING', 'SOURCING', 'ORDERED'].includes(q.status) && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>
                            <span>Funding progress</span>
                            <span style={{ fontWeight: '600' }}>{q.fundingPct}%</span>
                          </div>
                          <div style={{ height: '8px', background: '#E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', background: TEAL, borderRadius: '4px', width: `${q.fundingPct}%`, transition: 'width 0.5s' }} />
                          </div>
                          <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>${fmt(q.raisedAmount)} raised of ${fmt(q.targetAmount)}</div>
                      </>
                        )}
                      {q.status === 'DELIVERED' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                          <span style={{ fontSize: '12px', color: '#166534', fontWeight: '500' }}>
                            ✅ Delivered {q.deliveredAt ? new Date(q.deliveredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                          </span>
                          {q.serialNumber && <span style={{ fontSize: '11px', fontFamily: 'monospace', color: TEAL }}>S/N: {q.serialNumber}</span>}
                          <button onClick={() => onViewCert(q)} style={{ padding: '4px 10px', background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: '600' }}>📜 View Certificate</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      {assetOwnerships.length === 0 && queueEntries.length === 0 && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '60px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏭</div>
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: NAVY, margin: '0 0 8px' }}>No asset stakes yet</h3>
          <p style={{ color: '#64748B', fontSize: '13px' }}>When your group starts an asset campaign and you contribute, your stakes will appear here.</p>
        </div>
      )}
    </div>
  )
}

// ── Documents Tab ─────────────────────────────────────────────
function DocumentsTab({ userId }: { userId: string }) {
  const [data, setData]     = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/portal?userId=${userId}&section=documents`)
      .then(r => r.json()).then(d => { if (d.success) setData(d.data) })
      .finally(() => setLoading(false))
  }, [userId])

  async function downloadCert(entryId: string) {
    const a   = document.createElement('a')
    a.href    = `/api/assets/handover?entryId=${entryId}`
    a.target  = '_blank'
    a.click()
  }

  function exportIncomeCSV() {
    if (!data?.incomeStatements?.length) return
    const rows = [['Asset', 'Type', 'Description', 'Amount', 'Status', 'Date'],
      ...data.incomeStatements.map((i: any) => [i.assetName, i.type, i.description, `$${fmt(i.shareAmount)}`, i.status, new Date(i.incomeDate).toLocaleDateString('en-GB')])]
    const csv  = rows.map(r => r.join(',')).join('\n')
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'My-Income-Statement.csv'
    a.click()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#94A3B8' }}>⏳ Loading documents...</div>
  if (!data)   return <div style={{ textAlign: 'center', padding: '60px', color: '#94A3B8' }}>No documents</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Handover certificates */}
      <SectionCard title="📜 Handover Certificates">
        {!data.handoverCertificates?.length ? (
          <EmptyState icon="📜" text="No handover certificates yet. Certificates are issued when Round Robin assets are delivered to you." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {data.handoverCertificates.map((c: any) => (
              <div key={c.entryId} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#F0FDF4', borderRadius: '10px', padding: '14px', border: '1px solid #BBF7D0' }}>
                <span style={{ fontSize: '28px', flexShrink: 0 }}>{ASSET_TYPE_ICONS[c.assetType] || '📦'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: NAVY }}>{c.assetName}</div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
                    Delivered {c.deliveredAt ? new Date(c.deliveredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Unknown'}
                    {c.serialNumber && <span style={{ fontFamily: 'monospace', marginLeft: '8px', color: TEAL }}>S/N: {c.serialNumber}</span>}
                  </div>
                </div>
                <button onClick={() => downloadCert(c.entryId)}
                  style={{ padding: '8px 16px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  📥 Download PDF
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Income statement */}
      <SectionCard title="💵 Income Statement"
        action={data.incomeStatements?.length > 0 ? (
          <button onClick={exportIncomeCSV} style={{ padding: '5px 12px', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', color: '#475569' }}>📥 Export CSV</button>
        ) : null}>
        {!data.incomeStatements?.length ? (
          <EmptyState icon="💵" text="No income distributions yet. When assets generate income and it's distributed, your share will appear here." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Asset', 'Type', 'Description', 'My Share', 'Status', 'Date'].map(h => (
                  <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '600', color: '#64748B', textTransform: 'uppercase', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.incomeStatements.map((i: any, idx: number) => (
                <tr key={i.id} style={{ borderBottom: '1px solid #F8FAFC', background: idx % 2 === 0 ? 'white' : '#FAFAFA' }}>
                  <td style={{ padding: '9px 12px', fontSize: '13px', fontWeight: '500', color: NAVY }}>{i.assetName || '—'}</td>
                  <td style={{ padding: '9px 12px', fontSize: '12px', color: '#475569' }}>{i.type}</td>
                  <td style={{ padding: '9px 12px', fontSize: '12px', color: '#64748B', maxWidth: '200px' }}>{i.description}</td>
                  <td style={{ padding: '9px 12px', fontSize: '13px', fontWeight: '700', color: '#166534' }}>+${fmt(i.shareAmount)}</td>
                  <td style={{ padding: '9px 12px' }}>
                    <Pill bg={i.status==='PAID'?'#DCFCE7':'#FEF9C3'} color={i.status==='PAID'?'#166534':'#854D0E'}>{i.status}</Pill>
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: '11px', color: '#94A3B8', whiteSpace: 'nowrap' }}>
                    {new Date(i.incomeDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  )
}

// ── Profile Tab ───────────────────────────────────────────────
function ProfileTab({ user }: any) {
  const KYC_META: Record<string, any> = {
    NOT_SUBMITTED: { bg:'#F1F5F9', color:'#475569', label:'Not submitted', action:'Submit KYC' },
    SUBMITTED:     { bg:'#FEF9C3', color:'#854D0E', label:'Under review',  action:null          },
    VERIFIED:      { bg:'#DCFCE7', color:'#166534', label:'Verified ✓',    action:null          },
    REJECTED:      { bg:'#FEE2E2', color:'#991B1B', label:'Rejected',      action:'Resubmit'    },
  }
  const TIER_META: Record<string, any> = {
    BRONZE:   { bg:'#FEE2E2', color:'#7F1D1D' },
    SILVER:   { bg:'#F1F5F9', color:'#475569' },
    GOLD:     { bg:'#FEF9C3', color:'#92400E' },
    PLATINUM: { bg:'#F3E8FF', color:'#5B21B6' },
  }
  const kyc  = KYC_META[user.kycStatus]  || KYC_META.NOT_SUBMITTED
  const tier = TIER_META[user.tier]      || TIER_META.BRONZE

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px' }}>

      {/* Avatar + name */}
      <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, borderRadius: '16px', padding: '28px', display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: '700', color: 'white', flexShrink: 0 }}>
          {user.fullName.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
        </div>
        <div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: 'white' }}>{user.fullName}</div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', marginTop: '2px' }}>{user.email}</div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
            <span style={{ background: tier.bg, color: tier.color, fontSize: '11px', fontWeight: '700', padding: '3px 9px', borderRadius: '999px' }}>{user.tier}</span>
            <span style={{ background: kyc.bg, color: kyc.color, fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px' }}>KYC: {kyc.label}</span>
            <span style={{ background: 'rgba(255,255,255,0.15)', color: 'white', fontSize: '11px', padding: '3px 9px', borderRadius: '999px' }}>Score: {Number(user.reputationScore).toFixed(0)}</span>
          </div>
        </div>
      </div>

      {/* Details */}
      <SectionCard title="👤 Personal Information">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          {[
            ['Full Name',       user.fullName],
            ['Email',           user.email],
            ['Phone',           user.phone || '—'],
            ['City',            user.city || '—'],
            ['Country',         user.country || '—'],
            ['KYC Status',      user.kycStatus?.replace(/_/g, ' ')],
            ['Member Since',    new Date(user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })],
            ['Account Status',  user.status],
          ].map(([l, v]) => (
            <div key={l} style={{ background: '#F8FAFC', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '3px' }}>{l}</div>
              <div style={{ fontSize: '13px', fontWeight: '500', color: NAVY }}>{v}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* KYC call to action */}
      {user.kycStatus === 'NOT_SUBMITTED' && (
        <div style={{ background: '#FEF9C3', border: '1px solid #FCD34D', borderRadius: '12px', padding: '16px 18px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#854D0E', marginBottom: '4px' }}>⚠️ KYC Verification Pending</div>
          <div style={{ fontSize: '12px', color: '#92400E', lineHeight: '1.5' }}>Your identity has not been verified yet. Some features may be limited until you complete KYC. Please contact your group administrator to submit your documents.</div>
        </div>
      )}
    </div>
  )
}

// ── Certificate Viewer ────────────────────────────────────────
function CertModal({ entry, onClose }: any) {
  const [loading, setLoading] = useState(true)
  const [url, setUrl]         = useState<string|null>(null)

  useEffect(() => {
    fetch(`/api/assets/handover?entryId=${entry.assetId || entry.id || entry.entryId}&preview=true`)
      .then(r => r.blob()).then(b => setUrl(URL.createObjectURL(b)))
      .catch(() => {}).finally(() => setLoading(false))
  }, [entry])

  function download() {
    const a = document.createElement('a')
    a.href = `/api/assets/handover?entryId=${entry.assetId || entry.id || entry.entryId}`
    a.target = '_blank'; a.click()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '720px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ background: NAVY, padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'white', margin: 0 }}>📜 Handover Certificate</h3>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', margin: '2px 0 0' }}>{entry.assetName}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={download} style={{ padding: '7px 14px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>📥 Download</button>
            <button onClick={onClose} style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '18px', color: 'white' }}>×</button>
          </div>
        </div>
        <div style={{ flex: 1, background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
          {loading ? <div style={{ textAlign: 'center', color: '#94A3B8' }}><div style={{ fontSize: '32px', marginBottom: '10px' }}>⏳</div><p>Generating...</p></div>
            : url ? <iframe src={url} style={{ width: '100%', height: '100%', border: 'none', minHeight: '460px' }} />
            : <div style={{ color: '#94A3B8' }}>Failed to load preview</div>}
        </div>
      </div>
    </div>
  )
}

// ── Version Badge (remove before production) ─────────────────
function VersionBadge({ label, ver }: { label: string; ver: string }) {
  return (
    <div style={{ position:'fixed', bottom:'12px', right:'12px', background:'rgba(13,33,55,0.85)', color:'white', fontSize:'10px', padding:'4px 10px', borderRadius:'999px', zIndex:9998, fontFamily:'monospace', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', gap:'6px' }}>
      <span style={{ opacity:0.5 }}>DEV</span>
      <span style={{ opacity:0.8 }}>Member Portal</span>
      <span style={{ background:'#0F6E56', padding:'1px 6px', borderRadius:'999px', fontWeight:'700' }}>v1.2</span>
    </div>
  )
}

export default function MemberPortal() {
  const [data, setData]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string>('')
  const [tab, setTab]         = useState('overview')
  const [certEntry, setCertEntry] = useState<any>(null)
  const [userId, setUserId]   = useState<string>('')
  const [payItem, setPayItem] = useState<any>(null)
  const [toast, setToast]     = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    // Support ?as=email for dev testing (e.g. /portal?as=tendai.moyo@test.com)
    const params  = new URLSearchParams(window.location.search)
    const asEmail = params.get('as')
    const url     = asEmail ? `/api/auth/me?as=${encodeURIComponent(asEmail)}` : '/api/auth/me'

    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data?.id) {
          setUserId(d.data.id)
        } else {
          setError(`Auth failed: ${d.error || 'No user returned'}`)
          setLoading(false)
        }
      })
      .catch(e => { setError(`Network error: ${e.message}`); setLoading(false) })
  }, [])

  const fetchOverview = useCallback(() => {
    if (!userId) return
    setLoading(true)
    fetch(`/api/portal?userId=${userId}&section=overview`)
      .then(r => r.json())
      .then(d => {
        if (d.success) { setData(d.data); setError('') }
        else setError(`Portal API error: ${d.error}`)
      })
      .catch(e => setError(`Network error: ${e.message}`))
      .finally(() => setLoading(false))
  }, [userId])

  useEffect(() => { fetchOverview() }, [fetchOverview])

  const TABS = [
    { id: 'overview',      icon: '🏠', label: 'Overview'      },
    { id: 'contributions', icon: '💸', label: 'Contributions' },
    { id: 'assets',        icon: '🏭', label: 'My Assets'     },
    { id: 'documents',     icon: '📄', label: 'Documents'     },
    { id: 'profile',       icon: '👤', label: 'My Profile'    },
  ]

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#F8FAFC' }}>
      <VersionBadge label="Member Portal" ver="v1.3" />
      {certEntry && <CertModal entry={certEntry} onClose={() => setCertEntry(null)} />}
      {payItem && (
        <PayModal
          item={payItem}
          userId={userId}
          onClose={() => setPayItem(null)}
          onPaid={(msg: string) => { setPayItem(null); showToast(msg); fetchOverview() }}
          onError={(msg: string) => showToast(msg, 'error')}
        />
      )}
      {toast && (
        <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 3000, background: toast.type === 'success' ? '#065F46' : '#991B1B', color: 'white', padding: '12px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', maxWidth: '360px' }}>
          {toast.type === 'success' ? '✅ ' : '❌ '}{toast.msg}
        </div>
      )}

      {/* Top navigation */}
      <div style={{ background: `linear-gradient(135deg, ${NAVY}, #1A3A5C)`, padding: '0 24px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '0' }}>
          {/* Brand */}
          <div style={{ padding: '14px 20px 14px 0', borderRight: '1px solid rgba(255,255,255,0.1)', marginRight: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>🔄</span>
            <span style={{ fontSize: '14px', fontWeight: '700', color: 'white' }}>Stokvel Platform</span>
          </div>
          {/* Tabs */}
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: '16px 14px', background: 'none', border: 'none', borderBottom: tab === t.id ? `3px solid ${TEAL}` : '3px solid transparent', color: tab === t.id ? 'white' : 'rgba(255,255,255,0.5)', fontWeight: tab === t.id ? '600' : '400', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: '15px' }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {data && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <NotificationBell userId={userId} />
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', color: 'white' }}>
                {data.user?.fullName?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
              </div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.75)' }}>{data.user?.fullName?.split(' ')[0]}</div>
              {['SYSTEM_ADMIN','NATIONAL_ADMIN','GROUP_ADMIN','TREASURER','INVESTMENT_MANAGER','AUDITOR'].includes(data.user?.role) && (
                <button onClick={() => { window.location.href = '/dashboard' }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 13px', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.25)', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', marginLeft: '4px' }}>
                  ⚙️ Admin Dashboard
                </button>
              )}
              <LogoutButton style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.25)', padding: '7px 13px', marginLeft: '4px' }} />
            </div>
          )}
        </div>
      </div>

      {/* Page content */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px', color: '#94A3B8' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>⏳</div>
            <div style={{ fontSize: '15px' }}>Loading your portal...</div>
          </div>
        ) : !data ? (
          <div style={{ textAlign: 'center', padding: '80px', color: '#94A3B8' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>❌</div>
            <div style={{ fontSize: '15px', marginBottom: '8px' }}>Could not load your data.</div>
            {error && <div style={{ fontSize: '13px', color: '#DC2626', background: '#FEF2F2', padding: '10px 16px', borderRadius: '8px', maxWidth: '500px', margin: '0 auto', textAlign: 'left' }}>{error}</div>}
            <button onClick={() => window.location.reload()} style={{ marginTop: '16px', padding: '8px 20px', background: '#0F6E56', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>↻ Retry</button>
          </div>
        ) : (
          <>
            {tab === 'overview'      && <OverviewTab data={data} onViewCert={setCertEntry} onPay={setPayItem} />}
            {tab === 'contributions' && <ContributionsTab userId={userId} />}
            {tab === 'assets'        && <AssetsTab data={data} onViewCert={setCertEntry} />}
            {tab === 'documents'     && <DocumentsTab userId={userId} />}
            {tab === 'profile'       && <ProfileTab user={data.user} />}
          </>
        )}
      </div>
    </div>
  )
}
