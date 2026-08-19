// src/lib/passbook/build.ts
//
// Turns database rows into a PassbookView the mobile screen can paint
// without deriving anything.
//
// SERVER SIDE ONLY. Never import this into a client component — it exists
// so the phone does no ledger arithmetic. On a 2GB Android, recomputing
// statuses and labels for every row on every navigation is visible; and
// every field the client would need for that derivation is a field the
// member paid airtime to receive.
//
// WHAT LIVES HERE AND WHAT DOES NOT
//   Here:      what a row MEANS — its kind, its label, its detail line.
//   Not here:  what a row LOOKS LIKE. Colours and glyphs are in
//              src/lib/mobile/passbook.ts, on the client, so a palette
//              change never needs a server deploy.
//   Not here:  money formatting. Amounts travel as numbers.
//
// DATES
//   Formatted here, deliberately, using an explicit en-GB day-month order
//   rather than the server's locale. Day-before-month is the convention
//   across Zimbabwe, South Africa, Kenya and Australia, and pinning it
//   means the string is identical whichever region a Vercel function runs
//   in. A member must never see 08/05 meaning one thing on Monday and
//   another on Tuesday.

import type {
  PassbookGrammar,
  PassbookRow,
  PassbookRowKind,
  PassbookView,
  PassbookKpi,
} from '@/lib/mobile/passbook'

// The six real labels of the WindfallSchemeType enum, confirmed against
// the database rather than inferred from scheme names.
export type WindfallSchemeType =
  | 'SAVINGS_POOL'
  | 'GROCERY_CLUB'
  | 'PROPERTY'
  | 'LOANS'
  | 'INVESTMENT'
  | 'ASSETS'

// Four grammars, six schemes. Property and Investment share one, which is
// why five screens cover six schemes.
export const SCHEME_GRAMMAR: Record<WindfallSchemeType, PassbookGrammar> = {
  SAVINGS_POOL: 'ROTATING',
  GROCERY_CLUB: 'ACCUMULATING',
  ASSETS:       'ACCUMULATING',
  PROPERTY:     'STAKE',
  INVESTMENT:   'STAKE',
  LOANS:        'REPAYMENT',
}

// Which grammars can actually be built today. ROTATING and ACCUMULATING
// both read Cycle and Contribution, which exist and are populated. STAKE
// reads PropertyStake / InvestmentAllocation and REPAYMENT reads
// LoanRepayment — real tables, but no route has been written against them
// yet, and inventing rows for them would be worse than saying so.
export const GRAMMAR_READY: Record<PassbookGrammar, boolean> = {
  ROTATING: true,
  ACCUMULATING: true,
  STAKE: false,
  REPAYMENT: false,
}

// ── Date and number helpers ───────────────────────────────────
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function d(value: unknown): Date | null {
  if (!value) return null
  const dt = new Date(value as string)
  return Number.isNaN(dt.getTime()) ? null : dt
}

