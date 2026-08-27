'use client'
// src/app/dashboard/groups/MobileGroceryMyPeriod.tsx
//
// One member's own view of one grocery club period, on a phone.
//
// WHY THIS EXISTS
//   MobileGroceryClubManage is the officer's screen: every member, every
//   item, every instruction, and every action behind requireGroupManager.
//   A plain member has no screen at all. They cannot see the list, cannot
//   see what they were asked to buy, cannot see what they owe or to whom,
//   and cannot report back what they spent. This is that screen.
//
// NOT A CUT-DOWN MANAGE SCREEN
//   The officer asks "where is the club up to". The member asks "what do I
//   owe, who do I hand it to, and what am I buying". Those are different
//   questions, so this is a different component rather than the same one
//   with rows filtered out. Filtering would leave officer vocabulary
//   ("confirmed pot", "solve settlement") in front of someone who has no
//   use for it.
//
// THE ARITHMETIC IS THE SCREEN
//   A member's position for a period is:
//
//       contribution due
//     + arrears carried in           (GroceryCarryForward, reason ARREARS)
//     ± change held / out of pocket  (CHANGE_HELD, OUT_OF_POCKET)
//     = amount payable               ("GroceryContribution"."amountPayable",
//                                     a STORED generated column — the server
//                                     computes it, this screen never does)
//     − value of what I was assigned to buy
//     = net position
//
//   Assigned purchases credit at the BUDGETED advance, not at what was
//   actually spent. That is deliberate: the number a member is looking at
//   when they pay must not move underneath them because someone else
//   acquitted late. Actual spend is reconciled through carry-forward into
//   the NEXT period, which is what the carry rows above are.
//
// SETTLEMENT IS PEER TO PEER
//   Netting across a club rarely leaves one member owing one other member.
//   It leaves them owing two or three people different amounts, and
//   sometimes receiving from a fourth. So "the amount to pay, and who to
//   pay" is a LIST of instructions, each with its own tick box, not a
//   single figure with a single name. Each instruction is a
//   GrocerySettlementTransfer row and carries its own state machine:
//   INSTRUCTED -> CLAIMED -> CONFIRMED, or DISPUTED.
//
// A TICK IS A CLAIM, NOT A LEDGER ENTRY
//   Marking a transfer sent records that the payer says they paid. It is
//   not proof and it does not move money. The payee confirms separately,
//   and until they do the instruction sits at CLAIMED. Two people have to
//   agree before anything is settled. The copy on the buttons says exactly
//   that, because a member who believes a tick box discharged their debt
//   will stop chasing it.
//
// TRUST
//   Every write here posts to /api/grocery/member, which resolves the
//   caller from the session and refuses any row the caller does not own.
//   This screen decides what to SHOW. It is never what decides who may
//   act, and it never sends a userId — the server already knows.
//
// ONE REQUEST
//   GET /api/grocery/member?clubId= returns everything below in one call:
//   the member's contribution, their carry rows, their assignments, their
//   transfers, the period plan, the full list and the comment thread.
//   Scoped to the current period only.
//
// DEGRADES FORWARD
//   Sections whose data is absent from the payload render nothing rather
//   than empty furniture. The comment thread in particular is optional, so
//   this screen works against a route that has not yet grown it.
//
// All sub-components are at module level. Declared inside the render they
// remount on every keystroke and steal focus mid-typing.

import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { C, S, T, TOUCH, FONT_STACK, MONEY_STYLE, money } from '@/lib/mobile/tokens'
import { APP_BOTTOM_NAV_HEIGHT } from '@/lib/mobile/passbook'

// ── Vocabulary ────────────────────────────────────────────────
// Member-facing words for machine states. The officer screen says "Pot
// confirmed"; a member wants to know whether they can still act.
const CYCLE_NOTE: Record<string, string> = {
  OPEN:     'The club is checking who has their money ready.',
  REOPENED: 'The club is checking who has their money ready.',
  FUNDED:   'The pot is confirmed. Buying is being arranged.',
  LOCKED:   'Everyone knows what they are buying.',
  SETTLED:  'Hand over your payments below.',
  CLOSED:   'This period is closed.',
}

const TRANSFER_TONE: Record<string, { text: string; bg: string; fg: string }> = {
  INSTRUCTED: { text: 'Not yet paid', bg: '#EEF2F7', fg: '#475569' },
  CLAIMED:    { text: 'You marked it sent', bg: C.amberBg, fg: C.amberText },
  CONFIRMED:  { text: 'Confirmed received', bg: C.tealBg, fg: C.tealDark },
  DISPUTED:   { text: 'Disputed', bg: C.redBg, fg: '#7F1D1D' },
  CANCELLED:  { text: 'Cancelled', bg: '#EEF2F7', fg: '#475569' },
}

