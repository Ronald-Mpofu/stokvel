'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import GroupsPage from './groups/page'
import ContributionsPage from './contributions/page'
import AssetsPage from './assets/AssetsPage'
import SuppliersPage from './suppliers/page'
import MembershipPoolPage from './membership/page'
import NotificationsPage from './notifications/page'
import LoansPage from './loans/LoansPage'
import PropertyPage from './property/PropertyPage'
import SavingsPage from './savings/SavingsPage'
import NotificationBell from './notifications/NotificationBell'
import GroceryClubPanel from './grocery/GroceryClubPanel'

const TEAL = '#0F6E56'
const NAVY = '#0D2137'

const NAV_ITEMS = [
  { id: 'overview',      icon: '📊', label: 'Overview'        },
  { id: 'groups',        icon: '👥', label: 'Groups'          },
  { id: 'membership',    icon: '🏦', label: 'Membership Pool' },
  { id: 'notifications', icon: '🔔', label: 'Notifications'   },
  { id: 'portal',        icon: '👤', label: 'Member Portal'   },
  { id: 'settings',      icon: '⚙️',  label: 'Settings'       },
]

// ── Bottom nav items (mobile — show most important 5) ──────────
const BOTTOM_NAV = [
  { id: 'overview',      icon: '📊', label: 'Home'     },
  { id: 'groups',        icon: '👥', label: 'Groups'   },
  { id: 'membership',    icon: '🏦', label: 'Pool'     },
  { id: 'notifications', icon: '🔔', label: 'Alerts'   },
  { id: 'menu',          icon: '☰',  label: 'More'     },
]

const STATS = [
  { label: 'Active Groups',         value: '1',      sub: 'Harare Builders Circle', color: TEAL       },
  { label: 'Total Members',         value: '12',     sub: '10 active this cycle',   color: '#1A5EA8'  },
  { label: 'Escrow Balance',        value: '$600',   sub: 'Held securely',          color: '#B45309'  },
  { label: 'Monthly Pool',          value: '$1,000', sub: '10 members × $100',      color: '#7C3AED'  },
  { label: 'Payouts Completed',     value: '6',      sub: '4 remaining this cycle', color: TEAL       },
  { label: 'Community Deals Revenue', value: '$120', sub: '2% fee this month',      color: '#059669'  },
  { label: 'Active Loans',          value: '0',      sub: 'No active loans',        color: '#DC2626'  },
  { label: 'Insurance Pool',        value: '$90',    sub: '1.5% reserve',           color: '#B45309'  },
]

const MEMBERS = [
  { name: 'Tariro Moyo',     pos: 1,  status: 'PAID',     score: 142, tier: 'GOLD'     },
  { name: 'Chiedza Mutasa',  pos: 6,  status: 'RECEIVED', score: 118, tier: 'GOLD'     },
  { name: 'Farai Khumalo',   pos: 2,  status: 'PAID',     score: 134, tier: 'GOLD'     },
  { name: 'Simba Ndlovu',    pos: 4,  status: 'DUE',      score: 89,  tier: 'SILVER'   },
  { name: 'Paidamoyo Mhaka', pos: 7,  status: 'LATE',     score: 76,  tier: 'SILVER'   },
  { name: 'Rudo Zimuto',     pos: 3,  status: 'PAID',     score: 156, tier: 'PLATINUM' },
  { name: 'Kudzi Sithole',   pos: 5,  status: 'PAID',     score: 121, tier: 'GOLD'     },
  { name: 'Nomsa Dube',      pos: 8,  status: 'PAID',     score: 98,  tier: 'SILVER'   },
  { name: 'Muchaneta Choto', pos: 9,  status: 'PENDING',  score: 103, tier: 'GOLD'     },
  { name: 'Blessing Mlilo',  pos: 10, status: 'PENDING',  score: 87,  tier: 'SILVER'   },
]