// "August 2026". The year is always present: a twelve-month cycle crosses
// a year boundary, and two rows both reading "January" with no year is
// exactly the ambiguity a paper passbook never has.
function monthYear(dt: Date | null): string {
  if (!dt) return ''
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`
}

// How a row is titled depends on how often the scheme collects.
//
// A monthly scheme gets "August 2026" — the month IS the period, and the
// year is always shown because a twelve-month cycle crosses a year end.
//
// A weekly pool cannot use that. Your Sydney pool runs weekly for twelve
// months, which is 52 rows, so month labelling would produce four or five
// consecutive rows all reading "August 2026" with nothing to tell them
// apart. Those rows get their period number and date instead.
//
// Frequency arrives as WEEKLY / FORTNIGHTLY / MONTHLY from the savings
// module, or lowercase 'monthly' from the older scheme config, so it is
// compared case-insensitively.
function periodLabel(
  frequency: string | null | undefined,
  periodNumber: number,
  due: Date | null
): string {
  const f = (frequency || 'MONTHLY').toUpperCase()

  if (f === 'WEEKLY') {
    return due ? `Week ${periodNumber} · ${dayMonth(due)}` : `Week ${periodNumber}`
  }
  if (f === 'FORTNIGHTLY') {
    return due ? `Period ${periodNumber} · ${dayMonth(due)}` : `Period ${periodNumber}`
  }
  return monthYear(due)
}

// "6 May"
function dayMonth(dt: Date | null): string {
  if (!dt) return ''
  return `${dt.getUTCDate()} ${MONTHS_SHORT[dt.getUTCMonth()]}`
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  return Math.round(ms / 86400000)
}

// "in 6 days" / "6 days ago" / "today". Relative phrasing beats a bare
// date for the one row that needs acting on.
function relativeDue(due: Date, now: Date): string {
  const n = daysBetween(now, due)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n > 1) return `in ${n} days`
  if (n === -1) return '1 day late'
  return `${Math.abs(n)} days late`
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

// Payment methods are stored as enum labels. ECOCASH becomes EcoCash,
// MTN_MOMO becomes MTN MoMo — brand casing a member recognises, not the
// database's shouting.
const METHOD_LABEL: Record<string, string> = {
  ECOCASH: 'EcoCash',
  MPESA: 'M-Pesa',
  MTN_MOMO: 'MTN MoMo',
  BANK_TRANSFER: 'bank transfer',
  CARD: 'card',
  USSD: 'USSD',
  INTERNAL_TRANSFER: 'internal transfer',
}

function methodLabel(m: string | null): string {
  if (!m) return ''
  return METHOD_LABEL[m] || m.replace(/_/g, ' ').toLowerCase()
}

const PAID_STATUSES = new Set(['PAID', 'PRE_PAID'])

// ── Inputs ────────────────────────────────────────────────────
// Shapes match what the route's query returns, nothing more.
export type SchemeInput = {
  id: string
  name: string
  schemeType: string
  groupName: string
  currency: string
  isContributory: boolean
  isRotating: boolean
  contributionAmount: number | null
  contributionFrequency: string | null
}

export type CycleInput = {
  id: string
  cycleNumber: number
  totalMembers: number
  poolAmount: number
} | null

export type ContributionInput = {
  // Sequence within the cycle or pool. Called monthNumber for historical
  // reasons; for a weekly pool it is a week number.
  monthNumber: number
  dueDate: string
  amountDue: unknown
  amountPaid: unknown
  status: string
  paidAt: string | null
  paymentMethod: string | null
}

export type RotationInput = {
  monthNumber: number
  scheduledDate: string
  payoutAmount: unknown
  status: string
  recipientName: string | null
  isMe: boolean
}

export type MeInput = {
  position: number | null
  totalPaid: number
  monthsPaid: number
}

// ── Contribution rows, shared by both contributory grammars ───
// A rotating book and an accumulating book read the same two tables and
// differ only in the goal row and the standing figures. The ledger rows
// themselves are identical, so they are built once.
function contributionRows(
  contributions: ContributionInput[],
  now: Date,
  frequency?: string | null
): PassbookRow[] {
  return contributions.map(c => {
    const due = d(c.dueDate)
    const paid = PAID_STATUSES.has(c.status)
    const overdue = !paid && due !== null && due < now

    let kind: PassbookRowKind = 'PENDING'
    if (paid) kind = 'PAID'
    else if (overdue) kind = 'DUE'

    let detail = 'Not yet due'
    if (paid) {
      const when = dayMonth(d(c.paidAt)) || dayMonth(due)
      const how = methodLabel(c.paymentMethod)
      detail = how ? `Paid ${when} · ${how}` : `Paid ${when}`
    } else if (due) {
      detail = `Due ${dayMonth(due)} · ${relativeDue(due, now)}`
    }

    return {
      id: `c-${c.monthNumber}`,
      kind,
      label: periodLabel(frequency, c.monthNumber, due),
      detail,
      amount: num(c.amountDue),
    }
  })
}

// The row every book ends on: what the member is waiting for. In a
// rotation that is their payout; in an accumulating scheme it is the
// collection. Placed in month order with the rest, not pinned to the
// bottom, because a paper passbook has it on the page where it falls.
function payoutGoalRow(
  rotation: RotationInput[],
  position: number | null,
  frequency?: string | null
): PassbookRow | null {
  if (!position) return null
  const mine = rotation.find(r => r.isMe) || rotation.find(r => r.monthNumber === position)
  if (!mine) return null
  const when = d(mine.scheduledDate)

  // Already received. A member holding position 1 collects in month 1, so
  // the payout lands in the SAME month as their first contribution — two
  // rows reading "April 2026" with nothing to tell them apart. The label
  // carries the word Payout for that reason, and a settled payout is not
  // a goal the member is still waiting for.
  const received = mine.status === 'COMPLETED'

  return {
    id: `payout-${mine.monthNumber}`,
    kind: received ? 'NOTE' : 'GOAL',
    label: `Payout · ${periodLabel(frequency, mine.monthNumber, when)}`,
    detail: received
      ? `Received · position ${mine.monthNumber} of ${rotation.length}`
      : `Your payout · position ${mine.monthNumber} of ${rotation.length}`,
    amount: num(mine.payoutAmount),
  }
}

function sortByLabelDate(rows: PassbookRow[], keyOf: (r: PassbookRow) => number): PassbookRow[] {
  return [...rows].sort((a, b) => keyOf(a) - keyOf(b))
}

// ── ROTATING ──────────────────────────────────────────────────
export function buildRotatingView(
  scheme: SchemeInput,
  cycle: CycleInput,
  contributions: ContributionInput[],
  rotation: RotationInput[],
  me: MeInput,
  now: Date
): PassbookView {
  const rows = contributionRows(contributions, now, scheme.contributionFrequency)
  const goal = payoutGoalRow(rotation, me.position, scheme.contributionFrequency)

  // The goal row is inserted at its month, so the member sees the payout
  // sitting between the months either side of it.
  const merged = goal
    ? sortByLabelDate([...rows, goal], r => {
        const n = Number(r.id.replace(/^\D+/, ''))
        return Number.isFinite(n) ? n : 0
      })
    : rows

  const target = cycle ? num(scheme.contributionAmount) * cycle.totalMembers : 0
  const nextDue = contributions.find(c => !PAID_STATUSES.has(c.status))
  const monthsTotal = contributions.length
  const currentRecipient = rotation.find(r => r.status !== 'COMPLETED')

  const kpis: PassbookKpi[] = []
  if (me.position) {
    kpis.push({ label: 'Your turn', value: `#${me.position}` })
  }
  if (rotation.length > 0) {
    const mine = rotation.find(r => r.isMe)
    kpis.push({
      label: 'You collect',
      amount: mine ? num(mine.payoutAmount) : (cycle ? cycle.poolAmount : 0),
    })
  }
  if (currentRecipient) {
    kpis.push({
      label: 'Collecting now',
      value: currentRecipient.isMe ? 'You' : (currentRecipient.recipientName || 'A member').split(' ')[0],
    })
  }

  return {
    scheme: {
      id: scheme.id,
      name: scheme.name,
      grammar: 'ROTATING',
      groupName: scheme.groupName,
      currency: scheme.currency,
    },
    terms: ['Rotating', cycle ? `cycle ${cycle.cycleNumber}` : null]
      .filter(Boolean).join(' · '),
    termsAmount: scheme.contributionAmount,
    termsFrequency: (scheme.contributionFrequency || 'monthly').toLowerCase(),
    hero: {
      label: 'Paid this cycle',
      amount: me.totalPaid,
      ofAmount: target > 0 ? target : null,
      tone: 'CREDIT',
      // No bar: in a rotation the target is the whole cycle, and a bar
      // creeping to 100% over a year tells a member nothing they can act
      // on. The month rows already say where they stand.
      progressPct: null,
    },
    kpis,
    caption: {
      left: 'Your passbook',
      right: `${me.monthsPaid} of ${monthsTotal} paid`,
    },
    rows: merged,
    action: nextDue
      ? {
          kind: 'PAY',
          verb: 'Pay',
          amount: num(nextDue.amountDue),
          hintTop: monthYear(d(nextDue.dueDate)).split(' ')[0],
          hintBottom: 'due',
        }
      : { kind: 'NONE', verb: 'All paid', amount: null, hintTop: 'Nothing', hintBottom: 'due' },
    queue: null,
  }
}

