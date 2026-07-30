// src/lib/mobile/passbook.ts
//
// The contract between the passbook API and the passbook screen, plus the
// visual tone for each kind of ledger row.
//
// WHY THIS FILE EXISTS
//
// Six windfall schemes keep four different kinds of ledger. A row in a
// savings pool is a month you owe; a row in a property stake is money that
// moved in or out; a row in a loan is an installment you owe back. Rather
// than six screens, there is one screen and four row grammars — and this
// is where a grammar is defined.
//
// DIVISION OF LABOUR
//
// The SERVER decides what a row means and writes its label and detail.
// The CLIENT decides what a row looks like and formats money.
//
// That split matters on metered data. The server sends only the fields
// the screen renders — no scheme config, no fee percentages, no member
// list — and the client does no derivation, so a 2GB Android phone paints
// the screen without recomputing a ledger on every navigation.
//
// The one deliberate exception is money formatting: amounts travel as
// numbers and are formatted client-side by money(), so a currency change
// never needs a server deploy.

// ── Grammars ──────────────────────────────────────────────────
// ROTATING      Savings pool. Rows are periods; one period pays you out.
// ACCUMULATING  Grocery club, Assets. Rows are periods toward a target.
// STAKE         Property, Investment. Money in, money out, no due dates.
// REPAYMENT     Loans. Rows are installments owed back to the group.
export type PassbookGrammar =
  | 'ROTATING'
  | 'ACCUMULATING'
  | 'STAKE'
  | 'REPAYMENT'

// ── Row kinds ─────────────────────────────────────────────────
// PAID     Settled. Carries a date and a payment method.
// DUE      Owed now, or overdue. The one row that must catch the eye.
// PENDING  Future. Deliberately quiet — not the member's problem yet.
// GOAL     What the member is waiting for: payout, hamper, delivery,
//          settlement. Every book ends on one of these.
// INFLOW   Capital the member put in (stake grammar).
// OUTFLOW  A distribution paid out to the member (stake grammar).
// NOTE     An event with no money movement for this member: a valuation,
//          or another member's delivery in a round-robin queue.
export type PassbookRowKind =
  | 'PAID'
  | 'DUE'
  | 'PENDING'
  | 'GOAL'
  | 'INFLOW'
  | 'OUTFLOW'
  | 'NOTE'

export type PassbookRow = {
  // Stable within a passbook. Month number, installment number or record
  // id — the server picks, the client only uses it as a React key.
  id: string
  kind: PassbookRowKind
  // "August 2026", "Installment 7", "Capital call 2", "Your delivery".
  label: string
  // "Due 5 Aug · in 6 days", "Paid 6 May · EcoCash". Server-composed, so
  // the client never assembles a sentence from parts.
  detail: string
  // Numeric so the client can format it. Null when the row's value is not
  // money — a delivery month, or another member's row.
  amount: number | null
  // Used only when amount is null: "Nov", "—", "est. $96".
  amountText?: string | null
}

export type PassbookKpi = {
  label: string
  // Pre-formatted text, for anything that is not money: "#1", "3 of 5",
  // "Yenzelani".
  value?: string
  // Money. Sent as a number and formatted by the client, so a currency
  // change never needs a server deploy. When present this wins over value.
  //
  // The first build composed amounts into value server-side and shipped
  // "You collect 750" to an AUD group. Amounts are numbers, everywhere.
  amount?: number | null
}

// The headline number. CREDIT counts up and reads teal; DEBIT counts down
// and reads amber, so a loan can never be mistaken for savings at a
// glance. That distinction is the whole reason tone is a field.
export type PassbookHeroTone = 'CREDIT' | 'DEBIT'

export type PassbookHero = {
  label: string
  amount: number
  // "of $1,800" — rendered small beside the hero. Null when there is no
  // target, as in a stake statement.
  ofAmount?: number | null
  tone: PassbookHeroTone
  // 0–100. Null hides the bar entirely; a rotating book has no meaningful
  // progress bar because the target is the whole cycle.
  progressPct?: number | null
}

// The primary action, which always names its amount. NONE is a real
// state: a property stake owes nothing, so the bar offers to add instead.
export type PassbookActionKind = 'PAY' | 'REPAY' | 'TOPUP' | 'NONE'

export type PassbookAction = {
  kind: PassbookActionKind
  // "Pay", "Repay", "Add to your stake". The verb, without the amount —
  // the client appends the formatted amount.
  verb: string
  amount: number | null
  // Two short lines to the left of the button: "August", "$150 due".
  hintTop: string
  hintBottom: string
}

// Round-robin only. The queue strip is the whole scheme in one row of
// blocks, and publishing it is what stops later members suspecting the
// order is being manipulated.
export type PassbookQueue = {
  position: number
  total: number
  // How many members ahead of this one have already received.
  delivered: number
  // "Two delivered · yours is next · est. November"
  caption: string
}