// Roll-call may only be answered while the cycle is still open. Mirrored
// from the API so the screen never offers a control that returns a 409.
const ROLLCALL_OPEN = new Set(['OPEN', 'REOPENED'])

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: TOUCH.min,
  padding: `0 ${S.md}px`,
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  // 16px from the token scale. Smaller triggers iOS Safari's zoom-on-focus.
  fontSize: T.input.fontSize,
  fontFamily: FONT_STACK,
  color: C.text,
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 88,
  padding: S.md,
  lineHeight: 1.5,
  resize: 'vertical',
}

function fmtDate(v: any): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Every response goes through here rather than straight to res.json().
//
// A missing or crashed API route does not return JSON — it returns Next's
// HTML error page, and res.json() on that throws "Unexpected token '<'",
// which tells a member nothing and tells a developer only that something
// somewhere returned markup. Checking the content type first turns the two
// common causes into two different sentences.
async function readJson(res: Response): Promise<any> {
  const type = res.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    const body = await res.text().catch(() => '')
    const looksLikeHtml = body.trim().slice(0, 15).toLowerCase().includes('<!doctype')
      || body.trim().startsWith('<')
    if (res.status === 404 || looksLikeHtml) {
      throw new Error(
        'This screen cannot reach the server (/api/grocery/member). If you are testing, check the route file is named route.ts.'
      )
    }
    throw new Error(`The server returned an unexpected response (${res.status}).`)
  }
  return res.json()
}

// ── Primitives ────────────────────────────────────────────────
// Deliberately redeclared rather than imported from MobileGroceryClubManage.
// Those are private to that module, and reaching into a 2,000-line component
// to export them would mean editing a working file to add a second consumer.
// If a third screen needs them they should move to /lib/mobile, not here.

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: S.lg }}>
      <label style={{ display: 'block', fontSize: T.small.fontSize, color: C.textMuted, marginBottom: 6 }}>
        {label}
        {hint ? <span style={{ color: C.textFaint }}> · {hint}</span> : null}
      </label>
      {children}
    </div>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" style={{
      background: C.redBg, color: '#7F1D1D', borderRadius: 10,
      padding: S.md, fontSize: T.small.fontSize, lineHeight: 1.45, marginTop: S.sm,
    }}>{message}</div>
  )
}

function PrimaryButton({
  label, onClick, disabled,
}: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', minHeight: TOUCH.primary,
      background: disabled ? C.textFaint : C.teal, color: '#fff',
      border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 500,
      fontFamily: FONT_STACK, cursor: disabled ? 'default' : 'pointer',
    }}>{label}</button>
  )
}

function Sheet({
  title, onClose, disabled, footer, children,
}: {
  title: string
  onClose: () => void
  disabled?: boolean
  footer: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(13,33,55,0.5)',
      display: 'flex', alignItems: 'flex-end', fontFamily: FONT_STACK,
    }}>
      <div onClick={disabled ? undefined : onClose} style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={title} style={{
        position: 'relative', width: '100%', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
        background: C.surfaceAlt, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: S.sm, flexShrink: 0,
          padding: `${S.md}px ${S.screenX}px`, background: C.surface,
          borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{ flex: 1, fontSize: T.title.fontSize, fontWeight: 500, color: C.text }}>{title}</span>
          <button onClick={onClose} disabled={disabled} aria-label="Close" style={{
            width: TOUCH.icon, height: TOUCH.icon, marginRight: -10, background: 'transparent',
            border: 'none', color: C.textMuted, fontSize: 24, fontFamily: FONT_STACK,
            cursor: disabled ? 'default' : 'pointer',
          }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: `${S.lg}px ${S.screenX}px` }}>
          {children}
        </div>
        <div style={{
          flexShrink: 0, background: C.surface, borderTop: `1px solid ${C.border}`,
          padding: `${S.md}px ${S.screenX}px calc(${S.md}px + env(safe-area-inset-bottom, 0px))`,
        }}>
          {footer}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({
  label, hint, open, onToggle,
}: { label: string; hint?: string; open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} style={{
      width: '100%', minHeight: TOUCH.min, display: 'flex', alignItems: 'center', gap: S.sm,
      padding: `${S.md}px ${S.screenX}px`, background: C.surface,
      border: 'none', borderTop: `1px solid ${C.border}`, cursor: 'pointer',
      fontFamily: FONT_STACK, textAlign: 'left',
    }}>
      <span style={{ flex: 1, fontSize: T.heading.fontSize, fontWeight: 500, color: C.text }}>{label}</span>
      {hint ? <span style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>{hint}</span> : null}
      <span style={{
        fontSize: 18, color: C.textMuted,
        transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms',
      }}>⌄</span>
    </button>
  )
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div style={{
      padding: `${S.lg}px ${S.screenX}px`, fontSize: T.small.fontSize,
      color: C.textFaint, lineHeight: 1.5,
    }}>{text}</div>
  )
}

