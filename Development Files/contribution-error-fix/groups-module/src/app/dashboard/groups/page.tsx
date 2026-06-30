'use client'
import { useState } from 'react'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'
const BLUE = '#1A5EA8'

// ── Sample Data ───────────────────────────────────────────────
const GROUPS = [
  {
    id: '1', name: 'Harare Builders Circle', status: 'ACTIVE',
    currency: 'USD', contribution: 100, members: 10, maxMembers: 10,
    escrow: 600, pool: 1000, strategy: 'SENIORITY',
    admin: 'Group Administrator', country: 'Zimbabwe', region: 'Harare',
    createdAt: '1 Jan 2025', cycle: { number: 1, month: 6, total: 10, status: 'ACTIVE' },
    insurancePool: 90, platformFee: '2%', penaltyRate: '20%',
    description: 'A savings and investment group focused on property and business ventures',
  },
  {
    id: '2', name: 'Bulawayo Savers', status: 'DRAFT',
    currency: 'USD', contribution: 50, members: 6, maxMembers: 10,
    escrow: 0, pool: 300, strategy: 'RANDOM',
    admin: 'System Administrator', country: 'Zimbabwe', region: 'Bulawayo',
    createdAt: '15 May 2025', cycle: null,
    insurancePool: 0, platformFee: '2%', penaltyRate: '20%',
    description: 'New savings group forming in Bulawayo',
  },
  {
    id: '3', name: 'Masvingo Investment Club', status: 'ACTIVE',
    currency: 'ZAR', contribution: 500, members: 8, maxMembers: 12,
    escrow: 2000, pool: 4000, strategy: 'GROUP_VOTE',
    admin: 'Group Administrator', country: 'Zimbabwe', region: 'Masvingo',
    createdAt: '1 Mar 2025', cycle: { number: 2, month: 3, total: 8, status: 'ACTIVE' },
    insurancePool: 300, platformFee: '2%', penaltyRate: '15%',
    description: 'Investment focused group with property and business portfolio',
  },
]

const MEMBERS_DATA: Record<string, any[]> = {
  '1': [
    { name: 'Tariro Moyo',     role: 'MEMBER',      status: 'ACTIVE',    pos: 1,  score: 142, contributed: 600, tier: 'GOLD'     },
    { name: 'Chiedza Mutasa',  role: 'MEMBER',      status: 'ACTIVE',    pos: 6,  score: 118, contributed: 600, tier: 'GOLD'     },
    { name: 'Farai Khumalo',   role: 'MEMBER',      status: 'ACTIVE',    pos: 2,  score: 134, contributed: 600, tier: 'GOLD'     },
    { name: 'Simba Ndlovu',    role: 'MEMBER',      status: 'ACTIVE',    pos: 4,  score: 89,  contributed: 500, tier: 'SILVER'   },
    { name: 'Paidamoyo Mhaka', role: 'MEMBER',      status: 'DEFAULTED', pos: 7,  score: 76,  contributed: 500, tier: 'SILVER'   },
    { name: 'Rudo Zimuto',     role: 'MEMBER',      status: 'ACTIVE',    pos: 3,  score: 156, contributed: 600, tier: 'PLATINUM' },
    { name: 'Kudzi Sithole',   role: 'MEMBER',      status: 'ACTIVE',    pos: 5,  score: 121, contributed: 600, tier: 'GOLD'     },
    { name: 'Nomsa Dube',      role: 'MEMBER',      status: 'ACTIVE',    pos: 8,  score: 98,  contributed: 600, tier: 'SILVER'   },
    { name: 'Muchaneta Choto', role: 'MEMBER',      status: 'ACTIVE',    pos: 9,  score: 103, contributed: 500, tier: 'GOLD'     },
    { name: 'Blessing Mlilo',  role: 'MEMBER',      status: 'ACTIVE',    pos: 10, score: 87,  contributed: 500, tier: 'SILVER'   },
    { name: 'Group Admin',     role: 'GROUP_ADMIN', status: 'ACTIVE',    pos: null, score: 130, contributed: 0, tier: 'GOLD'    },
  ],
}

const CURRENCIES = ['USD','ZAR','ZWG','KES','TZS','UGX']
const STRATEGIES = [
  { value: 'SENIORITY', label: 'Seniority Based', desc: 'Longer members get earlier positions' },
  { value: 'RANDOM',    label: 'Random Draw',     desc: 'Cryptographically random shuffle'    },
  { value: 'GROUP_VOTE',label: 'Group Vote',      desc: 'Members vote on payout order'        },
]