export type PassbookView = {
  scheme: {
    id: string
    name: string
    grammar: PassbookGrammar
    groupName: string
    currency: string
  }
  // The non-money part of the terms line: "Rotating · cycle 1". Any
  // amount in it travels separately, for the reason given on PassbookKpi.
  terms: string
  // Rendered by the client as "· <formatted amount> monthly", appended to
  // terms. Null when the scheme has no contribution amount.
  termsAmount?: number | null
  termsFrequency?: string | null
  hero: PassbookHero
  // Zero to three. Three fit across a 360px screen; a fourth truncates.
  kpis: PassbookKpi[]
  caption: { left: string; right: string }
  rows: PassbookRow[]
  action: PassbookAction
  queue?: PassbookQueue | null
}

// ── Row tones ─────────────────────────────────────────────────
// Colours not present in the token file are declared here rather than
// added to C, because they are meaningful only inside a passbook. The
// amber pair matches the values already used inline by the existing
// PassbookRow, so the two renderers agree during the transition.
const AMBER_RULE = '#EF9F27'
const AMBER_DEEP = '#854F0B'
const GREEN_BG = '#EAF3DE'
const GREEN_FG = '#3B6D11'
const BLUE_BG = '#E6F1FB'
const BLUE_FG = '#185FA5'

export type RowTone = {
  // The stamped square. Square rather than round on purpose: it reads as
  // a rubber stamp on a paper book, which is the artifact being imitated.
  glyph: string
  chipBg: string
  chipFg: string
  rowBg: string | null
  ruleColor: string | null
  titleColor: string | null
  detailColor: string | null
  amountColor: string | null
  // Quiet rows are dimmed as a group rather than by picking paler colours
  // for each element.
  dim: boolean
}

// Built from the token palette at call time so a token change propagates
// without editing this file. C is passed in rather than imported to keep
// this module free of side effects and trivially testable.
export function rowTone(
  kind: PassbookRowKind,
  C: Record<string, string>
): RowTone {
  const base: RowTone = {
    glyph: '·',
    chipBg: C.surfaceAlt,
    chipFg: C.textFaint,
    rowBg: null,
    ruleColor: null,
    titleColor: C.text,
    detailColor: C.textFaint,
    amountColor: C.text,
    dim: false,
  }

  switch (kind) {
    case 'PAID':
      return { ...base, glyph: '✓', chipBg: C.tealBg, chipFg: C.teal, amountColor: C.text }

    case 'DUE':
      return {
        ...base,
        glyph: '!',
        chipBg: AMBER_RULE,
        chipFg: '#412402',
        rowBg: C.amberBg,
        ruleColor: AMBER_RULE,
        titleColor: C.amberText,
        detailColor: AMBER_DEEP,
        amountColor: C.amberText,
      }

    case 'PENDING':
      return {
        ...base,
        glyph: '·',
        titleColor: C.textMuted,
        amountColor: C.textFaint,
        dim: true,
      }

    case 'GOAL':
      return {
        ...base,
        glyph: '★',
        chipBg: C.teal,
        chipFg: '#FFFFFF',
        rowBg: C.tealBg,
        ruleColor: C.teal,
        titleColor: C.tealDark,
        detailColor: C.teal,
        amountColor: C.tealDark,
      }

    case 'INFLOW':
      return { ...base, glyph: '↓', chipBg: C.tealBg, chipFg: C.teal }

    case 'OUTFLOW':
      return {
        ...base,
        glyph: '↑',
        chipBg: GREEN_BG,
        chipFg: GREEN_FG,
        amountColor: GREEN_FG,
      }

    case 'NOTE':
      return {
        ...base,
        glyph: '✓',
        chipBg: BLUE_BG,
        chipFg: BLUE_FG,
        amountColor: BLUE_FG,
      }

    default:
      return base
  }
}

// Height reserved for the application's fixed bottom navigation bar
// (Home / Groups / Pool / Alerts / More). Screens that pin anything to the
// bottom must clear it, or the nav slices through their last row — which
// is exactly what happened to the sixth scheme card and would have hidden
// the Pay button too.
//
// ONE place to change if the nav is ever resized. Both the hub and the
// passbook shell import it rather than each carrying a magic number.
export const APP_BOTTOM_NAV_HEIGHT = 64

// The hero number on the dark header. Amber-on-navy rather than the token
// amber, which is tuned for light surfaces and goes muddy on the header.
export const HERO_DEBIT_ON_NAVY = '#FAC775'

// ── Guards ────────────────────────────────────────────────────
// The screen must never crash on a malformed payload. It shows fewer rows
// instead. Cheaper than a Zod schema on the client, and the client is not
// a trust boundary — the server already validated.
export function isPassbookView(v: any): v is PassbookView {
  return Boolean(
    v &&
    v.scheme && typeof v.scheme.name === 'string' &&
    v.hero && typeof v.hero.amount === 'number' &&
    Array.isArray(v.rows) &&
    v.action && typeof v.action.verb === 'string'
  )
}

export function safeRows(v: PassbookView | null): PassbookRow[] {
  if (!v || !Array.isArray(v.rows)) return []
  return v.rows.filter(r => r && typeof r.label === 'string' && typeof r.id === 'string')
}

export function safeKpis(v: PassbookView | null): PassbookKpi[] {
  if (!v || !Array.isArray(v.kpis)) return []
  return v.kpis
    .filter(k => k && typeof k.label === 'string' && typeof k.value === 'string')
    .slice(0, 3)
}