// ── The money card ────────────────────────────────────────────
// One row of the member's own arithmetic. Signed values are rendered with a
// true minus sign rather than a hyphen, because at 13px on a phone a hyphen
// beside a digit reads as part of the number.
function LedgerRow({
  label, value, tone, strong, rule,
}: {
  label: string
  value: string
  tone?: string
  strong?: boolean
  rule?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: S.md,
      padding: `7px 0`,
      borderTop: rule ? `1px solid rgba(255,255,255,0.18)` : 'none',
      marginTop: rule ? S.sm : 0,
      paddingTop: rule ? S.md : 7,
    }}>
      <span style={{
        fontSize: strong ? T.body.fontSize : T.small.fontSize,
        fontWeight: strong ? 500 : 400,
        color: tone || 'rgba(255,255,255,0.72)',
        flexShrink: 0,
      }}>{label}</span>
      <span style={{
        ...MONEY_STYLE,
        fontSize: strong ? 22 : 14,
        fontWeight: strong ? 600 : 400,
        color: tone || '#fff',
        textAlign: 'right', minWidth: 0,
      }}>{value}</span>
    </div>
  )
}

// The member's position for the period. Lives in the dark header band
// because it is the one thing they opened the screen to read.
function MoneyCard({ data, currency }: { data: any; currency: string }) {
  const contrib   = data?.myContribution || null
  const due       = Number(contrib?.amountDue ?? 0)
  const carry     = Number(contrib?.carryAdjustment ?? 0)
  const payable   = Number(contrib?.amountPayable ?? (due + carry))
  const paid      = Number(contrib?.amountPaid ?? 0)
  const assigned  = Number(data?.totals?.assignedToMe ?? 0)
  // Server-computed where available. The fallback exists so the card still
  // renders against an older payload, not because the client should be
  // doing this sum.
  const net       = Number(data?.totals?.netToPay ?? (payable - paid - assigned))
  const owed      = net < 0

  return (
    <div style={{
      background: 'rgba(255,255,255,0.07)', borderRadius: 14,
      padding: `${S.md}px ${S.lg}px ${S.lg}px`, marginTop: S.md,
    }}>
      <LedgerRow label="Contribution" value={money(due, currency)} />
      {carry !== 0 ? (
        <LedgerRow
          label={carry > 0 ? 'Arrears carried in' : 'Credit carried in'}
          value={`${carry > 0 ? '+' : '−'} ${money(Math.abs(carry), currency)}`}
        />
      ) : null}
      {paid !== 0 ? (
        <LedgerRow label="Already paid" value={`− ${money(paid, currency)}`} />
      ) : null}
      {assigned > 0 ? (
        <LedgerRow label="You were advanced" value={`− ${money(assigned, currency)}`} />
      ) : null}
      <LedgerRow
        label={owed ? 'The club owes you' : 'Net to pay'}
        value={money(Math.abs(net), currency)}
        strong
        rule
        tone={owed ? '#6EE7B7' : '#fff'}
      />
      {assigned > 0 ? (
        <div style={{
          fontSize: T.caption.fontSize, color: 'rgba(255,255,255,0.6)',
          lineHeight: 1.5, marginTop: S.sm,
        }}>
          You are credited what you were advanced, not what you spend. Any
          difference carries into next period.
        </div>
      ) : null}
    </div>
  )
}