const PAYOUT_SCHEDULE = [
  { month: 'Jan', name: 'Tariro Moyo',     status: 'DONE',    amount: '$1,000' },
  { month: 'Feb', name: 'Farai Khumalo',   status: 'DONE',    amount: '$1,000' },
  { month: 'Mar', name: 'Rudo Zimuto',     status: 'DONE',    amount: '$1,000' },
  { month: 'Apr', name: 'Simba Ndlovu',    status: 'DONE',    amount: '$1,000' },
  { month: 'May', name: 'Kudzi Sithole',   status: 'DONE',    amount: '$1,000' },
  { month: 'Jun', name: 'Chiedza Mutasa',  status: 'CURRENT', amount: '$1,000' },
  { month: 'Jul', name: 'Paidamoyo Mhaka', status: 'NEXT',   amount: '$1,000' },
  { month: 'Aug', name: 'Nomsa Dube',      status: 'FUTURE',  amount: '$1,000' },
  { month: 'Sep', name: 'Muchaneta Choto', status: 'FUTURE',  amount: '$1,000' },
  { month: 'Oct', name: 'Blessing Mlilo',  status: 'FUTURE',  amount: '$1,000' },
]

// ── Hook: detect screen width ─────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isMobile
}

function statusPill(status: string) {
  const map: Record<string, [string, string]> = {
    PAID:     ['#DCFCE7', '#166534'],
    RECEIVED: ['#DBEAFE', '#1E40AF'],
    DUE:      ['#FEF9C3', '#854D0E'],
    LATE:     ['#FEE2E2', '#991B1B'],
    PENDING:  ['#F1F5F9', '#475569'],
  }
  const [bg, color] = map[status] || ['#F1F5F9', '#475569']
  return (
    <span style={{ background: bg, color, fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '999px' }}>
      {status}
    </span>
  )
}

function tierBadge(tier: string) {
  const map: Record<string, [string, string]> = {
    PLATINUM: ['#E9D5FF', '#5B21B6'],
    GOLD:     ['#FEF3C7', '#92400E'],
    SILVER:   ['#F1F5F9', '#475569'],
    BRONZE:   ['#FEE2E2', '#7F1D1D'],
  }
  const [bg, color] = map[tier] || ['#F1F5F9', '#475569']
  return (
    <span style={{ background: bg, color, fontSize: '10px', fontWeight: '600', padding: '2px 6px', borderRadius: '4px' }}>
      {tier}
    </span>
  )
}

