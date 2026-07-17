'use client';

// src/app/dashboard/settings/layout.tsx
// Shared frame for ALL /dashboard/settings/* pages:
//   Desktop → left-hand settings menu with active highlight
//   Mobile  → sticky top bar with back button + horizontal chip nav
// New settings pages get this navigation automatically — add them
// to MENU_ITEMS when their route exists.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const TEAL = '#0F6E56';
const NAVY = '#0D2137';

interface MenuItem {
  label: string;
  icon: string;
  href: string | null; // null = coming soon
}

const MENU_ITEMS: MenuItem[] = [
  { label: 'Overview',            icon: '⚙️', href: '/dashboard/settings' },
  { label: 'Membership Charges',  icon: '💳', href: '/dashboard/settings/charges' },
  { label: 'Joining Fees',        icon: '🎟️', href: null },
  { label: 'Countries & Brands',  icon: '🌍', href: null },
  { label: 'Notifications',       icon: '🔔', href: null },
];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

function MenuLink(props: { item: MenuItem; active: boolean }) {
  const { item, active } = props;
  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 14,
    textDecoration: 'none',
    color: active ? '#fff' : item.href ? NAVY : '#94a3b8',
    background: active ? TEAL : 'transparent',
    fontWeight: active ? 700 : 500,
    cursor: item.href ? 'pointer' : 'default',
  };
  const inner = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <span style={{ fontSize: 16 }}>{item.icon}</span>
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.href ? null : (
        <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', border: '1px solid #e2e8f0', borderRadius: 999, padding: '1px 6px' }}>
          SOON
        </span>
      )}
    </span>
  );
  if (item.href) {
    return (
      <Link href={item.href} style={base}>
        {inner}
      </Link>
    );
  }
  return <div style={base}>{inner}</div>;
}

function ChipLink(props: { item: MenuItem; active: boolean }) {
  const { item, active } = props;
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    borderRadius: 999,
    fontSize: 13,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    color: active ? '#fff' : item.href ? NAVY : '#94a3b8',
    background: active ? TEAL : '#f1f5f9',
    fontWeight: active ? 700 : 500,
  };
  if (item.href) {
    return (
      <Link href={item.href} style={style}>
        <span>{item.icon}</span>
        <span>{item.label}</span>
      </Link>
    );
  }
  return (
    <span style={style}>
      <span>{item.icon}</span>
      <span>{item.label}</span>
    </span>
  );
}

export default function SettingsLayout(props: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();

  const isActive = (href: string | null) =>
    href !== null &&
    (href === '/dashboard/settings'
      ? pathname === '/dashboard/settings'
      : pathname.startsWith(href));

  if (isMobile) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 40,
            background: '#fff',
            borderBottom: '1px solid #e2e8f0',
            padding: '10px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Link
              href="/dashboard"
              style={{ textDecoration: 'none', color: NAVY, fontSize: 14, fontWeight: 700 }}
            >
              ← Dashboard
            </Link>
            <span style={{ color: '#cbd5e1' }}>/</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: TEAL }}>Settings</span>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {MENU_ITEMS.map((item) => (
              <ChipLink key={item.label} item={item} active={isActive(item.href)} />
            ))}
          </div>
        </div>
        <div>{props.children}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          background: '#fff',
          borderRight: '1px solid #e2e8f0',
          padding: '18px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <Link
          href="/dashboard"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textDecoration: 'none',
            color: '#64748b',
            fontSize: 13,
            fontWeight: 600,
            padding: '8px 14px',
            marginBottom: 10,
          }}
        >
          ← Back to Dashboard
        </Link>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', padding: '0 14px 6px', letterSpacing: 1 }}>
          SETTINGS
        </div>
        {MENU_ITEMS.map((item) => (
          <MenuLink key={item.label} item={item} active={isActive(item.href)} />
        ))}
      </aside>
      <main style={{ flex: 1, minWidth: 0 }}>{props.children}</main>
    </div>
  );
}