// ── Helpers ───────────────────────────────────────────────────
function statusBadge(status: string) {
  const map: Record<string, [string, string]> = {
    ACTIVE:    ['#DCFCE7', '#166534'],
    DRAFT:     ['#F1F5F9', '#475569'],
    PAUSED:    ['#FEF9C3', '#854D0E'],
    COMPLETED: ['#DBEAFE', '#1E40AF'],
    DISSOLVED: ['#FEE2E2', '#991B1B'],
  }
  const [bg, color] = map[status] || ['#F1F5F9', '#475569']
  return (
    <span style={{ background: bg, color, fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '999px' }}>
      {status}
    </span>
  )
}

function memberStatusBadge(status: string) {
  const map: Record<string, [string, string]> = {
    ACTIVE:    ['#DCFCE7', '#166534'],
    DEFAULTED: ['#FEE2E2', '#991B1B'],
    SUSPENDED: ['#FEF9C3', '#854D0E'],
    EXITED:    ['#F1F5F9', '#475569'],
  }
  const [bg, color] = map[status] || ['#F1F5F9', '#475569']
  return <span style={{ background: bg, color, fontSize: '10px', fontWeight: '600', padding: '2px 7px', borderRadius: '999px' }}>{status}</span>
}

function tierBadge(tier: string) {
  const map: Record<string, [string, string]> = {
    PLATINUM: ['#E9D5FF', '#5B21B6'],
    GOLD:     ['#FEF3C7', '#92400E'],
    SILVER:   ['#F1F5F9', '#475569'],
    BRONZE:   ['#FEE2E2', '#7F1D1D'],
  }
  const [bg, color] = map[tier] || ['#F1F5F9', '#475569']
  return <span style={{ background: bg, color, fontSize: '10px', fontWeight: '600', padding: '2px 6px', borderRadius: '4px' }}>{tier}</span>
}

function roleBadge(role: string) {
  const map: Record<string, [string, string]> = {
    GROUP_ADMIN:       ['#DBEAFE', '#1E40AF'],
    TREASURER:         ['#E9D5FF', '#5B21B6'],
    INVESTMENT_MANAGER:['#FEF3C7', '#92400E'],
    MEMBER:            ['#F1F5F9', '#475569'],
  }
  const [bg, color] = map[role] || ['#F1F5F9', '#475569']
  return <span style={{ background: bg, color, fontSize: '10px', fontWeight: '600', padding: '2px 6px', borderRadius: '4px' }}>{role.replace('_', ' ')}</span>
}

function Input({ label, value, onChange, type = 'text', placeholder = '', required = false, hint = '' }: any) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>
        {label} {required && <span style={{ color: '#DC2626' }}>*</span>}
      </label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        style={{
          width: '100%', padding: '9px 12px',
          border: '1.5px solid #E2E8F0', borderRadius: '8px',
          fontSize: '13px', outline: 'none', boxSizing: 'border-box',
        }}
      />
      {hint && <p style={{ fontSize: '11px', color: '#94A3B8', margin: '4px 0 0' }}>{hint}</p>}
    </div>
  )
}

function Select({ label, value, onChange, options, required = false }: any) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>
        {label} {required && <span style={{ color: '#DC2626' }}>*</span>}
      </label>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '9px 12px',
          border: '1.5px solid #E2E8F0', borderRadius: '8px',
          fontSize: '13px', outline: 'none', background: 'white', boxSizing: 'border-box',
        }}
      >
        {options.map((o: any) => (
          <option key={o.value || o} value={o.value || o}>{o.label || o}</option>
        ))}
      </select>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────
