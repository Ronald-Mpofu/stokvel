// src/lib/mobile/tokens.ts
//
// Single source of truth for mobile layout decisions. No 'use client' —
// server components can import these too.
//
// WHY THIS EXISTS
// dashboard/page.tsx broke at 768px while the login page broke at 640px,
// so the same phone was "mobile" on one screen and not another. Every
// breakpoint in the app now resolves here.

// ── Breakpoints ───────────────────────────────────────────────
// 768 is the ceiling for phone layouts. It covers every phone in
// portrait plus small tablets, which should get touch layouts anyway.
// NOTE: this raises the login page from 640 — a 700px-wide device now
// correctly gets the mobile layout there.
export const BREAKPOINTS = {
  mobile: 768,   // <= this is phone layout
  tablet: 1024,
} as const

export const MEDIA = {
  mobile: `(max-width: ${BREAKPOINTS.mobile - 1}px)`,
  desktop: `(min-width: ${BREAKPOINTS.mobile}px)`,
} as const

// ── Palette ───────────────────────────────────────────────────
// Existing brand colours. Not up for renegotiation — the job is making
// them work at 360px.
export const C = {
  teal: '#0F6E56',
  tealDark: '#085041',
  tealBg: '#E1F5EE',
  navy: '#0D2137',
  blue: '#1A5EA8',
  purple: '#7C3AED',

  // Status. Amber is the ONLY warm colour on a screen and it marks the
  // one row needing action. If three things are highlighted, nothing is.
  amber: '#B45309',
  amberBg: '#FAEEDA',
  amberText: '#412402',
  red: '#DC2626',
  redBg: '#FCEBEB',

  text: '#0D2137',
  textMuted: '#64748B',
  textFaint: '#94A3B8',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFC',
} as const

// ── Touch targets ─────────────────────────────────────────────
// Material specifies 48dp minimum; Apple says 44pt. Use 48 — the
// audience is overwhelmingly Android, often used one-handed, sometimes
// outdoors. Undersized targets are the most common mobile failure.
export const TOUCH = {
  min: 48,
  primary: 50,
  icon: 44,
} as const

// ── Spacing ───────────────────────────────────────────────────
export const S = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28,
  screenX: 16,        // horizontal screen padding at 360px
} as const

// ── Type scale ────────────────────────────────────────────────
// System fonts only. A webfont is 50-200KB of render-blocking download
// that users pay for on metered data — the personality comes from the
// scale and from tabular numerals, not from a typeface purchase.
export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export const T = {
  display: { fontSize: 26, fontWeight: 500, lineHeight: 1.2 },
  title:   { fontSize: 18, fontWeight: 500, lineHeight: 1.3 },
  heading: { fontSize: 16, fontWeight: 500, lineHeight: 1.4 },
  body:    { fontSize: 14, fontWeight: 400, lineHeight: 1.5 },
  small:   { fontSize: 13, fontWeight: 400, lineHeight: 1.45 },
  caption: { fontSize: 12, fontWeight: 400, lineHeight: 1.4 },
  micro:   { fontSize: 11, fontWeight: 400, lineHeight: 1.3 },
  // 16px minimum on inputs — anything smaller triggers iOS Safari
  // auto-zoom on focus, which yanks the layout sideways mid-form.
  input:   { fontSize: 16, fontWeight: 400 },
} as const

// ── Money ─────────────────────────────────────────────────────
// tabular-nums is not cosmetic here. In a proportional font, $1,800 and
// $300 do not align down a column, and a passbook you cannot scan
// vertically is just a list.
export const MONEY_STYLE = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
} as const

const SYMBOLS: Record<string, string> = {
  USD: '$', ZAR: 'R', GBP: '£', EUR: '€',
  KES: 'KSh', TZS: 'TSh', UGX: 'USh',
  ZMW: 'K', BWP: 'P', MWK: 'MK', ZWG: 'ZWG ',
}

export function money(amount: number | string | null | undefined, currency = 'USD'): string {
  const n = Number(amount ?? 0)
  const symbol = SYMBOLS[currency] ?? `${currency} `
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${symbol}${formatted}`
}

// ── Shared style fragments ────────────────────────────────────
export const SCREEN: React.CSSProperties = {
  fontFamily: FONT_STACK,
  background: C.surfaceAlt,
  minHeight: '100vh',
  // Room for the bottom nav plus the iOS home indicator.
  paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
}

export const CARD: React.CSSProperties = {
  background: C.surface,
  borderRadius: 12,
  border: `1px solid ${C.border}`,
}

export const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: S.md,
  padding: `13px ${S.screenX}px`,
  borderTop: `1px solid ${C.border}`,
  minHeight: TOUCH.min,
}