// ── Main Dashboard ────────────────────────────────────────────
export default function Dashboard() {
  const router   = useRouter()
  const isMobile = useIsMobile()
  const [active, setActive]         = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [user, setUser] = useState<any>({ id: '', name: 'Administrator', role: 'SYSTEM_ADMIN' })

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.success && d.data) setUser({ id: d.data.id, name: d.data.fullName, role: d.data.role })
    }).catch(() => {})
  }, [])

  // Close mobile menu when navigating
  function navigate(id: string) {
    setActive(id)
    setMobileMenuOpen(false)
  }

  function handleLogout() {
    document.cookie = 'access_token=; Max-Age=0; path=/'
    document.cookie = 'refresh_token=; Max-Age=0; path=/'
    router.push('/login')
  }

  const initials = user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)
  const activeItem = NAV_ITEMS.find(n => n.id === active) || { icon: '📊', label: 'Overview' }

  // ── MOBILE LAYOUT ─────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#F8FAFC' }}>

        {/* Mobile topbar */}
        <div style={{
          background: NAVY, padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, zIndex: 50,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', background: TEAL, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>🔄</div>
            <div>
              <div style={{ color: 'white', fontSize: '13px', fontWeight: '700', lineHeight: 1.2 }}>Windfall</div>
              <div style={{ color: '#9FE1CB', fontSize: '10px' }}>Community Deals</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ background: '#DCFCE7', color: '#166534', fontSize: '10px', padding: '2px 8px', borderRadius: '999px', fontWeight: '600' }}>● Live</span>
            <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '11px', fontWeight: '700' }}>{initials}</div>
          </div>
        </div>

        {/* Mobile page title bar */}
        <div style={{
          background: 'white', padding: '10px 16px',
          borderBottom: '1px solid #E2E8F0', flexShrink: 0,
        }}>
          <h1 style={{ fontSize: '15px', fontWeight: '700', color: NAVY, margin: 0 }}>
            {activeItem.icon} {activeItem.label}
          </h1>
        </div>

        {/* Mobile drawer overlay */}
        {mobileMenuOpen && (
          <>
            {/* Backdrop */}
            <div
              onClick={() => setMobileMenuOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }}
            />
            {/* Drawer */}
            <div style={{
              position: 'fixed', top: 0, left: 0, bottom: 0, width: '260px',
              background: NAVY, zIndex: 101, display: 'flex', flexDirection: 'column',
              boxShadow: '4px 0 24px rgba(0,0,0,0.3)',
            }}>
              {/* Drawer header */}
              <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', background: TEAL, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🔄</div>
                  <div>
                    <div style={{ color: 'white', fontSize: '13px', fontWeight: '700' }}>Windfall</div>
                    <div style={{ color: '#9FE1CB', fontSize: '10px' }}>Community Deals</div>
                  </div>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} style={{ background: 'none', border: 'none', color: '#9CA3AF', fontSize: '22px', cursor: 'pointer', padding: '4px' }}>✕</button>
              </div>

              {/* All nav items */}
              <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
                {NAV_ITEMS.map(item => (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '13px 16px',
                      background: active === item.id ? 'rgba(255,255,255,0.1)' : 'none',
                      border: 'none',
                      borderLeft: active === item.id ? `3px solid ${TEAL}` : '3px solid transparent',
                      color: active === item.id ? 'white' : '#94A3B8',
                      cursor: 'pointer', fontSize: '14px', textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>{item.icon}</span>
                    <span style={{ fontWeight: active === item.id ? '600' : '400' }}>{item.label}</span>
                  </button>
                ))}
              </nav>

              {/* Drawer user + logout */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: '600', flexShrink: 0 }}>{initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'white', fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
                  <div style={{ color: '#9CA3AF', fontSize: '10px' }}>{user.role.replace('_', ' ')}</div>
                </div>
                <button onClick={handleLogout} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: '14px', padding: '6px 10px', borderRadius: '6px' }}>
                  ↩ Logout
                </button>
              </div>
            </div>
          </>
        )}

        {/* Page content — scrollable */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px', paddingBottom: '80px' }}>
          {active === 'overview'      && <OverviewPage />}
          {active === 'groups'        && <GroupsPage />}
          {active === 'contributions' && <ContributionsPage />}
          {active === 'assets'        && <AssetsPage />}
          {active === 'suppliers'     && <SuppliersPage />}
          {active === 'membership'    && <MembershipPoolPage />}
          {active === 'notifications' && <NotificationsPage />}
          {active === 'loans'         && <LoansPage />}
          {active === 'property'      && <PropertyPage />}
          {active === 'savings'       && <SavingsPage />}
          {active === 'members'       && <MembersPage />}
          {active === 'payouts'       && <PayoutsPage />}
          {active === 'portal' && (
            <div style={{ textAlign: 'center', padding: '48px 24px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>👤</div>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: NAVY, margin: '0 0 10px' }}>Member Portal</h2>
              <p style={{ fontSize: '14px', color: '#64748B', marginBottom: '24px' }}>
                The Member Portal is a separate view designed for group members. Opens in a new tab.
              </p>
              <a href="/portal" target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-block', padding: '12px 28px', background: `linear-gradient(135deg,${NAVY},${TEAL})`, color: 'white', textDecoration: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600' }}>
                🚀 Open Member Portal →
              </a>
            </div>
          )}
          {active !== 'overview' && active !== 'members' && active !== 'payouts' &&
           active !== 'groups' && active !== 'contributions' && active !== 'assets' &&
           active !== 'suppliers' && active !== 'membership' && active !== 'notifications' &&
           active !== 'loans' && active !== 'property' && active !== 'savings' &&
           active !== 'portal' && (
            <ComingSoon page={NAV_ITEMS.find(n => n.id === active)?.label || ''} />
          )}
        </div>

        {/* ── Bottom navigation bar ──────────────────────────── */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'white', borderTop: '1px solid #E2E8F0',
          display: 'flex', zIndex: 50,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {BOTTOM_NAV.map(item => {
            const isActive = item.id === 'menu' ? mobileMenuOpen : active === item.id
            return (
              <button
                key={item.id}
                onClick={() => item.id === 'menu' ? setMobileMenuOpen(true) : navigate(item.id)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '8px 4px', background: 'none', border: 'none', cursor: 'pointer',
                  color: isActive ? TEAL : '#94A3B8',
                  borderTop: isActive ? `2px solid ${TEAL}` : '2px solid transparent',
                  gap: '2px',
                }}
              >
                <span style={{ fontSize: '20px' }}>{item.icon}</span>
                <span style={{ fontSize: '9px', fontWeight: isActive ? '700' : '400' }}>{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── DESKTOP LAYOUT (unchanged) ────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#F8FAFC' }}>

      {/* Sidebar */}
      <div style={{
        width: sidebarOpen ? '220px' : '60px',
        background: NAVY,
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.2s',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        {/* Brand */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', background: TEAL, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>🔄</div>
          {sidebarOpen && (
            <div>
              <div style={{ color: 'white', fontSize: '13px', fontWeight: '700' }}>Windfall</div>
              <div style={{ color: '#9FE1CB', fontSize: '10px' }}>Community Deals</div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: '18px', flexShrink: 0 }}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 16px',
                background: active === item.id ? 'rgba(255,255,255,0.1)' : 'none',
                border: 'none',
                borderLeft: active === item.id ? `3px solid ${TEAL}` : '3px solid transparent',
                color: active === item.id ? 'white' : '#94A3B8',
                cursor: 'pointer', fontSize: '13px', textAlign: 'left', transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: '16px', flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && <span style={{ fontWeight: active === item.id ? '500' : '400' }}>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: '600', flexShrink: 0 }}>{initials}</div>
          {sidebarOpen && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'white', fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
                <div style={{ color: '#9CA3AF', fontSize: '10px' }}>{user.role.replace('_', ' ')}</div>
              </div>
              <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: '16px' }} title="Logout">↩</button>
            </>
          )}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Topbar */}
        <div style={{ background: 'white', padding: '14px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: '600', color: NAVY, margin: 0 }}>
              {activeItem.icon} {activeItem.label}
            </h1>
            <p style={{ fontSize: '12px', color: '#64748B', margin: '2px 0 0' }}>Windfall Community Deals · Admin Dashboard</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ background: '#DCFCE7', color: '#166534', fontSize: '12px', padding: '4px 10px', borderRadius: '999px', fontWeight: '500' }}>● Live</span>
            <span style={{ fontSize: '12px', color: '#64748B' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          {active === 'overview'      && <OverviewPage />}
          {active === 'groups'        && <GroupsPage />}
          {active === 'contributions' && <ContributionsPage />}
          {active === 'assets'        && <AssetsPage />}
          {active === 'suppliers'     && <SuppliersPage />}
          {active === 'membership'    && <MembershipPoolPage />}
          {active === 'notifications' && <NotificationsPage />}
          {active === 'loans'         && <LoansPage />}
          {active === 'property'      && <PropertyPage />}
          {active === 'savings'       && <SavingsPage />}
          {active === 'members'       && <MembersPage />}
          {active === 'payouts'       && <PayoutsPage />}
          {active === 'portal' && (
            <div style={{ textAlign: 'center', padding: '60px 40px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>👤</div>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: NAVY, margin: '0 0 10px' }}>Member Portal</h2>
              <p style={{ fontSize: '14px', color: '#64748B', marginBottom: '24px', maxWidth: '420px', margin: '0 auto 24px' }}>
                The Member Portal is a separate view designed for group members (non-admins). It shows their contributions, payout position, asset stakes, documents, and profile.
              </p>
              <a href="/portal" target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-block', padding: '12px 28px', background: `linear-gradient(135deg,${NAVY},${TEAL})`, color: 'white', textDecoration: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600' }}>
                🚀 Open Member Portal →
              </a>
              <p style={{ fontSize: '12px', color: '#94A3B8', marginTop: '16px' }}>Opens in a new tab · Members access this directly via invitation</p>
            </div>
          )}
          {active !== 'overview' && active !== 'members' && active !== 'payouts' &&
           active !== 'groups' && active !== 'contributions' && active !== 'assets' &&
           active !== 'suppliers' && active !== 'membership' && active !== 'notifications' &&
           active !== 'loans' && active !== 'property' && active !== 'savings' &&
           active !== 'portal' && (
            <ComingSoon page={NAV_ITEMS.find(n => n.id === active)?.label || ''} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Overview Page ─────────────────────────────────────────────
function OverviewPage() {
  const isMobile = useIsMobile()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '14px' : '20px' }}>

      {/* Stats grid — 2 cols on mobile, 4 on desktop */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: isMobile ? '10px' : '12px' }}>
        {STATS.map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: isMobile ? '12px' : '16px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>{s.label}</div>
            <div style={{ fontSize: isMobile ? '20px' : '24px', fontWeight: '700', color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '3px' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Two column on desktop, stacked on mobile */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr', gap: '16px' }}>

        {/* Payout schedule */}
        <div style={{ background: 'white', borderRadius: '12px', padding: isMobile ? '14px' : '20px', border: '1px solid #E2E8F0' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px' }}>📅 Payout Schedule — Cycle 1</h3>
          {PAYOUT_SCHEDULE.map(p => (
            <div key={p.month} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '11px', color: '#94A3B8', width: '28px', flexShrink: 0 }}>{p.month}</span>
              <span style={{ fontSize: '12px', color: p.status === 'CURRENT' ? TEAL : '#374151', fontWeight: p.status === 'CURRENT' ? '600' : '400', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <div style={{ width: isMobile ? '40px' : '80px', height: '6px', background: '#F1F5F9', borderRadius: '3px', overflow: 'hidden', flexShrink: 0 }}>
                <div style={{ height: '100%', borderRadius: '3px', width: p.status === 'DONE' ? '100%' : p.status === 'CURRENT' ? '60%' : '0%', background: p.status === 'DONE' ? '#9FE1CB' : p.status === 'CURRENT' ? TEAL : 'transparent' }} />
              </div>
              <span style={{ fontSize: '11px', color: p.status === 'DONE' ? TEAL : p.status === 'CURRENT' ? TEAL : '#94A3B8', width: '36px', textAlign: 'right', flexShrink: 0 }}>
                {p.status === 'DONE' ? '✓' : p.status === 'CURRENT' ? 'Live' : p.amount}
              </span>
            </div>
          ))}
        </div>

        {/* Recent Activity */}
        <div style={{ background: 'white', borderRadius: '12px', padding: isMobile ? '14px' : '20px', border: '1px solid #E2E8F0' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px' }}>⚡ Recent Activity</h3>
          {[
            { icon: '✅', text: 'Payout $1,000 released to C. Mutasa',          time: '2 min ago',  color: '#DCFCE7' },
            { icon: '💳', text: 'Pre-escrow $200 collected from C. Mutasa',      time: '2 min ago',  color: '#DBEAFE' },
            { icon: '⚠️', text: 'P. Mhaka payment retry #2 failed',              time: '1 hr ago',   color: '#FEF9C3' },
            { icon: '👤', text: 'New group Byo Savers created',                  time: '3 hrs ago',  color: '#DBEAFE' },
            { icon: '💰', text: 'Kudzi Sithole contribution received',            time: 'Yesterday',  color: '#DCFCE7' },
            { icon: '📋', text: 'Monthly statement generated',                    time: 'Yesterday',  color: '#F1F5F9' },
          ].map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>{a.icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12px', color: '#374151' }}>{a.text}</div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>{a.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Escrow health — 2 cols on mobile, 4 on desktop */}
      <div style={{ background: 'white', borderRadius: '12px', padding: isMobile ? '14px' : '20px', border: '1px solid #E2E8F0' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 14px' }}>🏦 Escrow Health</h3>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '12px' }}>
          {[
            { label: 'Total Collected', value: '$6,000', note: '6 months × $1,000' },
            { label: 'Paid Out',        value: '$5,000', note: '5 completed payouts' },
            { label: 'Held in Escrow',  value: '$600',   note: 'Current balance'    },
            { label: 'Insurance Pool',  value: '$90',    note: '1.5% reserve'       },
          ].map(item => (
            <div key={item.label} style={{ background: '#F8FAFC', borderRadius: '8px', padding: '12px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '11px', color: '#64748B' }}>{item.label}</div>
              <div style={{ fontSize: isMobile ? '18px' : '20px', fontWeight: '700', color: TEAL, margin: '4px 0' }}>{item.value}</div>
              <div style={{ fontSize: '11px', color: '#94A3B8' }}>{item.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Members Page ──────────────────────────────────────────────
function MembersPage() {
  const isMobile = useIsMobile()
  const [search, setSearch] = useState('')
  const filtered = MEMBERS.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search members..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 14px', border: '1.5px solid #E2E8F0', borderRadius: '8px', fontSize: '13px', width: isMobile ? '100%' : '280px', outline: 'none', boxSizing: 'border-box' as any }}
        />
        {!isMobile && (
          <button style={{ background: TEAL, color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
            + Invite Member
          </button>
        )}
      </div>

      {/* Mobile: card list */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(m => (
            <div key={m.name} style={{ background: 'white', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#E1F5EE', color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600', flexShrink: 0 }}>
                  {m.name.split(' ').map((n: string) => n[0]).join('')}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#1E293B' }}>{m.name}</div>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>Position #{m.pos} · Score: {m.score}</div>
                </div>
                {statusPill(m.status)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {tierBadge(m.tier)}
                <span style={{ fontSize: '12px', color: '#374151' }}>${(m.pos * 100).toLocaleString()} contributed</span>
                <button style={{ background: '#F1F5F9', border: 'none', borderRadius: '6px', padding: '4px 12px', fontSize: '11px', cursor: 'pointer', color: '#475569' }}>View</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Desktop: table */
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Member', 'Position', 'Tier', 'Score', 'Status', 'Contributed', 'Action'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#64748B', borderBottom: '1px solid #E2E8F0', textTransform: 'uppercase' as any }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m.name} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#E1F5EE', color: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '600' }}>
                        {m.name.split(' ').map((n: string) => n[0]).join('')}
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: '500', color: '#1E293B' }}>{m.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '13px', color: '#374151' }}>#{m.pos}</td>
                  <td style={{ padding: '12px 16px' }}>{tierBadge(m.tier)}</td>
                  <td style={{ padding: '12px 16px', fontSize: '13px', color: TEAL, fontWeight: '600' }}>{m.score}</td>
                  <td style={{ padding: '12px 16px' }}>{statusPill(m.status)}</td>
                  <td style={{ padding: '12px 16px', fontSize: '13px', color: '#374151' }}>${(m.pos * 100).toLocaleString()}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <button style={{ background: '#F1F5F9', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', color: '#475569' }}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Payouts Page ──────────────────────────────────────────────
function PayoutsPage() {
  const isMobile = useIsMobile()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)', gap: '10px' }}>
        {[
          { label: 'Completed', value: '6', color: TEAL },
          { label: 'Remaining', value: '4', color: '#1A5EA8' },
          { label: 'Next',      value: 'Aug 1', color: '#B45309' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: isMobile ? '12px' : '20px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '11px', color: '#64748B' }}>{s.label}</div>
            <div style={{ fontSize: isMobile ? '20px' : '28px', fontWeight: '700', color: s.color, marginTop: '4px' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Mobile: card list */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: NAVY, padding: '4px 0' }}>Full Payout Schedule</div>
          {PAYOUT_SCHEDULE.map((p, i) => (
            <div key={p.month} style={{ background: p.status === 'CURRENT' ? '#F0FDF4' : 'white', borderRadius: '10px', border: `1px solid ${p.status === 'CURRENT' ? '#BBF7D0' : '#E2E8F0'}`, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div>
                  <span style={{ fontSize: '11px', color: '#94A3B8', marginRight: '8px' }}>{p.month} 2025</span>
                  <span style={{ fontSize: '13px', fontWeight: p.status === 'CURRENT' ? '700' : '500', color: p.status === 'CURRENT' ? TEAL : '#374151' }}>{p.name}</span>
                </div>
                <span style={{ fontSize: '13px', fontWeight: '600', color: '#1E293B' }}>{p.amount}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '999px', background: p.status === 'DONE' ? '#DCFCE7' : p.status === 'CURRENT' ? '#BBF7D0' : '#F1F5F9', color: p.status === 'DONE' ? '#166534' : p.status === 'CURRENT' ? '#166534' : '#64748B' }}>
                  {p.status === 'DONE' ? '✓ Completed' : p.status === 'CURRENT' ? '⚡ Processing' : '⏳ Scheduled'}
                </span>
                {p.status === 'CURRENT' && (
                  <button style={{ background: TEAL, color: 'white', border: 'none', borderRadius: '6px', padding: '5px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>Release</button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Desktop: table */
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: 0 }}>Full Payout Schedule</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Month', 'Recipient', 'Amount', 'Date', 'Status', 'Gates', 'Action'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#64748B', borderBottom: '1px solid #E2E8F0', textTransform: 'uppercase' as any }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PAYOUT_SCHEDULE.map((p, i) => (
                <tr key={p.month} style={{ borderBottom: '1px solid #F1F5F9', background: p.status === 'CURRENT' ? '#F0FDF4' : 'white' }}>
                  <td style={{ padding: '12px 16px', fontSize: '13px', color: '#64748B' }}>{p.month} 2025</td>
                  <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: p.status === 'CURRENT' ? '600' : '400', color: p.status === 'CURRENT' ? TEAL : '#374151' }}>{p.name}</td>
                  <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: '600', color: '#1E293B' }}>{p.amount}</td>
                  <td style={{ padding: '12px 16px', fontSize: '12px', color: '#64748B' }}>{`${i + 1} ${p.month} 2025`}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '999px', background: p.status === 'DONE' ? '#DCFCE7' : p.status === 'CURRENT' ? '#BBF7D0' : '#F1F5F9', color: p.status === 'DONE' ? '#166534' : p.status === 'CURRENT' ? '#166534' : '#64748B' }}>
                      {p.status === 'DONE' ? '✓ Completed' : p.status === 'CURRENT' ? '⚡ Processing' : '⏳ Scheduled'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {p.status === 'DONE' ? <span style={{ fontSize: '12px', color: TEAL }}>✓✓✓✓</span> : p.status === 'CURRENT' ? <span style={{ fontSize: '12px', color: '#B45309' }}>3/4 passed</span> : <span style={{ fontSize: '12px', color: '#94A3B8' }}>Pending</span>}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {p.status === 'CURRENT' && (
                      <button style={{ background: TEAL, color: 'white', border: 'none', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', cursor: 'pointer', fontWeight: '500' }}>Release</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Coming Soon ───────────────────────────────────────────────
function ComingSoon({ page }: { page: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', textAlign: 'center', padding: '24px' }}>
      <div style={{ fontSize: '64px', marginBottom: '16px' }}>🚧</div>
      <h2 style={{ fontSize: '20px', fontWeight: '600', color: NAVY, margin: '0 0 8px' }}>{page} — Coming Next</h2>
      <p style={{ color: '#64748B', fontSize: '14px', maxWidth: '400px' }}>
        This module is being built. The database tables and API endpoints are ready — the UI is next in our build sequence.
      </p>
      <div style={{ marginTop: '20px', background: '#F0FDF4', borderRadius: '8px', padding: '12px 20px', border: '1px solid #BBF7D0', fontSize: '13px', color: '#166534' }}>
        ✅ Database ready &nbsp;·&nbsp; ✅ API ready &nbsp;·&nbsp; 🔲 UI in progress
      </div>
    </div>
  )
}
