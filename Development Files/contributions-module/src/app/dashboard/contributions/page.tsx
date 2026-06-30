'use client'
import { useState, useEffect, useCallback } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const BLUE = '#1A5EA8'

const STATUS_COLORS: Record<string, [string, string]> = {
  PAID:      ['#DCFCE7', '#166534'],
  PRE_PAID:  ['#DBEAFE', '#1E40AF'],
  PENDING:   ['#F1F5F9', '#475569'],
  LATE:      ['#FEF9C3', '#854D0E'],
  FAILED:    ['#FEE2E2', '#991B1B'],
  DEFAULTED: ['#FEE2E2', '#7F1D1D'],
  WAIVED:    ['#F3E8FF', '#6B21A8'],
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const PAYMENT_METHODS = ['ECOCASH','BANK_TRANSFER','CARD','INTERNAL_TRANSFER','CASH']

function StatusBadge({ status }: { status: string }) {
  const [bg, color] = STATUS_COLORS[status] || ['#F1F5F9', '#475569']
  return (
    <span style={{ background: bg, color, fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '999px', whiteSpace: 'nowrap' }}>
      {status.replace('_', ' ')}
    </span>
  )
}

function StatCard({ label, value, sub, color, icon }: any) {
  return (
    <div style={{ background: 'white', borderRadius: '10px', padding: '16px', border: '1px solid #E2E8F0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '18px' }}>{icon}</span>
        <span style={{ fontSize: '11px', color: '#64748B', fontWeight: '500' }}>{label}</span>
      </div>
      <div style={{ fontSize: '24px', fontWeight: '700', color }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '3px' }}>{sub}</div>}
    </div>
  )
}

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  return (
    <div style={{
      position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
      padding: '12px 20px', borderRadius: '10px', fontWeight: '500', fontSize: '13px',
      boxShadow: '0 8px 25px rgba(0,0,0,0.15)',
      background: type === 'success' ? '#166534' : '#991B1B', color: 'white',
      display: 'flex', alignItems: 'center', gap: '10px',
    }}>
      <span>{type === 'success' ? '✅' : '❌'}</span>
      <span>{msg}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
    </div>
  )
}