// ── ACCUMULATING ──────────────────────────────────────────────
// Grocery club and round-robin assets. Everyone contributes; nobody takes
// the pool mid-way. The progress bar earns its place here because there IS
// a fixed target, which is exactly what a rotation lacks.
export function buildAccumulatingView(
  scheme: SchemeInput,
  cycle: CycleInput,
  contributions: ContributionInput[],
  rotation: RotationInput[],
  me: MeInput,
  now: Date,
  opts: { goalLabel: string; goalDetail: string } = {
    goalLabel: 'Collection',
    goalDetail: 'Everyone collects at the end',
  }
): PassbookView {
  const rows = contributionRows(contributions, now, scheme.contributionFrequency)
  const monthsTotal = contributions.length
  const target = num(scheme.contributionAmount) * monthsTotal
  const nextDue = contributions.find(c => !PAID_STATUSES.has(c.status))
  const last = contributions.length ? d(contributions[contributions.length - 1].dueDate) : null

  const goal: PassbookRow = {
    id: 'goal',
    kind: 'GOAL',
    label: last ? monthYear(last) : opts.goalLabel,
    detail: opts.goalDetail,
    amount: target > 0 ? target : null,
    amountText: target > 0 ? null : '—',
  }

  const kpis: PassbookKpi[] = [
    { label: 'Months paid', value: `${me.monthsPaid} of ${monthsTotal}` },
  ]
  if (last) kpis.push({ label: 'Collection', value: dayMonth(last) })
  if (me.position) kpis.push({ label: 'Your turn', value: `#${me.position}` })

  // A round-robin queue is published only when the scheme actually
  // rotates delivery. A grocery club has no queue and must not show one.
  const queue =
    scheme.isRotating && me.position && rotation.length > 0
      ? {
          position: me.position,
          total: rotation.length,
          delivered: rotation.filter(r => r.status === 'COMPLETED').length,
          caption: `${rotation.filter(r => r.status === 'COMPLETED').length} delivered · you are ${me.position} of ${rotation.length}`,
        }
      : null

  return {
    scheme: {
      id: scheme.id,
      name: scheme.name,
      grammar: 'ACCUMULATING',
      groupName: scheme.groupName,
      currency: scheme.currency,
    },
    terms: ['Accumulating', cycle ? `cycle ${cycle.cycleNumber}` : null]
      .filter(Boolean).join(' · '),
    termsAmount: scheme.contributionAmount,
    termsFrequency: (scheme.contributionFrequency || 'monthly').toLowerCase(),
    hero: {
      label: queue ? 'Toward your unit' : 'Saved so far',
      amount: me.totalPaid,
      ofAmount: target > 0 ? target : null,
      tone: 'CREDIT',
      progressPct: target > 0 ? (me.totalPaid / target) * 100 : null,
    },
    kpis: kpis.slice(0, 3),
    caption: {
      left: queue ? 'Your queue book' : 'Your hamper book',
      right: `${me.monthsPaid} of ${monthsTotal} paid`,
    },
    rows: ledger,
    action: nextDue
      ? {
          kind: 'PAY',
          verb: 'Pay',
          amount: num(nextDue.amountDue),
          hintTop: monthYear(d(nextDue.dueDate)).split(' ')[0],
          hintBottom: 'due',
        }
      : { kind: 'NONE', verb: 'All paid', amount: null, hintTop: 'Nothing', hintBottom: 'due' },
    queue,
  }
}