// ── Settlement instruction ────────────────────────────────────
// One thing this member must do with money, or one thing owed to them.
function TransferCard({
  t, currency, busy, onClaim, onConfirm, onDispute,
}: {
  t: any
  currency: string
  busy: boolean
  onClaim: (t: any) => void
  onConfirm: (t: any) => void
  onDispute: (t: any) => void
}) {
  const st      = String(t?.status || 'INSTRUCTED').toUpperCase()
  const tone    = TRANSFER_TONE[st] || TRANSFER_TONE.INSTRUCTED
  const paying  = String(t?.direction || 'PAY').toUpperCase() === 'PAY'
  const isBank  = String(t?.payeeType || '').toUpperCase() === 'SUPPLIER'

  return (
    <div style={{
      background: C.surface, borderRadius: 12, padding: S.lg,
      marginBottom: S.sm, border: `1px solid ${C.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>
            {paying ? 'You pay' : 'You receive from'}
          </div>
          <div style={{
            fontSize: T.body.fontSize, color: C.text, fontWeight: 500, marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{t?.counterpartyName || 'The club'}</div>
        </div>
        <div style={{ ...MONEY_STYLE, fontSize: 20, color: C.text, flexShrink: 0 }}>
          {money(t?.amount, currency)}
        </div>
      </div>

      <div style={{ marginTop: S.sm, fontSize: T.caption.fontSize, color: C.textFaint, lineHeight: 1.5 }}>
        <span style={{
          background: tone.bg, color: tone.fg, padding: '2px 8px',
          borderRadius: 20, marginRight: 6,
        }}>{tone.text}</span>
        {isBank && t?.accountNumber
          ? `${t.bankName || 'Bank'} · ${t.accountNumber}`
          : (t?.reference || 'Hand to hand')}
      </div>

      {/* The payer ticks. The payee confirms. Never both on one device, and
          never the same person doing both — the whole point of the two
          states is that two people had to agree. */}
      {paying && st === 'INSTRUCTED' ? (
        <button onClick={() => onClaim(t)} disabled={busy} style={{
          width: '100%', minHeight: TOUCH.min, marginTop: S.md,
          background: C.amberBg, color: C.amberText, border: 'none', borderRadius: 10,
          fontSize: 15, fontWeight: 500, fontFamily: FONT_STACK,
          cursor: busy ? 'default' : 'pointer',
        }}>I have paid this</button>
      ) : null}

      {paying && st === 'CLAIMED' ? (
        <div style={{
          marginTop: S.md, background: C.surfaceAlt, borderRadius: 10, padding: S.md,
          fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.5,
        }}>
          Waiting for {t?.counterpartyName || 'them'} to confirm they received it.
          Marking it sent does not settle it on its own.
        </div>
      ) : null}

      {!paying && st !== 'CONFIRMED' ? (
        <button onClick={() => onConfirm(t)} disabled={busy} style={{
          width: '100%', minHeight: TOUCH.min, marginTop: S.md,
          background: C.tealBg, color: C.tealDark, border: 'none', borderRadius: 10,
          fontSize: 15, fontWeight: 500, fontFamily: FONT_STACK,
          cursor: busy ? 'default' : 'pointer',
        }}>Confirm I received it</button>
      ) : null}

      {st === 'CLAIMED' || st === 'CONFIRMED' ? (
        <button onClick={() => onDispute(t)} disabled={busy} style={{
          width: '100%', minHeight: TOUCH.min, marginTop: S.sm,
          background: 'transparent', color: C.red, border: `1px solid ${C.redBg}`,
          borderRadius: 10, fontSize: 14, fontFamily: FONT_STACK,
          cursor: busy ? 'default' : 'pointer',
        }}>Something is wrong with this</button>
      ) : null}
    </div>
  )
}

// ── One thing this member was asked to buy ────────────────────
function MyAssignmentCard({
  a, currency, onReport,
}: { a: any; currency: string; onReport: (a: any) => void }) {
  const st       = String(a?.status || 'ASSIGNED').toUpperCase()
  const done     = st === 'ACQUITTED'
  const advance  = Number(a?.advanceAmount ?? 0)
  const spent    = a?.actualSpent == null ? null : Number(a.actualSpent)
  const variance = spent == null ? null : Number((advance - spent).toFixed(2))

  return (
    <div style={{
      background: C.surface, borderRadius: 12, padding: S.lg,
      marginBottom: S.sm, border: `1px solid ${C.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md }}>
        <div style={{
          flex: 1, minWidth: 0, fontSize: T.body.fontSize, color: C.text, fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{a?.itemName || 'Item'}</div>
        <span style={{
          flexShrink: 0, fontSize: T.micro.fontSize, padding: '2px 8px', borderRadius: 20,
          background: done ? C.tealBg : C.amberBg, color: done ? C.tealDark : C.amberText,
        }}>{done ? 'Reported' : 'To buy'}</span>
      </div>

      <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 3 }}>
        {a?.qtyAssigned} {a?.unit || 'units'} · advanced {money(advance, currency)}
      </div>

      {done ? (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: S.sm,
          background: C.surfaceAlt, borderRadius: 10,
          padding: `${S.sm}px ${S.md}px`, marginTop: S.md,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>You spent</div>
            <div style={{ ...MONEY_STYLE, fontSize: 14, color: C.text }}>
              {money(spent, currency)}
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>
              {variance == null || variance === 0
                ? 'Difference'
                : variance > 0 ? 'Change you hold' : 'Club owes you'}
            </div>
            <div style={{
              ...MONEY_STYLE, fontSize: 14,
              color: variance == null || variance === 0
                ? C.teal
                : variance > 0 ? C.amberText : '#3730A3',
            }}>
              {variance == null || variance === 0 ? 'Exact' : money(Math.abs(variance), currency)}
            </div>
          </div>
        </div>
      ) : null}

      {a?.notes ? (
        <div style={{
          marginTop: S.sm, fontSize: T.caption.fontSize,
          color: C.textMuted, lineHeight: 1.5,
        }}>{a.notes}</div>
      ) : null}

      <button onClick={() => onReport(a)} style={{
        width: '100%', minHeight: TOUCH.min, marginTop: S.md,
        background: done ? 'transparent' : C.tealBg,
        color: done ? C.textMuted : C.tealDark,
        border: done ? `1px solid ${C.border}` : 'none',
        borderRadius: 10, fontSize: 15, fontWeight: 500,
        fontFamily: FONT_STACK, cursor: 'pointer',
      }}>{done ? 'Change what I reported' : 'I bought this'}</button>
    </div>
  )
}

// ── Report a purchase ─────────────────────────────────────────
// The member's own acquittal. Same action the officer screen posts, but the
// server resolves the assignment's owner from the session rather than
// trusting an id from the page.
function ReportSheet({
  assign, currency, onClose, onSaved, onError,
}: {
  assign: any
  currency: string
  onClose: () => void
  onSaved: (msg: string) => void
  onError: (msg: string) => void
}) {
  const advance = Number(assign?.advanceAmount ?? 0)
  const [spent, setSpent] = useState<string>(
    assign?.actualSpent != null ? String(assign.actualSpent) : String(advance || '')
  )
  const [note, setNote] = useState<string>(assign?.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spentNum = parseFloat(spent || '')
  const bad      = !Number.isFinite(spentNum) || spentNum < 0
  const variance = bad ? 0 : Number((advance - spentNum).toFixed(2))

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/grocery/member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ACQUIT_ASSIGNMENT',
          assignmentId: assign.id,
          actualSpent: spentNum,
          notes: note.trim() || null,
        }),
      })
      const json = await readJson(res)
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not record this.')
      onSaved(json.message || 'Thank you — recorded.')
    } catch (e: any) {
      const msg = e?.message || 'Could not record this.'
      setError(msg)
      onError(msg)
      setSaving(false)
    }
  }

  return (
    <Sheet
      title={assign?.itemName || 'Report purchase'}
      onClose={onClose}
      disabled={saving}
      footer={
        <PrimaryButton
          label={saving ? 'Recording…' : 'Record what I spent'}
          disabled={saving || bad}
          onClick={submit}
        />
      }
    >
      <div style={{
        background: C.surface, borderRadius: 10, padding: S.md,
        marginBottom: S.lg, fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
      }}>
        You were advanced <strong style={{ color: C.text }}>{money(advance, currency)}</strong> for{' '}
        {assign?.qtyAssigned} {assign?.unit || 'units'}.
      </div>

      <Field label="What you actually spent">
        <input
          type="text"
          inputMode="decimal"
          value={spent}
          onChange={e => setSpent(e.target.value)}
          style={{ ...inputStyle, textAlign: 'right' }}
        />
      </Field>

      {!bad && variance !== 0 ? (
        <div style={{
          background: variance > 0 ? C.amberBg : '#EEF2FF',
          color: variance > 0 ? C.amberText : '#3730A3',
          borderRadius: 10, padding: S.md, marginBottom: S.lg,
          fontSize: T.small.fontSize, lineHeight: 1.5,
        }}>
          {variance > 0
            ? `You are holding ${money(variance, currency)} of the club's change. It carries to next period unless the settlement asks you to pass it on.`
            : `You spent ${money(Math.abs(variance), currency)} of your own money. The club will credit it to you next period.`}
        </div>
      ) : null}

      {!bad && variance === 0 ? (
        <div style={{
          background: C.tealBg, color: C.tealDark, borderRadius: 10,
          padding: S.md, marginBottom: S.lg, fontSize: T.small.fontSize, lineHeight: 1.5,
        }}>
          Exactly the advance — nothing to carry either way.
        </div>
      ) : null}

      <Field label="Receipt note" hint="optional">
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Shop, receipt number, anything the treasurer should know"
          style={textareaStyle}
        />
      </Field>

      {error ? <ErrorNote message={error} /> : null}
    </Sheet>
  )
}