function PaymentModal({ contribution, onClose, onSuccess }: any) {
  const [amount, setAmount]   = useState(String(contribution.amountDue - contribution.amountPaid))
  const [method, setMethod]   = useState('ECOCASH')
  const [ref, setRef]         = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!amount || parseFloat(amount) <= 0) return setError('Enter a valid amount')
    setSaving(true)
    try {
      const res = await fetch('/api/contributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contributionId: contribution.id,
          amountPaid: parseFloat(amount),
          paymentMethod: method,
          paymentRef: ref || undefined,
        }),
      })
      const data = await res.json()
      if (data.success) { onSuccess(data.message); onClose() }
      else setError(data.error || 'Payment failed')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '440px', boxShadow: '0 25px 50px rgba(0,0,0,0.25)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: NAVY, margin: '0 0 4px' }}>Record Payment</h3>
            <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>{contribution.memberName} · Month {contribution.monthNumber} · {contribution.groupName}</p>
          </div>
          <button onClick={onClose} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '18px', color: '#64748B' }}>×</button>
        </div>

        {/* Summary box */}
        <div style={{ background: '#F0FDF4', borderRadius: '10px', padding: '14px', marginBottom: '20px', border: '1px solid #BBF7D0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', textAlign: 'center' }}>
            {[
              { label: 'Amount Due', value: `$${contribution.amountDue.toFixed(2)}` },
              { label: 'Paid So Far', value: `$${contribution.amountPaid.toFixed(2)}` },
              { label: 'Outstanding', value: `$${(contribution.amountDue - contribution.amountPaid).toFixed(2)}` },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: '10px', color: '#166534', opacity: 0.7 }}>{s.label}</div>
                <div style={{ fontSize: '16px', fontWeight: '700', color: '#166534' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handlePay}>
          {/* Amount */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Payment Amount *</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748B', fontSize: '14px' }}>$</span>
              <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required
                style={{ width: '100%', padding: '9px 12px 9px 28px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as any, fontWeight: '600' }}
              />
            </div>
          </div>

          {/* Method */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Payment Method *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { value: 'ECOCASH', label: '📱 EcoCash', color: '#E1F5EE' },
                { value: 'BANK_TRANSFER', label: '🏦 Bank Transfer', color: '#DBEAFE' },
                { value: 'CARD', label: '💳 Card', color: '#FEF9C3' },
                { value: 'CASH', label: '💵 Cash', color: '#F3E8FF' },
              ].map(m => (
                <div key={m.value} onClick={() => setMethod(m.value)}
                  style={{ padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', border: `2px solid ${method === m.value ? TEAL : '#E2E8F0'}`, background: method === m.value ? '#F0FDF4' : 'white', fontSize: '12px', fontWeight: '500', color: NAVY, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* Reference */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Payment Reference <span style={{ color: '#94A3B8', fontWeight: '400' }}>(optional)</span></label>
            <input type="text" value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. EcoCash ref, bank ref..."
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as any }}
            />
          </div>

          {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 14px', color: '#991B1B', fontSize: '12px', marginBottom: '14px' }}>❌ {error}</div>}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#475569', fontWeight: '500' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{
              flex: 2, padding: '10px', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
              cursor: saving ? 'not-allowed' : 'pointer',
              background: saving ? '#94A3B8' : `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white',
            }}>
              {saving ? '⏳ Recording...' : `✓ Record $${parseFloat(amount || '0').toFixed(2)} Payment`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────
export default function ContributionsPage() {
  const [tab, setTab]                       = useState<'dashboard' | 'tracker' | 'history'>('dashboard')
  const [summary, setSummary]               = useState<any>(null)
  const [contributions, setContributions]   = useState<any[]>([])
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingList, setLoadingList]       = useState(false)
  const [toast, setToast]                   = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [payModal, setPayModal]             = useState<any>(null)
  const [search, setSearch]                 = useState('')
  const [filterStatus, setFilterStatus]     = useState('ALL')
  const [filterMonth, setFilterMonth]       = useState('ALL')
  const [currentPage, setCurrentPage]       = useState(1)
  const [totalPages, setTotalPages]         = useState(1)

  // ── Fetch summary ───────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true)
    try {
      const res = await fetch('/api/contributions/summary')
      const data = await res.json()
      if (data.success) setSummary(data.data)
    } catch { showToast('Failed to load summary', 'error') }
    finally { setLoadingSummary(false) }
  }, [])

  // ── Fetch contributions ─────────────────────────────────────
  const fetchContributions = useCallback(async () => {
    setLoadingList(true)
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: '20' })
      if (filterStatus !== 'ALL') params.set('status', filterStatus)
      if (filterMonth !== 'ALL') params.set('month', filterMonth)
      const res = await fetch(`/api/contributions?${params}`)
      const data = await res.json()
      if (data.success) {
        setContributions(data.data)
        setTotalPages(data.pagination?.totalPages || 1)
      }
    } catch { showToast('Failed to load contributions', 'error') }
    finally { setLoadingList(false) }
  }, [filterStatus, filterMonth, currentPage])

  useEffect(() => { fetchSummary() }, [fetchSummary])
  useEffect(() => { if (tab === 'tracker' || tab === 'history') fetchContributions() }, [tab, fetchContributions])

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
  }

  const filtered = contributions.filter(c =>
    c.memberName.toLowerCase().includes(search.toLowerCase()) ||
    c.groupName.toLowerCase().includes(search.toLowerCase())
  )

  // Compute status breakdown
  const statusBreakdown = summary?.statusBreakdown || []
  const getCount = (s: string) => statusBreakdown.find((x: any) => x.status === s)?._count || statusBreakdown.find((x: any) => x.status === s)?.count || 0

  // ── DASHBOARD TAB ───────────────────────────────────────────
  function DashboardTab() {
    if (loadingSummary) return (
      <div style={{ textAlign: 'center', padding: '60px', color: '#64748B' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
        <p>Loading contribution data...</p>
      </div>
    )

    if (!summary || summary.cycles.length === 0) return (
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '60px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>💳</div>
        <h3 style={{ fontSize: '16px', fontWeight: '600', color: NAVY, margin: '0 0 8px' }}>No Active Cycles</h3>
        <p style={{ color: '#64748B', fontSize: '13px', marginBottom: '20px' }}>Contributions are collected during active cycles.<br />Create a group and start a cycle to begin collecting.</p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button style={{ padding: '10px 20px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Go to Groups</button>
        </div>
      </div>
    )

    const { cycles, totals, recentPayments, upcomingDue } = summary

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          <StatCard label="Total Collected"   value={`$${totals.paid.toLocaleString()}`}         sub="This cycle"            color={TEAL}     icon="💰" />
          <StatCard label="Outstanding"       value={`$${totals.outstanding.toLocaleString()}`}   sub="Remaining to collect"  color={BLUE}     icon="⏳" />
          <StatCard label="Active Members"    value={totals.members}                              sub="Across all cycles"     color={NAVY}     icon="👥" />
          <StatCard label="Defaulters"        value={totals.defaulted}                            sub="Require action"        color="#DC2626"  icon="⚠️" />
        </div>

        {/* Status breakdown */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 16px' }}>📊 Contribution Status Breakdown</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px' }}>
            {['PAID','PRE_PAID','PENDING','LATE','FAILED','DEFAULTED'].map(s => {
              const item = statusBreakdown.find((x: any) => x.status === s)
              const count = item?.count || 0
              const [bg, color] = STATUS_COLORS[s]
              return (
                <div key={s} style={{ background: bg, borderRadius: '10px', padding: '14px', textAlign: 'center' }}
                  onClick={() => { setFilterStatus(s); setTab('tracker') }}
                  style={{ background: bg, borderRadius: '10px', padding: '14px', textAlign: 'center', cursor: 'pointer' }}>
                  <div style={{ fontSize: '22px', fontWeight: '700', color }}>{count}</div>
                  <div style={{ fontSize: '10px', color, fontWeight: '600', marginTop: '4px' }}>{s.replace('_', ' ')}</div>
                  {item && <div style={{ fontSize: '10px', color, opacity: 0.7, marginTop: '2px' }}>${Number(item.totalPaid || 0).toFixed(0)} paid</div>}
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Recent Payments */}
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: 0 }}>✅ Recent Payments</h3>
              <button onClick={() => setTab('history')} style={{ fontSize: '12px', color: TEAL, background: 'none', border: 'none', cursor: 'pointer' }}>View all →</button>
            </div>
            {recentPayments.length === 0 ? (
              <p style={{ color: '#94A3B8', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>No payments recorded yet</p>
            ) : recentPayments.map((p: any) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #F8FAFC' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#E1F5EE', color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', flexShrink: 0 }}>
                  {p.memberName.split(' ').map((n: string) => n[0]).join('').slice(0,2)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: '500', color: NAVY }}>{p.memberName}</div>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>{p.groupName} · Month {p.monthNumber}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: TEAL }}>${Number(p.amount).toFixed(2)}</div>
                  <div style={{ fontSize: '10px', color: '#94A3B8' }}>{p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Upcoming Due */}
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: 0 }}>⏰ Due Soon / Overdue</h3>
              <button onClick={() => { setFilterStatus('LATE'); setTab('tracker') }} style={{ fontSize: '12px', color: TEAL, background: 'none', border: 'none', cursor: 'pointer' }}>Manage →</button>
            </div>
            {upcomingDue.length === 0 ? (
              <p style={{ color: '#94A3B8', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>All contributions up to date! 🎉</p>
            ) : upcomingDue.map((c: any) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #F8FAFC' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#FEF9C3', color: '#854D0E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', flexShrink: 0 }}>
                  {c.memberName.split(' ').map((n: string) => n[0]).join('').slice(0,2)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: '500', color: NAVY }}>{c.memberName}</div>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>{c.groupName} · Due {new Date(c.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <StatusBadge status={c.status} />
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#854D0E', marginTop: '2px' }}>${Number(c.amountDue).toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Active cycles */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px' }}>🔄 Active Cycles</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {cycles.map((c: any) => (
              <div key={c.id} style={{ background: '#F8FAFC', borderRadius: '10px', padding: '14px', border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: NAVY, marginBottom: '4px' }}>{c.groupName}</div>
                <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '8px' }}>Cycle {c.cycleNumber} · {c.totalMembers} members</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: '#64748B' }}>Monthly pool</span>
                  <span style={{ fontWeight: '600', color: TEAL }}>${Number(c.poolAmount).toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '4px' }}>
                  <span style={{ color: '#64748B' }}>Per member</span>
                  <span style={{ fontWeight: '600', color: NAVY }}>${Number(c.contributionAmount).toLocaleString()}/mo</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── TRACKER TAB ─────────────────────────────────────────────
  function TrackerTab() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input placeholder="Search member or group..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '8px 14px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', width: '240px', outline: 'none' }}
          />
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1) }}
            style={{ padding: '8px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: 'white' }}>
            {['ALL','PAID','PRE_PAID','PENDING','LATE','FAILED','DEFAULTED'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setCurrentPage(1) }}
            style={{ padding: '8px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', background: 'white' }}>
            <option value="ALL">All Months</option>
            {Array.from({ length: 12 }, (_, i) => <option key={i+1} value={String(i+1)}>Month {i+1} ({MONTH_NAMES[i]})</option>)}
          </select>
          <button onClick={fetchContributions} style={{ padding: '8px 14px', background: '#F1F5F9', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: '#475569' }}>↻ Refresh</button>
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          {loadingList ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>⏳ Loading contributions...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '36px', marginBottom: '8px' }}>💳</div>
              <p style={{ color: '#64748B', fontSize: '13px' }}>No contributions found for these filters.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Member','Group','Month','Due Date','Amount Due','Paid','Balance','Status','Action'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#64748B', borderBottom: '1px solid #E2E8F0', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #F8FAFC', background: c.status === 'DEFAULTED' ? '#FFF5F5' : c.status === 'LATE' ? '#FFFBEB' : i % 2 === 0 ? 'white' : '#FAFAFA' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#E1F5EE', color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '700', flexShrink: 0 }}>
                          {c.memberName.split(' ').map((n: string) => n[0]).join('').slice(0,2)}
                        </div>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '500', color: NAVY }}>{c.memberName}</div>
                          <div style={{ fontSize: '10px', color: '#94A3B8' }}>{c.memberEmail}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569' }}>{c.groupName}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569' }}>
                      <span style={{ fontWeight: '500' }}>#{c.monthNumber}</span>
                      <span style={{ color: '#94A3B8', marginLeft: '4px' }}>{MONTH_NAMES[(c.monthNumber - 1) % 12]}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569', whiteSpace: 'nowrap' }}>
                      {new Date(c.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', fontWeight: '600', color: NAVY }}>${c.amountDue.toFixed(2)}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', fontWeight: '600', color: c.amountPaid > 0 ? TEAL : '#94A3B8' }}>
                      ${c.amountPaid.toFixed(2)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', fontWeight: '600', color: c.balance > 0 ? '#DC2626' : TEAL }}>
                      ${c.balance.toFixed(2)}
                    </td>
                    <td style={{ padding: '10px 14px' }}><StatusBadge status={c.status} /></td>
                    <td style={{ padding: '10px 14px' }}>
                      {!['PAID','PRE_PAID','WAIVED'].includes(c.status) ? (
                        <button onClick={() => setPayModal(c)}
                          style={{ padding: '4px 10px', background: TEAL, color: 'white', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: '500', whiteSpace: 'nowrap' }}>
                          Record Pay
                        </button>
                      ) : (
                        <span style={{ fontSize: '11px', color: TEAL }}>✓ Done</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
            <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage === 1}
              style={{ padding: '6px 14px', border: '1.5px solid #E2E8F0', borderRadius: '6px', background: 'white', cursor: 'pointer', fontSize: '12px', color: currentPage === 1 ? '#CBD5E1' : NAVY }}>← Prev</button>
            <span style={{ fontSize: '12px', color: '#64748B' }}>Page {currentPage} of {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage === totalPages}
              style={{ padding: '6px 14px', border: '1.5px solid #E2E8F0', borderRadius: '6px', background: 'white', cursor: 'pointer', fontSize: '12px', color: currentPage === totalPages ? '#CBD5E1' : NAVY }}>Next →</button>
          </div>
        )}
      </div>
    )
  }

  // ── HISTORY TAB ─────────────────────────────────────────────
  function HistoryTab() {
    const paid = contributions.filter(c => ['PAID', 'PRE_PAID'].includes(c.status))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <StatCard label="Total Payments"   value={paid.length}                                         sub="Completed transactions"  color={TEAL}  icon="✅" />
          <StatCard label="Total Collected"  value={`$${paid.reduce((s,c)=>s+c.amountPaid,0).toFixed(2)}`} sub="Sum of all payments"   color={BLUE}  icon="💰" />
          <StatCard label="Pre-Paid"         value={contributions.filter(c=>c.status==='PRE_PAID').length} sub="Security deposits"      color={NAVY}  icon="🔒" />
        </div>

        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: 0 }}>Payment History</h3>
            <button style={{ padding: '6px 14px', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#475569' }}>
              📥 Export CSV
            </button>
          </div>
          {loadingList ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>⏳ Loading...</div>
          ) : paid.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <p style={{ color: '#64748B', fontSize: '13px' }}>No completed payments yet.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Member','Group','Month','Amount Paid','Method','Reference','Paid Date','Type'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#64748B', borderBottom: '1px solid #E2E8F0', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paid.map((c, i) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #F8FAFC', background: i % 2 === 0 ? 'white' : '#FAFAFA' }}>
                    <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '500', color: NAVY }}>{c.memberName}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569' }}>{c.groupName}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569' }}>Month {c.monthNumber}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: TEAL }}>${c.amountPaid.toFixed(2)}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569' }}>
                      {c.paymentMethod ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {c.paymentMethod === 'ECOCASH' ? '📱' : c.paymentMethod === 'BANK_TRANSFER' ? '🏦' : c.paymentMethod === 'CARD' ? '💳' : '💵'}
                          {c.paymentMethod.replace('_', ' ')}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '11px', color: '#94A3B8', fontFamily: 'monospace' }}>{c.paymentRef ? c.paymentRef.slice(0,16) + '...' : '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569', whiteSpace: 'nowrap' }}>
                      {c.paidAt ? new Date(c.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }

  // ── RENDER ──────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {payModal && <PaymentModal contribution={payModal} onClose={() => setPayModal(null)} onSuccess={(msg: string) => { showToast(msg); fetchSummary(); fetchContributions() }} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: NAVY, margin: '0 0 4px' }}>Contributions</h2>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Track, collect and manage all member contributions</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { fetchSummary(); if (tab !== 'dashboard') fetchContributions() }}
            style={{ padding: '8px 14px', background: '#F1F5F9', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: '#475569' }}>
            ↻ Refresh
          </button>
          <button onClick={() => setTab('tracker')}
            style={{ padding: '8px 16px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
            + Record Payment
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid #E2E8F0' }}>
        {[
          { id: 'dashboard', label: '📊 Dashboard' },
          { id: 'tracker',   label: '💳 Contribution Tracker' },
          { id: 'history',   label: '📋 Payment History' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)} style={{
            padding: '10px 20px', background: 'none', border: 'none',
            borderBottom: tab === t.id ? `2px solid ${TEAL}` : '2px solid transparent',
            color: tab === t.id ? TEAL : '#64748B', fontWeight: tab === t.id ? '600' : '400',
            fontSize: '13px', cursor: 'pointer', marginBottom: '-1px',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'tracker'   && <TrackerTab />}
      {tab === 'history'   && <HistoryTab />}
    </div>
  )
}
