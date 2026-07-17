'use client';

// src/app/dashboard/settings/page.tsx
// System Settings hub — replaces the "Coming Next" placeholder.
// Live sections link through; planned sections render as disabled cards.

import Link from 'next/link';

const TEAL = '#0F6E56';
const NAVY = '#0D2137';

interface SettingsSection {
  title: string;
  description: string;
  href: string | null; // null = not built yet
  icon: string;
}

const SECTIONS: SettingsSection[] = [
  {
    title: 'Membership Charges',
    description: 'Group monthly subscription pricing per country, tiered by member count.',
    href: '/dashboard/settings/charges',
    icon: '💳',
  },
  {
    title: 'Joining Fees',
    description: 'Member annual joining fee and payment methods per country.',
    href: null,
    icon: '🎟️',
  },
  {
    title: 'Countries & Currencies',
    description: 'Operating countries, currencies, and stokvel brand names.',
    href: null,
    icon: '🌍',
  },
  {
    title: 'Notifications',
    description: 'SMS, email, and WhatsApp templates and delivery settings.',
    href: null,
    icon: '🔔',
  },
];

function SectionCard(props: { section: SettingsSection }) {
  const s = props.section;
  const card: React.CSSProperties = {
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: 20,
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    height: '100%',
    boxSizing: 'border-box',
    opacity: s.href ? 1 : 0.55,
    transition: 'box-shadow 0.15s',
  };
  const inner = (
    <div style={card}>
      <div style={{ fontSize: 26 }}>{s.icon}</div>
      <div style={{ fontWeight: 700, color: NAVY, fontSize: 16 }}>
        {s.title}
        {s.href ? null : (
          <span
            style={{
              marginLeft: 8,
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              background: '#f1f5f9',
              color: '#64748b',
              verticalAlign: 'middle',
            }}
          >
            COMING SOON
          </span>
        )}
      </div>
      <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{s.description}</div>
      {s.href ? (
        <div style={{ marginTop: 'auto', color: TEAL, fontSize: 13, fontWeight: 700 }}>
          Open →
        </div>
      ) : null}
    </div>
  );
  if (s.href) {
    return (
      <Link href={s.href} style={{ textDecoration: 'none' }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

export default function SettingsPage() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: NAVY, fontSize: 24, margin: 0 }}>System Settings</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 6 }}>
          Platform-wide configuration. Changes here affect all groups and members.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 16,
        }}
      >
        {SECTIONS.map((s) => (
          <SectionCard key={s.title} section={s} />
        ))}
      </div>
    </div>
  );
}