// ── Confirm a payment claim ───────────────────────────────────
// Deliberately a sheet rather than an inline tap. Confirming receipt of
// money you did not receive is not a recoverable mistake, and a reference
// field gives the pair something to reconcile against later.
function ClaimSheet({
  transfer, currency, mode, onClose, onSaved, onError,
}: {
  transfer: any
  currency: string
  mode: 'CLAIM' | 'CONFIRM' | 'DISPUTE'
  onClose: () => void
  onSaved: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disputing = mode === 'DISPUTE'
  const blocked   = disputing && reason.trim().length < 3

  const title = mode === 'CLAIM'
    ? 'Confirm you have paid'
    : mode === 'CONFIRM'
      ? 'Confirm you received it'
      : 'Raise a problem'

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const action = mode === 'CLAIM'
        ? 'CLAIM_TRANSFER'
        : mode === 'CONFIRM' ? 'CONFIRM_TRANSFER' : 'DISPUTE_TRANSFER'
      const res = await fetch('/api/grocery/member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          transferId: transfer.id,
          reference: reference.trim() || null,
          reason: reason.trim() || null,
        }),
      })
      const json = await readJson(res)
      if (!res.ok || !json?.success) throw new Error(json?.error || 'That did not work.')
      onSaved(json.message || 'Recorded.')
    } catch (e: any) {
      const msg = e?.message || 'That did not work.'
      setError(msg)
      onError(msg)
      setSaving(false)
    }
  }

  return (
    <Sheet
      title={title}
      onClose={onClose}
      disabled={saving}
      footer={
        <PrimaryButton
          label={saving ? 'Saving…' : disputing ? 'Send to the treasurer' : 'Confirm'}
          disabled={saving || blocked}
          onClick={submit}
        />
      }
    >
      <div style={{
        background: C.surface, borderRadius: 10, padding: S.md, marginBottom: S.lg,
        fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
      }}>
        <span style={{ ...MONEY_STYLE, fontSize: 18, color: C.text }}>
          {money(transfer?.amount, currency)}
        </span>
        <div style={{ marginTop: 4 }}>
          {String(transfer?.direction || 'PAY').toUpperCase() === 'PAY'
            ? `to ${transfer?.counterpartyName || 'the club'}`
            : `from ${transfer?.counterpartyName || 'the club'}`}
        </div>
      </div>

      {mode === 'CLAIM' ? (
        <>
          <Field label="Payment reference" hint="optional">
            <input
              type="text"
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="Transfer code, or leave blank if cash"
              style={inputStyle}
            />
          </Field>
          <div style={{
            background: C.surfaceAlt, borderRadius: 10, padding: S.md,
            fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
          }}>
            This records that you say you have paid. It is settled only once
            the other person confirms they received it.
          </div>
        </>
      ) : null}

      {mode === 'CONFIRM' ? (
        <div style={{
          background: C.amberBg, color: C.amberText, borderRadius: 10, padding: S.md,
          fontSize: T.small.fontSize, lineHeight: 1.5,
        }}>
          Only confirm once the money is actually in your hands or your
          account. This closes the payment and it cannot be undone from here.
        </div>
      ) : null}

      {disputing ? (
        <Field label="What is wrong?">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Nothing arrived, wrong amount, already paid in cash…"
            style={textareaStyle}
          />
        </Field>
      ) : null}

      {error ? <ErrorNote message={error} /> : null}
    </Sheet>
  )
}