// ── GROCERY ───────────────────────────────────────────────────
// A grocery club is accumulating, but it is NOT saving.
//
// In a savings pool the money paid in stays the member's and comes back at
// maturity, so a closing balance is real. In a grocery club the money is
// spent on goods and handed over. Once the club distributes, those
// contributions are gone — converted into a hamper the member has taken
// home. Reusing the savings hero here would read "Saved so far $240" to
// someone who has $0 and a food parcel they already ate.
//
// So the hero is what they have PAID IN toward their share, and once the
// club distributes it stops being a balance and becomes a receipt.
export type GroceryClubInput = {
  clubId: string
  clubName: string
  status: string
  totalBudget: number
  myShare: number
  itemCount: number
  purchasedCount: number
  distributedCount: number
  endDate: string | null
}

// Where the club is in its life, in the member's words rather than the
// admin's. SETUP and ACTIVE are the same thing to a member: still paying.
function groceryGoal(
  club: GroceryClubInput,
  target: number,
  now: Date
): PassbookRow {
  const when = d(club.endDate)
  const status = String(club.status || '').toUpperCase()
  const allDistributed = club.itemCount > 0 && club.distributedCount >= club.itemCount

  if (allDistributed || status === 'DISTRIBUTED' || status === 'CLOSED') {
    return {
      id: 'goal',
      kind: 'NOTE',
      label: 'Goods received',
      detail: when && when <= now
        ? `Collected · ${dayMonth(when)}`
        : 'Your share has been handed over',
      amount: target > 0 ? target : null,
      amountText: target > 0 ? null : '—',
    }
  }

  if (status === 'PURCHASING' || club.purchasedCount > 0) {
    return {
      id: 'goal',
      kind: 'GOAL',
      label: 'Collection',
      detail: club.itemCount > 0
        ? `Buying under way · ${club.purchasedCount} of ${club.itemCount} items bought`
        : 'Buying under way',
      amount: target > 0 ? target : null,
      amountText: target > 0 ? null : '—',
    }
  }

  return {
    id: 'goal',
    kind: 'GOAL',
    label: when ? monthYear(when) : 'Collection',
    detail: 'You collect your groceries once the club has bought them',
    amount: target > 0 ? target : null,
    amountText: target > 0 ? null : '—',
  }
}