export default function GroupsPage() {
  const [view, setView] = useState<'list' | 'detail' | 'create'>('list')
  const [selectedGroup, setSelectedGroup] = useState<any>(null)
  const [detailTab, setDetailTab] = useState('overview')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showSuccess, setShowSuccess] = useState('')

  // Create group form state
  const [form, setForm] = useState({
    name: '', description: '', currency: 'USD',
    contributionAmount: '', contributionDay: '1',
    contributionFrequency: 'monthly', maxMembers: '10',
    penaltyRate: '20', insurancePoolPct: '1.5',
    payoutStrategy: 'SENIORITY', country: 'Zimbabwe', region: '',
  })

  const filtered = GROUPS.filter(g => {
    const matchSearch = g.name.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'ALL' || g.status === filterStatus
    return matchSearch && matchStatus
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setShowSuccess(`Group "${form.name}" created successfully!`)
    setTimeout(() => {
      setShowSuccess('')
      setView('list')
      setForm({ name: '', description: '', currency: 'USD', contributionAmount: '', contributionDay: '1', contributionFrequency: 'monthly', maxMembers: '10', penaltyRate: '20', insurancePoolPct: '1.5', payoutStrategy: 'SENIORITY', country: 'Zimbabwe', region: '' })
    }, 2000)
  }

  // ── List View ───────────────────────────────────────────────
  if (view === 'list') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: NAVY, margin: '0 0 4px' }}>Groups</h2>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>{GROUPS.length} groups · {GROUPS.filter(g => g.status === 'ACTIVE').length} active</p>
        </div>
        <button onClick={() => setView('create')} style={{
          background: TEAL, color: 'white', border: 'none', borderRadius: '8px',
          padding: '10px 18px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>+ Create Group</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input
          placeholder="Search groups..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 14px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', width: '260px', outline: 'none' }}
        />
        {['ALL', 'ACTIVE', 'DRAFT', 'PAUSED', 'COMPLETED'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{
            padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: '500', cursor: 'pointer',
            background: filterStatus === s ? TEAL : 'white',
            color: filterStatus === s ? 'white' : '#64748B',
            border: filterStatus === s ? 'none' : '1.5px solid #E2E8F0',
          }}>{s}</button>
        ))}
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        {[
          { label: 'Total Groups',    value: GROUPS.length,                              color: TEAL  },
          { label: 'Active Groups',   value: GROUPS.filter(g => g.status === 'ACTIVE').length, color: '#166534' },
          { label: 'Total Members',   value: GROUPS.reduce((s, g) => s + g.members, 0), color: BLUE  },
          { label: 'Total Escrow',    value: `$${GROUPS.reduce((s, g) => s + g.escrow, 0).toLocaleString()}`, color: '#B45309' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '10px', padding: '14px 16px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>{s.label}</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Group cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {filtered.map(g => (
          <div key={g.id} style={{
            background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0',
            overflow: 'hidden', transition: 'box-shadow 0.2s',
          }}>
            {/* Card header */}
            <div style={{ background: g.status === 'ACTIVE' ? 'linear-gradient(135deg, #0D2137, #0F6E56)' : '#F8FAFC', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.15)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: '20px',
                }}>👥</div>
                {statusBadge(g.status)}
              </div>
              <h3 style={{ fontSize: '15px', fontWeight: '700', color: g.status === 'ACTIVE' ? 'white' : NAVY, margin: '0 0 2px' }}>{g.name}</h3>
              <p style={{ fontSize: '11px', color: g.status === 'ACTIVE' ? '#9FE1CB' : '#94A3B8', margin: 0 }}>{g.region}, {g.country}</p>
            </div>

            {/* Card body */}
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                {[
                  { label: 'Monthly Pool',  value: `${g.currency === 'USD' ? '$' : g.currency}${g.pool.toLocaleString()}` },
                  { label: 'Contribution',  value: `${g.currency === 'USD' ? '$' : g.currency}${g.contribution}/mo`       },
                  { label: 'Members',       value: `${g.members}/${g.maxMembers}`                                         },
                  { label: 'Escrow',        value: `${g.currency === 'USD' ? '$' : g.currency}${g.escrow.toLocaleString()}` },
                ].map(item => (
                  <div key={item.label} style={{ background: '#F8FAFC', borderRadius: '6px', padding: '8px 10px' }}>
                    <div style={{ fontSize: '10px', color: '#94A3B8' }}>{item.label}</div>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: NAVY }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Cycle progress */}
              {g.cycle && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>
                    <span>Cycle {g.cycle.number} · Month {g.cycle.month}/{g.cycle.total}</span>
                    <span>{Math.round(g.cycle.month / g.cycle.total * 100)}%</span>
                  </div>
                  <div style={{ height: '6px', background: '#F1F5F9', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: '3px', background: TEAL, width: `${g.cycle.month / g.cycle.total * 100}%` }} />
                  </div>
                </div>
              )}

              {/* Strategy badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '11px', color: '#64748B' }}>
                  Strategy: <strong>{g.strategy.replace('_', ' ')}</strong>
                </span>
                <span style={{ fontSize: '11px', color: '#64748B' }}>{g.currency}</span>
              </div>

              <button
                onClick={() => { setSelectedGroup(g); setView('detail'); setDetailTab('overview') }}
                style={{
                  width: '100%', padding: '8px', background: '#F8FAFC',
                  border: '1.5px solid #E2E8F0', borderRadius: '8px',
                  fontSize: '12px', fontWeight: '500', cursor: 'pointer', color: NAVY,
                }}
              >View Details →</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  // ── Create Group View ───────────────────────────────────────
  if (view === 'create') return (
    <div style={{ maxWidth: '720px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <button onClick={() => setView('list')} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', color: '#475569' }}>← Back</button>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: NAVY, margin: '0 0 2px' }}>Create New Group</h2>
          <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>Set up a new stokvel savings group</p>
        </div>
      </div>

      {showSuccess && (
        <div style={{ background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: '10px', padding: '14px 18px', marginBottom: '20px', color: '#166534', fontWeight: '500', fontSize: '14px' }}>
          ✅ {showSuccess}
        </div>
      )}

      <form onSubmit={handleCreate}>
        {/* Section 1: Basic Info */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 16px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>
            📋 Basic Information
          </h3>
          <Input label="Group Name" value={form.name} onChange={(v: string) => setForm(f => ({ ...f, name: v }))} placeholder="e.g. Harare Builders Circle" required />
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What is this group about?"
              rows={3}
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Input label="Country" value={form.country} onChange={(v: string) => setForm(f => ({ ...f, country: v }))} placeholder="Zimbabwe" />
            <Input label="Region / City" value={form.region} onChange={(v: string) => setForm(f => ({ ...f, region: v }))} placeholder="Harare" />
          </div>
        </div>

        {/* Section 2: Financial */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 16px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>
            💰 Financial Settings
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Select label="Currency" value={form.currency} onChange={(v: string) => setForm(f => ({ ...f, currency: v }))} options={CURRENCIES} required />
            <Input label="Monthly Contribution" value={form.contributionAmount} onChange={(v: string) => setForm(f => ({ ...f, contributionAmount: v }))} type="number" placeholder="100" required hint="Amount each member contributes per cycle" />
            <Select label="Contribution Frequency" value={form.contributionFrequency} onChange={(v: string) => setForm(f => ({ ...f, contributionFrequency: v }))} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Bi-Weekly' }]} />
            <Input label="Collection Day (1-28)" value={form.contributionDay} onChange={(v: string) => setForm(f => ({ ...f, contributionDay: v }))} type="number" placeholder="1" hint="Day of month contributions are collected" />
            <Input label="Max Members" value={form.maxMembers} onChange={(v: string) => setForm(f => ({ ...f, maxMembers: v }))} type="number" placeholder="10" />
            <Input label="Penalty Rate (%)" value={form.penaltyRate} onChange={(v: string) => setForm(f => ({ ...f, penaltyRate: v }))} type="number" placeholder="20" hint="% charged on defaults" />
            <Input label="Insurance Pool (%)" value={form.insurancePoolPct} onChange={(v: string) => setForm(f => ({ ...f, insurancePoolPct: v }))} type="number" placeholder="1.5" hint="% deducted per contribution for insurance" />
          </div>

          {/* Live calculation */}
          {form.contributionAmount && form.maxMembers && (
            <div style={{ background: '#F0FDF4', borderRadius: '8px', padding: '12px 16px', border: '1px solid #BBF7D0', marginTop: '4px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#166534', marginBottom: '6px' }}>📊 Pool Preview</div>
              <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#166534' }}>
                <span>Monthly pool: <strong>{form.currency === 'USD' ? '$' : form.currency}{(parseFloat(form.contributionAmount || '0') * parseInt(form.maxMembers || '0')).toLocaleString()}</strong></span>
                <span>Insurance: <strong>{form.currency === 'USD' ? '$' : form.currency}{(parseFloat(form.contributionAmount || '0') * parseInt(form.maxMembers || '0') * parseFloat(form.insurancePoolPct || '0') / 100).toFixed(2)}/mo</strong></span>
                <span>Platform fee: <strong>{form.currency === 'USD' ? '$' : form.currency}{(parseFloat(form.contributionAmount || '0') * parseInt(form.maxMembers || '0') * 0.02).toFixed(2)}/payout</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Payout Strategy */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 16px', paddingBottom: '10px', borderBottom: '1px solid #F1F5F9' }}>
            🔄 Payout Strategy
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {STRATEGIES.map(s => (
              <div
                key={s.value}
                onClick={() => setForm(f => ({ ...f, payoutStrategy: s.value }))}
                style={{
                  padding: '14px 16px', borderRadius: '8px', cursor: 'pointer',
                  border: `2px solid ${form.payoutStrategy === s.value ? TEAL : '#E2E8F0'}`,
                  background: form.payoutStrategy === s.value ? '#F0FDF4' : 'white',
                  display: 'flex', alignItems: 'center', gap: '12px',
                }}
              >
                <div style={{
                  width: '18px', height: '18px', borderRadius: '50%',
                  border: `2px solid ${form.payoutStrategy === s.value ? TEAL : '#CBD5E1'}`,
                  background: form.payoutStrategy === s.value ? TEAL : 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {form.payoutStrategy === s.value && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'white' }} />}
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: NAVY }}>{s.label}</div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={() => setView('list')} style={{ padding: '11px 24px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', color: '#475569', fontWeight: '500' }}>Cancel</button>
          <button type="submit" style={{ flex: 1, padding: '11px', background: `linear-gradient(135deg, ${NAVY}, ${TEAL})`, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            ✓ Create Group
          </button>
        </div>
      </form>
    </div>
  )

  // ── Detail View ─────────────────────────────────────────────
  const g = selectedGroup
  const members = MEMBERS_DATA[g?.id] || []
  const TABS = ['overview', 'members', 'cycle', 'settings']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={() => setView('list')} style={{ background: '#F1F5F9', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', color: '#475569' }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: NAVY, margin: 0 }}>{g.name}</h2>
            {statusBadge(g.status)}
          </div>
          <p style={{ fontSize: '12px', color: '#64748B', margin: '2px 0 0' }}>{g.region}, {g.country} · {g.currency} · {g.strategy.replace('_', ' ')}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowInviteModal(true)} style={{ padding: '8px 14px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>+ Invite Member</button>
          <button style={{ padding: '8px 14px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: '#475569' }}>⚙ Settings</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid #E2E8F0' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setDetailTab(t)} style={{
            padding: '10px 18px', background: 'none', border: 'none',
            borderBottom: detailTab === t ? `2px solid ${TEAL}` : '2px solid transparent',
            color: detailTab === t ? TEAL : '#64748B', fontWeight: detailTab === t ? '600' : '400',
            fontSize: '13px', cursor: 'pointer', textTransform: 'capitalize', marginBottom: '-1px',
          }}>{t}</button>
        ))}
      </div>

      {/* Overview Tab */}
      {detailTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {[
              { label: 'Monthly Pool',    value: `$${g.pool.toLocaleString()}`,    color: TEAL    },
              { label: 'Escrow Balance',  value: `$${g.escrow.toLocaleString()}`,  color: BLUE    },
              { label: 'Members',         value: `${g.members}/${g.maxMembers}`,   color: NAVY    },
              { label: 'Insurance Pool',  value: `$${g.insurancePool}`,            color: '#B45309' },
            ].map(s => (
              <div key={s.label} style={{ background: 'white', borderRadius: '10px', padding: '16px', border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>{s.label}</div>
                <div style={{ fontSize: '22px', fontWeight: '700', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px' }}>
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid #E2E8F0' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px' }}>Group Details</h3>
              {[
                ['Description', g.description],
                ['Admin', g.admin],
                ['Contribution', `$${g.contribution}/month`],
                ['Collection Day', `${g.contributionDay || 1}${['st','nd','rd','th'][(g.contributionDay||1)-1]||'th'} of each month`],
                ['Payout Strategy', g.strategy.replace('_', ' ')],
                ['Penalty Rate', g.penaltyRate],
                ['Platform Fee', g.platformFee],
                ['Created', g.createdAt],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F8FAFC', fontSize: '13px' }}>
                  <span style={{ color: '#64748B' }}>{label}</span>
                  <span style={{ color: NAVY, fontWeight: '500', maxWidth: '60%', textAlign: 'right' }}>{value}</span>
                </div>
              ))}
            </div>

            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid #E2E8F0' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px' }}>
                {g.cycle ? `Cycle ${g.cycle.number} Progress` : 'No Active Cycle'}
              </h3>
              {g.cycle ? (
                <>
                  <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                    <div style={{ fontSize: '36px', fontWeight: '700', color: TEAL }}>
                      {Math.round(g.cycle.month / g.cycle.total * 100)}%
                    </div>
                    <div style={{ fontSize: '13px', color: '#64748B' }}>Month {g.cycle.month} of {g.cycle.total}</div>
                  </div>
                  <div style={{ height: '10px', background: '#F1F5F9', borderRadius: '5px', overflow: 'hidden', marginBottom: '16px' }}>
                    <div style={{ height: '100%', background: `linear-gradient(90deg, ${TEAL}, #1D9E75)`, borderRadius: '5px', width: `${g.cycle.month / g.cycle.total * 100}%`, transition: 'width 0.5s' }} />
                  </div>
                  {[
                    ['Payouts Done',     g.cycle.month],
                    ['Payouts Remaining', g.cycle.total - g.cycle.month],
                    ['Pool per Payout',  `$${g.pool.toLocaleString()}`],
                    ['Total Cycle Value', `$${(g.pool * g.cycle.total).toLocaleString()}`],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '13px' }}>
                      <span style={{ color: '#64748B' }}>{label}</span>
                      <span style={{ fontWeight: '600', color: NAVY }}>{value}</span>
                    </div>
                  ))}
                  <button style={{
                    marginTop: '12px', width: '100%', padding: '9px',
                    background: '#F0FDF4', border: '1px solid #86EFAC',
                    borderRadius: '8px', color: '#166534', fontSize: '12px',
                    fontWeight: '600', cursor: 'pointer',
                  }}>View Full Schedule →</button>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: '36px', marginBottom: '8px' }}>🔄</div>
                  <p style={{ color: '#64748B', fontSize: '13px', marginBottom: '16px' }}>No cycle started yet</p>
                  <button style={{
                    padding: '10px 20px', background: TEAL, color: 'white',
                    border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', fontWeight: '500',
                  }}>Start First Cycle</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Members Tab */}
      {detailTab === 'members' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
              {members.length} members · {members.filter(m => m.status === 'ACTIVE').length} active
            </p>
            <button onClick={() => setShowInviteModal(true)} style={{
              background: TEAL, color: 'white', border: 'none', borderRadius: '8px',
              padding: '8px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: '500',
            }}>+ Invite Member</button>
          </div>

          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Member', 'Role', 'Pos', 'Tier', 'Score', 'Status', 'Contributed', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#64748B', borderBottom: '1px solid #E2E8F0', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={m.name} style={{ borderBottom: '1px solid #F8FAFC', background: m.status === 'DEFAULTED' ? '#FFF5F5' : i % 2 === 0 ? 'white' : '#FAFAFA' }}>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#E1F5EE', color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '700', flexShrink: 0 }}>
                          {m.name.split(' ').map((n: string) => n[0]).join('')}
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: '500', color: NAVY }}>{m.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '11px 14px' }}>{roleBadge(m.role)}</td>
                    <td style={{ padding: '11px 14px', fontSize: '13px', color: '#64748B' }}>{m.pos ? `#${m.pos}` : '—'}</td>
                    <td style={{ padding: '11px 14px' }}>{tierBadge(m.tier)}</td>
                    <td style={{ padding: '11px 14px', fontSize: '13px', fontWeight: '600', color: TEAL }}>{m.score}</td>
                    <td style={{ padding: '11px 14px' }}>{memberStatusBadge(m.status)}</td>
                    <td style={{ padding: '11px 14px', fontSize: '13px', color: '#374151' }}>${m.contributed.toLocaleString()}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button style={{ padding: '3px 8px', background: '#F1F5F9', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', color: '#475569' }}>View</button>
                        {m.status === 'ACTIVE' && m.role !== 'GROUP_ADMIN' && (
                          <button style={{ padding: '3px 8px', background: '#FEF9C3', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', color: '#854D0E' }}>Suspend</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cycle Tab */}
      {detailTab === 'cycle' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {g.cycle ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {[
                  { label: 'Cycle Number',    value: `#${g.cycle.number}`,         color: TEAL  },
                  { label: 'Current Month',   value: `${g.cycle.month} of ${g.cycle.total}`, color: BLUE  },
                  { label: 'Cycle Status',    value: g.cycle.status,               color: '#166534' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'white', borderRadius: '10px', padding: '16px', border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>{s.label}</div>
                    <div style={{ fontSize: '20px', fontWeight: '700', color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: 0 }}>Payout Schedule</h3>
                  <span style={{ fontSize: '12px', color: '#64748B' }}>Locked · Immutable</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      {['Month', 'Recipient', 'Amount', 'Date', 'Status'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#64748B', borderBottom: '1px solid #E2E8F0', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.filter(m => m.pos).sort((a, b) => a.pos - b.pos).map((m, i) => {
                      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct']
                      const isCurrent = i + 1 === g.cycle.month
                      const isDone = i + 1 < g.cycle.month
                      return (
                        <tr key={m.name} style={{ borderBottom: '1px solid #F8FAFC', background: isCurrent ? '#F0FDF4' : 'white' }}>
                          <td style={{ padding: '10px 16px', fontSize: '13px', color: '#64748B' }}>{monthNames[i]} 2025</td>
                          <td style={{ padding: '10px 16px', fontSize: '13px', fontWeight: isCurrent ? '600' : '400', color: isCurrent ? TEAL : NAVY }}>{m.name}</td>
                          <td style={{ padding: '10px 16px', fontSize: '13px', fontWeight: '600', color: NAVY }}>${g.pool.toLocaleString()}</td>
                          <td style={{ padding: '10px 16px', fontSize: '12px', color: '#64748B' }}>{i + 1} {monthNames[i]} 2025</td>
                          <td style={{ padding: '10px 16px' }}>
                            <span style={{
                              fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '999px',
                              background: isDone ? '#DCFCE7' : isCurrent ? '#BBF7D0' : '#F1F5F9',
                              color: isDone ? '#166534' : isCurrent ? '#166534' : '#64748B',
                            }}>
                              {isDone ? '✓ Done' : isCurrent ? '⚡ Current' : '⏳ Scheduled'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔄</div>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: NAVY, margin: '0 0 8px' }}>No Cycle Started</h3>
              <p style={{ color: '#64748B', fontSize: '13px', marginBottom: '20px' }}>Start the first cycle to assign payout positions and begin collecting contributions.</p>
              <button style={{ padding: '11px 24px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                🚀 Start Cycle 1
              </button>
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {detailTab === 'settings' && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '24px', maxWidth: '560px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 20px' }}>Group Settings</h3>
          <Input label="Group Name" value={g.name} onChange={() => {}} />
          <Input label="Description" value={g.description} onChange={() => {}} />
          <Select label="Payout Strategy" value={g.strategy} onChange={() => {}} options={STRATEGIES} />
          <Input label="Penalty Rate (%)" value={g.penaltyRate.replace('%', '')} onChange={() => {}} type="number" />
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button style={{ flex: 1, padding: '10px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Save Changes</button>
            <button style={{ padding: '10px 16px', background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Pause Group</button>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '420px', boxShadow: '0 25px 50px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: NAVY, margin: '0 0 6px' }}>Invite Member</h3>
            <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 20px' }}>Send an invitation to join {g.name}</p>
            <Input label="Email Address" value="" onChange={() => {}} placeholder="member@example.com" type="email" />
            <Input label="Phone Number" value="" onChange={() => {}} placeholder="+263 77 xxx xxxx" />
            <Select label="Role" value="MEMBER" onChange={() => {}} options={[
              { value: 'MEMBER', label: 'Member' },
              { value: 'TREASURER', label: 'Treasurer' },
              { value: 'INVESTMENT_MANAGER', label: 'Investment Manager' },
            ]} />
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button onClick={() => setShowInviteModal(false)} style={{ flex: 1, padding: '10px', background: '#F1F5F9', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#475569' }}>Cancel</button>
              <button onClick={() => { setShowInviteModal(false); setShowSuccess('Invitation sent successfully!'); setTimeout(() => setShowSuccess(''), 3000) }} style={{ flex: 1, padding: '10px', background: TEAL, color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Send Invite</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