// ── Simple read-only rows ─────────────────────────────────────
function PlanLine({ r, currency }: { r: any; currency: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: S.md,
      padding: `10px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: T.body.fontSize, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{r?.itemName || 'Item'}</div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 2 }}>
          {r?.qty} {r?.unit || 'units'} × {money(r?.unitPrice, currency)}
          {r?.buyerName ? ` · ${r.buyerName}` : ''}
        </div>
      </div>
      <div style={{ ...MONEY_STYLE, fontSize: 14, color: C.text, flexShrink: 0 }}>
        {money(r?.lineTotal ?? (Number(r?.qty || 0) * Number(r?.unitPrice || 0)), currency)}
      </div>
    </div>
  )
}

function ListLine({ i, currency }: { i: any; currency: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: S.md,
      padding: `10px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: T.body.fontSize, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{i?.name || 'Item'}</div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 2 }}>
          {i?.qtyPerMember} {i?.unit || 'units'} each
        </div>
      </div>
      <div style={{ ...MONEY_STYLE, fontSize: 13, color: C.textMuted, flexShrink: 0 }}>
        {money(i?.estimatedUnitPrice, currency)}
      </div>
    </div>
  )
}

function CommentLine({ c, meId }: { c: any; meId?: string }) {
  const mine = Boolean(meId) && c?.userId === meId
  return (
    <div style={{ padding: `10px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}` }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>
        {mine ? 'You' : (c?.authorName || 'Member')} · {fmtDate(c?.createdAt)}
        {String(c?.kind || '').toUpperCase() === 'RECEIPT_ACK' ? (
          <span style={{
            background: C.tealBg, color: C.tealDark, padding: '1px 6px',
            borderRadius: 20, marginLeft: 6,
          }}>Receipt</span>
        ) : null}
      </div>
      <div style={{
        fontSize: T.small.fontSize, color: C.text, lineHeight: 1.5, marginTop: 3,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>{c?.body}</div>
    </div>
  )
}

// ── Screen ────────────────────────────────────────────────────
type Props = {
  clubId: string
  onBack: () => void
  onChanged?: () => void
  // Rendered at the right of the header. The passbook container puts the
  // ledger toggle here so a member can reach their contribution history,
  // which is what this screen replaced for them.
  headerAction?: ReactNode
}

export default function MobileGroceryMyPeriod({ clubId, onBack, onChanged, headerAction }: Props) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string[]>(['settle', 'mine'])
  const [reportFor, setReportFor] = useState<any | null>(null)
  const [claimFor, setClaimFor] = useState<{ t: any; mode: 'CLAIM' | 'CONFIRM' | 'DISPUTE' } | null>(null)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/grocery/member?clubId=${encodeURIComponent(clubId)}`,
        { cache: 'no-store' }
      )
      const json = await readJson(res)
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not load your period.')
      setData(json.data)
    } catch (e: any) {
      setError(e?.message || 'Could not load your period.')
    } finally {
      setLoading(false)
    }
  }, [clubId])

  useEffect(() => { load() }, [load])

  const toggle = useCallback((key: string) => {
    setOpen(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }, [])

  const afterWrite = useCallback((msg: string) => {
    setReportFor(null)
    setClaimFor(null)
    setError(null)
    setNotice(msg)
    load()
    if (onChanged) onChanged()
  }, [load, onChanged])

  // Roll-call and comments post straight through; they have no sheet.
  const post = useCallback(async (body: any) => {
    setBusy(true)
    try {
      const res = await fetch('/api/grocery/member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await readJson(res)
      if (!res.ok || !json?.success) throw new Error(json?.error || 'That did not work.')
      afterWrite(json.message || 'Done.')
    } catch (e: any) {
      setNotice(null)
      setError(e?.message || 'That did not work.')
    } finally {
      setBusy(false)
    }
  }, [afterWrite])

  const currency    = data?.club?.currency || 'USD'
  const clubName    = data?.club?.name || 'Grocery club'
  const cycleStatus = String(data?.cycle?.status || '').toUpperCase()
  const period      = data?.cycle?.periodNumber ?? 1

  const transfers   = Array.isArray(data?.myTransfers) ? data.myTransfers : []
  const assignments = Array.isArray(data?.myAssignments) ? data.myAssignments : []
  const plan        = Array.isArray(data?.plan) ? data.plan : []
  const list        = Array.isArray(data?.list) ? data.list : []
  // Optional. A route that has not grown a comment thread yet simply omits
  // it, and the section does not render at all.
  const comments    = Array.isArray(data?.comments) ? data.comments : null

  const contrib     = data?.myContribution || null
  const outstanding = transfers.filter((t: any) => String(t?.status).toUpperCase() !== 'CONFIRMED').length
  const toReport    = assignments.filter((a: any) => String(a?.status).toUpperCase() !== 'ACQUITTED').length

  // Roll-call answer, if this member has not given one and the cycle is
  // still taking them.
  const rollOpen    = ROLLCALL_OPEN.has(cycleStatus)
  const answered    = Boolean(contrib?.fundsConfirmedAt || contrib?.fundsDeclinedAt)
  const showRoll    = rollOpen && contrib && !answered

  if (loading && !data) {
    return (
      <div style={{
        fontFamily: FONT_STACK, background: C.surfaceAlt, minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <style>{`@keyframes wfSpin{to{transform:rotate(360deg)}}`}</style>
        <div style={{
          width: 34, height: 34,
          border: `3px solid ${C.border}`, borderTopColor: C.teal,
          borderRadius: '50%', animation: 'wfSpin 0.8s linear infinite',
        }} />
      </div>
    )
  }

  return (
    <div style={{
      fontFamily: FONT_STACK, background: C.surfaceAlt, minHeight: '100vh',
      paddingBottom: APP_BOTTOM_NAV_HEIGHT,
    }}>
      {reportFor ? (
        <ReportSheet
          assign={reportFor}
          currency={currency}
          onClose={() => setReportFor(null)}
          onSaved={afterWrite}
          onError={() => { /* the sheet shows it inline; the screen stays put */ }}
        />
      ) : null}

      {claimFor ? (
        <ClaimSheet
          transfer={claimFor.t}
          mode={claimFor.mode}
          currency={currency}
          onClose={() => setClaimFor(null)}
          onSaved={afterWrite}
          onError={() => { /* shown inline in the sheet */ }}
        />
      ) : null}

      {/* Header band — identity, period, and the member's own arithmetic */}
      <div style={{ background: C.navy, padding: `10px ${S.screenX}px ${S.lg}px` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm }}>
          <button
            onClick={onBack}
            aria-label="Back"
            style={{
              width: TOUCH.icon, height: TOUCH.icon, marginLeft: -12,
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.8)', fontSize: 22,
              fontFamily: FONT_STACK, cursor: 'pointer',
            }}
          >←</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: T.title.fontSize, fontWeight: 500, color: '#fff',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{clubName}</div>
            <div style={{ fontSize: T.caption.fontSize, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
              Period {period}
              {contrib?.dueDate ? ` · due ${fmtDate(contrib.dueDate)}` : ''}
            </div>
          </div>
          {headerAction}
        </div>

        {contrib ? <MoneyCard data={data} currency={currency} /> : null}

        {CYCLE_NOTE[cycleStatus] ? (
          <div style={{
            fontSize: T.caption.fontSize, color: 'rgba(255,255,255,0.6)',
            marginTop: S.md, lineHeight: 1.5,
          }}>{CYCLE_NOTE[cycleStatus]}</div>
        ) : null}
      </div>

      {notice ? (
        <div style={{
          background: C.tealBg, color: C.tealDark,
          padding: `${S.md}px ${S.screenX}px`, fontSize: T.small.fontSize, lineHeight: 1.45,
        }}>{notice}</div>
      ) : null}

      {error ? (
        <div style={{ padding: `${S.md}px ${S.screenX}px` }}>
          <ErrorNote message={error} />
        </div>
      ) : null}

      {/* Roll-call. Asked once, only while the cycle is taking answers. */}
      {showRoll ? (
        <div style={{
          background: C.surface, margin: `${S.md}px ${S.screenX}px`,
          borderRadius: 12, padding: S.lg, border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: T.body.fontSize, color: C.text, fontWeight: 500 }}>
            Do you have your contribution ready?
          </div>
          <div style={{
            fontSize: T.caption.fontSize, color: C.textFaint,
            marginTop: 4, lineHeight: 1.5,
          }}>
            This is not a payment. The club is counting how much cash it can
            plan around this period.
          </div>
          <div style={{ display: 'flex', gap: S.sm, marginTop: S.md }}>
            <button
              onClick={() => post({ action: 'CONFIRM_FUNDS' })}
              disabled={busy}
              style={{
                flex: 1, minHeight: TOUCH.min, background: C.tealBg, color: C.tealDark,
                border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 500,
                fontFamily: FONT_STACK, cursor: busy ? 'default' : 'pointer',
              }}
            >Yes, ready</button>
            <button
              onClick={() => post({ action: 'DECLINE_FUNDS' })}
              disabled={busy}
              style={{
                flex: 1, minHeight: TOUCH.min, background: C.surface, color: C.textMuted,
                border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 15,
                fontFamily: FONT_STACK, cursor: busy ? 'default' : 'pointer',
              }}
            >Not this time</button>
          </div>
        </div>
      ) : null}

      {/* What I must do with money */}
      <SectionHeader
        label="Payments"
        hint={outstanding > 0 ? `${outstanding} outstanding` : 'All settled'}
        open={open.includes('settle')}
        onToggle={() => toggle('settle')}
      />
      {open.includes('settle') ? (
        transfers.length === 0 ? (
          <EmptyNote text="Nothing to pay yet. Once the club works out who owes whom, your instructions appear here." />
        ) : (
          <div style={{ padding: `${S.md}px ${S.screenX}px` }}>
            {transfers.map((t: any) => (
              <TransferCard
                key={t.id}
                t={t}
                currency={currency}
                busy={busy}
                onClaim={x => setClaimFor({ t: x, mode: 'CLAIM' })}
                onConfirm={x => setClaimFor({ t: x, mode: 'CONFIRM' })}
                onDispute={x => setClaimFor({ t: x, mode: 'DISPUTE' })}
              />
            ))}
          </div>
        )
      ) : null}

      {/* What I was asked to buy */}
      <SectionHeader
        label="What you are buying"
        hint={assignments.length === 0 ? 'Nothing' : toReport > 0 ? `${toReport} to report` : 'All reported'}
        open={open.includes('mine')}
        onToggle={() => toggle('mine')}
      />
      {open.includes('mine') ? (
        assignments.length === 0 ? (
          <EmptyNote text="You have not been asked to buy anything this period." />
        ) : (
          <div style={{ padding: `${S.md}px ${S.screenX}px` }}>
            {assignments.map((a: any) => (
              <MyAssignmentCard
                key={a.id}
                a={a}
                currency={currency}
                onReport={setReportFor}
              />
            ))}
          </div>
        )
      ) : null}

      {/* What the club is buying this period */}
      <SectionHeader
        label="This period's shopping"
        hint={plan.length ? `${plan.length} line${plan.length === 1 ? '' : 's'}` : undefined}
        open={open.includes('plan')}
        onToggle={() => toggle('plan')}
      />
      {open.includes('plan') ? (
        plan.length === 0 ? (
          <EmptyNote text="The club has not set this period's shopping yet." />
        ) : (
          <div>
            {plan.map((r: any) => (
              <PlanLine key={r.itemId || r.id} r={r} currency={currency} />
            ))}
          </div>
        )
      ) : null}

      {/* The standing list */}
      <SectionHeader
        label="The grocery list"
        hint={list.length ? `${list.length} item${list.length === 1 ? '' : 's'}` : undefined}
        open={open.includes('list')}
        onToggle={() => toggle('list')}
      />
      {open.includes('list') ? (
        list.length === 0 ? (
          <EmptyNote text="No items on the list yet." />
        ) : (
          <div>
            {list.map((i: any) => (
              <ListLine key={i.id} i={i} currency={currency} />
            ))}
          </div>
        )
      ) : null}

      {/* Optional thread. Absent from the payload means absent from the UI. */}
      {comments ? (
        <>
          <SectionHeader
            label="Messages"
            hint={comments.length ? String(comments.length) : undefined}
            open={open.includes('talk')}
            onToggle={() => toggle('talk')}
          />
          {open.includes('talk') ? (
            <div>
              {comments.length === 0 ? (
                <EmptyNote text="Nothing here yet. Use this to flag a receipt or ask the treasurer a question." />
              ) : (
                comments.map((c: any) => (
                  <CommentLine key={c.id} c={c} meId={data?.me?.userId} />
                ))
              )}
              <div style={{ padding: `${S.md}px ${S.screenX}px ${S.xl}px` }}>
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder="Message the treasurer about this period"
                  style={textareaStyle}
                />
                <div style={{ marginTop: S.sm }}>
                  <PrimaryButton
                    label={busy ? 'Sending…' : 'Send'}
                    disabled={busy || draft.trim().length < 2}
                    onClick={() => {
                      const body = draft.trim()
                      setDraft('')
                      post({ action: 'COMMENT', body })
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <div style={{ height: S.xxl }} />
    </div>
  )
}