export function buildGroceryView(
  scheme: SchemeInput,
  club: GroceryClubInput,
  contributions: ContributionInput[],
  me: MeInput,
  now: Date
): PassbookView {
  const rows = contributionRows(contributions, now, scheme.contributionFrequency)
  const periodsTotal = contributions.length

  // The member's own share of the club budget. Prefer the figure the club
  // computed (budget ÷ members) over contributionAmount × periods, because
  // adding an item after activation changes the share but not the number
  // of periods.
  const target = club.myShare > 0
    ? club.myShare
    : num(scheme.contributionAmount) * periodsTotal

  const nextDue = contributions.find(c => !PAID_STATUSES.has(c.status))
  const goal = groceryGoal(club, target, now)
  const settled = goal.kind === 'NOTE'

  // A club with no contribution schedule has no book yet — it has not been
  // activated. The shell shows its empty state on rows.length === 0, so
  // appending the goal row here would replace "add items and activate"
  // with a lone Collection row and hide the one instruction that matters.
  const ledger = periodsTotal > 0 ? [...rows, goal] : []

  const kpis: PassbookKpi[] = [
    { label: 'Periods paid', value: `${me.monthsPaid} of ${periodsTotal}` },
    { label: 'Your share', amount: target > 0 ? target : null },
  ]
  if (club.itemCount > 0) {
    kpis.push({
      label: settled ? 'Items received' : 'Items bought',
      value: `${settled ? club.distributedCount : club.purchasedCount} of ${club.itemCount}`,
    })
  }

  return {
    scheme: {
      id: scheme.id,
      // The CLUB's name, not the scheme's. A member joined "December
      // Hampers"; "Grocery Club" is a registry label.
      name: club.clubName || scheme.name,
      grammar: 'ACCUMULATING',
      groupName: scheme.groupName,
      currency: scheme.currency,
    },
    terms: ['Grocery club', club.itemCount > 0 ? `${club.itemCount} items` : null]
      .filter(Boolean).join(' · '),
    termsAmount: scheme.contributionAmount,
    termsFrequency: (scheme.contributionFrequency || 'monthly').toLowerCase(),
    hero: {
      // Never "Saved". This money buys groceries; it does not come back.
      label: settled ? 'You paid in' : 'Paid in',
      amount: me.totalPaid,
      ofAmount: target > 0 ? target : null,
      tone: 'CREDIT',
      progressPct: target > 0 ? (me.totalPaid / target) * 100 : null,
    },
    kpis: kpis.slice(0, 3),
    caption: {
      left: 'Your hamper book',
      right: `${me.monthsPaid} of ${periodsTotal} paid`,
    },
    rows: ledger,
    action: nextDue && !settled
      ? {
          kind: 'PAY',
          verb: 'Pay',
          amount: num(nextDue.amountDue),
          hintTop: monthYear(d(nextDue.dueDate)).split(' ')[0],
          hintBottom: 'due',
        }
      : {
          kind: 'NONE',
          verb: settled ? 'Club complete' : 'All paid',
          amount: null,
          hintTop: 'Nothing',
          hintBottom: 'due',
        },
    queue: null,
  }
}

// ── Entry point ───────────────────────────────────────────────
export function grammarFor(schemeType: string): PassbookGrammar {
  const g = SCHEME_GRAMMAR[schemeType as WindfallSchemeType]
  // An unrecognised type is a schema change that outran this file. Falling
  // back to ACCUMULATING would render a plausible but wrong ledger, so the
  // caller is told it is not ready instead.
  return g || 'STAKE'
}

export function buildView(
  scheme: SchemeInput,
  cycle: CycleInput,
  contributions: ContributionInput[],
  rotation: RotationInput[],
  me: MeInput,
  now: Date = new Date()
): PassbookView | null {
  const grammar = grammarFor(scheme.schemeType)
  if (!GRAMMAR_READY[grammar]) return null

  if (grammar === 'ROTATING') {
    return buildRotatingView(scheme, cycle, contributions, rotation, me, now)
  }

  if (scheme.schemeType === 'ASSETS') {
    return buildAccumulatingView(scheme, cycle, contributions, rotation, me, now, {
      goalLabel: 'Your delivery',
      goalDetail: 'Once your unit is fully funded',
    })
  }

  return buildAccumulatingView(scheme, cycle, contributions, rotation, me, now)
}
