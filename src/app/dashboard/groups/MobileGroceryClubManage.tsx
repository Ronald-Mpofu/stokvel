'use client'
// src/app/dashboard/groups/MobileGroceryClubManage.tsx
//
// Set up and run one grocery club from a phone.
//
// WHY THIS EXISTS
//   A club created on mobile could not previously leave SETUP. Activation
//   needs at least one member AND at least one item, and there was no way
//   to add an item from a phone — so the club sat in setup forever and its
//   passbook stayed permanently empty. This is the screen that unblocks it.
//
// SCOPE — phase 1 of 3
//   Items, members, club details, activation, plus (new) an at-a-glance
//   Summary, the contribution register, and Mark all distributed.
//
//   Everything the new sections render already arrives in the single
//   GET /api/grocery?clubId= this screen has always made — cycles,
//   contributions, periodPurchases, assignments and settlementTransfers
//   are all in that payload and were previously discarded. So three more
//   sections cost no extra request and no extra round trip.
//
//   Phase 2 adds the first two cycle stages: Period purchases (what the
//   club is buying this meeting, at what price) and Roll-call (who has
//   their money in hand). Both are editable lists with a dirty-state save
//   bar, and both are gated on cycle status exactly as the API gates them
//   — OPEN or REOPENED and no later.
//
//   Phase 3 adds the last two stages: Assignments (who is buying what, and
//   how much cash they are advanced) and Settlement (who hands money to
//   whom). Receipt IMAGE capture remains desktop-only — acquittal here
//   records the amount spent, not a photograph of the till slip.
//
// ADVANCES LEAVE THE CLUB'S HANDS
//   An advance is cash handed to a named member or paid into a named
//   supplier account. The club holds nothing. So the assign sheet is
//   capped by uncommitted cash, and an acquittal that comes back under the
//   advance leaves the member holding change the settlement must place.
//
// A TICK IS NOT A PAYMENT
//   The roll-call records whether a member physically HAS the money, not
//   that they have handed it over. Nothing here moves cash. Closing the
//   roll-call locks the confirmed pot and carries declines forward as
//   arrears — that is the only thing that writes.
//
// TRUST
//   Every action here is a POST to /api/grocery, and that route guards
//   every branch with requireGroupManager. This screen decides what to
//   SHOW; it is never what decides who may act.
//
// ONE REQUEST
//   GET /api/grocery?clubId= already returns club, items, members and
//   contributions in a single parallelised call. The group roster is the
//   one thing it does not carry, so that is fetched lazily — only when the
//   admin opens the member picker, and only once per session.
//
// All sub-components are at module level. Declared inside the render they
// remount on every keystroke and steal focus mid-typing.

import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { C, S, T, TOUCH, FONT_STACK, MONEY_STYLE, money } from '@/lib/mobile/tokens'
import { APP_BOTTOM_NAV_HEIGHT } from '@/lib/mobile/passbook'

const STATUS_LABEL: Record<string, string> = {
  SETUP:       'Being set up',
  ACTIVE:      'Collecting',
  PURCHASING:  'Buying',
  DISTRIBUTED: 'Handed over',
  CLOSED:      'Closed',
  CANCELLED:   'Cancelled',
}

// A contribution's standing, in one place. Overdue outranks the stored
// status: a PENDING row past its due date is a debt, and colouring it the
// same neutral grey as one that is merely not due yet hides that.
function contribTone(c: any): { label: string; bg: string; fg: string } {
  if (String(c?.status).toUpperCase() === 'PAID') return { label: 'Paid',    bg: C.tealBg,  fg: C.tealDark }
  if (c?.isOverdue)                               return { label: 'Overdue', bg: C.redBg,   fg: '#7F1D1D' }
  return { label: 'Due', bg: '#EEF2F7', fg: '#475569' }
}

// What each cycle status means to someone standing in the meeting. Kept in
// the same words the desktop uses so a treasurer moving between the two is
// not learning a second vocabulary.
const CYCLE_LABEL: Record<string, string> = {
  OPEN:     'Roll-call open',
  REOPENED: 'Roll-call reopened',
  FUNDED:   'Pot confirmed',
  LOCKED:   'Assignments locked',
  SETTLED:  'Settled',
  CLOSED:   'Closed',
}

// Settlement transfer states, in the words a member would use. The machine
// itself lives in handleTransferState: INSTRUCTED → CLAIMED → CONFIRMED,
// with DISPUTED reachable from either of the last two.
const TRANSFER_LABEL: Record<string, { text: string; bg: string; fg: string }> = {
  INSTRUCTED: { text: 'To pay',    bg: '#EEF2F7', fg: '#475569' },
  CLAIMED:    { text: 'Sent',      bg: C.amberBg, fg: C.amberText },
  CONFIRMED:  { text: 'Received',  bg: C.tealBg,  fg: C.tealDark },
  DISPUTED:   { text: 'Disputed',  bg: C.redBg,   fg: '#7F1D1D' },
}

// The API accepts plan and roll-call edits only while the cycle is OPEN or
// REOPENED. Mirrored here so the UI never offers a control that would come
// back a 409 — an admin should not learn a rule from an error toast.
const CYCLE_EDITABLE = new Set(['OPEN', 'REOPENED'])

// Statuses during which the roster and item list may still be edited.
// After buying starts, changing an item would move the budget under
// contributions members have already paid against.
const EDITABLE = new Set(['SETUP', 'ACTIVE'])

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

function BusyOverlay({ label }: { label: string }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(13,33,55,0.55)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: S.lg,
    }}>
      <style>{`@keyframes wfSpin{to{transform:rotate(360deg)}}`}</style>
      <div style={{
        background: C.surface, borderRadius: 16, padding: `${S.xxl}px ${S.xl}px`,
        minWidth: 240, maxWidth: 340, textAlign: 'center',
      }}>
        <div style={{
          width: 34, height: 34, margin: `0 auto ${S.md}px`,
          border: `3px solid ${C.border}`, borderTopColor: C.teal,
          borderRadius: '50%', animation: 'wfSpin 0.8s linear infinite',
        }} />
        <div style={{ fontSize: T.body.fontSize, fontWeight: 500, color: C.text, marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>
          {elapsed < 3 ? 'Please wait…' : `${elapsed}s elapsed — keep this window open.`}
        </div>
      </div>
    </div>
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

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" style={{
      background: C.redBg, color: '#7F1D1D', borderRadius: 10,
      padding: S.md, fontSize: T.small.fontSize, lineHeight: 1.45, marginTop: S.sm,
    }}>{message}</div>
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

// ── Item sheet ────────────────────────────────────────────────
// Field names match the desktop ItemModal exactly, because both post to
// the same itemSchema. totalQty and estimatedTotalPrice are NOT sent — the
// route computes them from the live member count, which is the only count
// that can be trusted at write time.
const EMPTY_ITEM = {
  name: '', description: '', unit: 'units',
  qtyPerMember: '1', estimatedUnitPrice: '',
  supplierName: '', supplierContact: '', notes: '',
}

function ItemSheet({
  clubId, item, memberCount, currency, onClose, onSaved,
}: {
  clubId: string
  item: any | null
  memberCount: number
  currency: string
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const editing = Boolean(item)
  const [form, setForm] = useState({
    ...EMPTY_ITEM,
    name: item?.name || '',
    description: item?.description || '',
    unit: item?.unit || 'units',
    qtyPerMember: item?.qtyPerMember != null ? String(item.qtyPerMember) : '1',
    estimatedUnitPrice: item?.estimatedUnitPrice != null ? String(item.estimatedUnitPrice) : '',
    supplierName: item?.supplierName || '',
    supplierContact: item?.supplierContact || '',
    notes: item?.notes || '',
  })
  const [more, setMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }))

  const qty = parseFloat(form.qtyPerMember || '0') || 0
  const unitPrice = parseFloat(form.estimatedUnitPrice || '0') || 0
  const totalQty = qty * memberCount
  const estTotal = unitPrice * totalQty

  const submit = useCallback(async () => {
    if (!form.name.trim()) { setError('Give the item a name.'); return }
    if (!(qty > 0)) { setError('Quantity per member must be more than zero.'); return }
    if (!(unitPrice >= 0) || form.estimatedUnitPrice === '') {
      setError('Enter an estimated price for one unit.'); return
    }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/grocery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: editing ? 'UPDATE_ITEM' : 'ADD_ITEM',
          clubId, itemId: item?.id,
          ...form,
          qtyPerMember: qty,
          estimatedUnitPrice: unitPrice,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not save the item.')
      onSaved(json.message || (editing ? 'Item updated.' : 'Item added.'))
    } catch (e: any) {
      setError(e?.message || 'Could not save the item.')
    } finally { setSaving(false) }
  }, [form, qty, unitPrice, editing, clubId, item, onSaved])

  return (
    <Sheet
      title={editing ? 'Edit item' : 'Add grocery item'}
      onClose={onClose}
      disabled={saving}
      footer={<PrimaryButton label={saving ? 'Saving…' : editing ? 'Save item' : 'Add item'} onClick={submit} disabled={saving} />}
    >
      <Field label="Item">
        <input value={form.name} onChange={e => set('name')(e.target.value)}
          placeholder="e.g. Mealie meal 10kg" autoFocus style={inputStyle} />
      </Field>

      <div style={{ display: 'flex', gap: S.md }}>
        <div style={{ flex: 1 }}>
          <Field label="Qty each">
            <input type="number" inputMode="decimal" step="0.5" min="0.5"
              value={form.qtyPerMember} onChange={e => set('qtyPerMember')(e.target.value)} style={inputStyle} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Unit">
            <input value={form.unit} onChange={e => set('unit')(e.target.value)}
              placeholder="units" style={inputStyle} />
          </Field>
        </div>
      </div>

      <Field label="Estimated price" hint="per unit">
        <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00"
          value={form.estimatedUnitPrice} onChange={e => set('estimatedUnitPrice')(e.target.value)} style={inputStyle} />
      </Field>

      {/* The arithmetic the admin is actually doing in their head. Shown
          live so a mis-typed price is caught before it lands in the budget. */}
      <div style={{
        background: C.tealBg, borderRadius: 10, padding: S.md,
        fontSize: T.small.fontSize, color: C.tealDark, lineHeight: 1.5,
      }}>
        {memberCount} member{memberCount === 1 ? '' : 's'} × {qty || 0} = <strong>{totalQty || 0} {form.unit || 'units'}</strong>
        <div style={{ ...MONEY_STYLE, marginTop: 2 }}>
          Estimated total <strong>{money(estTotal, currency)}</strong>
        </div>
      </div>

      <button type="button" onClick={() => setMore(v => !v)} style={{
        width: '100%', minHeight: TOUCH.min, marginTop: S.sm, background: 'transparent',
        border: 'none', borderTop: `1px solid ${C.border}`, color: C.teal,
        fontSize: T.small.fontSize, fontFamily: FONT_STACK, cursor: 'pointer', textAlign: 'left',
      }}>{more ? 'Fewer options' : 'Supplier and notes'}</button>

      {more ? (
        <div style={{ paddingTop: S.md }}>
          <Field label="Supplier" hint="optional">
            <input value={form.supplierName} onChange={e => set('supplierName')(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Supplier contact" hint="optional">
            <input value={form.supplierContact} onChange={e => set('supplierContact')(e.target.value)}
              inputMode="tel" style={inputStyle} />
          </Field>
          <Field label="Notes" hint="optional">
            <textarea value={form.notes} onChange={e => set('notes')(e.target.value)} rows={3}
              style={{ ...inputStyle, minHeight: 80, padding: S.md, resize: 'vertical' }} />
          </Field>
        </div>
      ) : null}

      {error ? <ErrorNote message={error} /> : null}
    </Sheet>
  )
}

// ── Member picker ─────────────────────────────────────────────
function MemberPicker({
  clubId, groupId, existingIds, onClose, onSaved,
}: {
  clubId: string
  groupId: string
  existingIds: Set<string>
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const [roster, setRoster] = useState<{ userId: string; fullName: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/members?groupId=${encodeURIComponent(groupId)}`, { cache: 'no-store' })
        const json = await res.json()
        const raw = Array.isArray(json?.data) ? json.data : (json?.data?.members || [])
        if (cancelled) return
        setRoster(
          raw
            .map((m: any) => ({
              userId: m.userId || m.id,
              fullName: m.fullName || m.name || 'Member',
            }))
            .filter((m: any) => m.userId && !existingIds.has(m.userId))
        )
      } catch {
        if (!cancelled) setError('Could not load the group roster.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [groupId, existingIds])

  const toggle = useCallback((id: string) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const submit = useCallback(async () => {
    if (picked.size === 0) { onClose(); return }
    setSaving(true); setError(null)
    try {
      // ADD_MEMBER takes one user. Sent in parallel rather than in a loop:
      // sequential awaits here would cost one Tokyo round trip per member.
      const results = await Promise.all(
        Array.from(picked).map(userId =>
          fetch('/api/grocery', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ADD_MEMBER', clubId, userId }),
          }).then(r => r.json()).catch(() => ({ success: false }))
        )
      )
      const added = results.filter(r => r?.success).length
      if (added === 0) throw new Error('Could not add anyone. Please try again.')
      onSaved(`${added} member${added === 1 ? '' : 's'} added to the club.`)
    } catch (e: any) {
      setError(e?.message || 'Could not add members.')
    } finally { setSaving(false) }
  }, [picked, clubId, onClose, onSaved])

  return (
    <Sheet
      title="Add members"
      onClose={onClose}
      disabled={saving}
      footer={
        <PrimaryButton
          label={saving ? 'Adding…' : picked.size ? `Add ${picked.size}` : 'Done'}
          onClick={submit}
          disabled={saving}
        />
      }
    >
      {loading ? (
        <div style={{ color: C.textFaint, fontSize: T.small.fontSize, padding: `${S.xl}px 0` }}>Loading…</div>
      ) : roster.length === 0 ? (
        <p style={{ fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5, margin: 0 }}>
          Everyone in this group is already in the club.
        </p>
      ) : (
        roster.map(m => {
          const on = picked.has(m.userId)
          return (
            <button key={m.userId} onClick={() => toggle(m.userId)} style={{
              display: 'flex', alignItems: 'center', gap: S.md, width: '100%',
              minHeight: TOUCH.min, padding: `${S.sm}px 0`, background: 'transparent',
              border: 'none', borderBottom: `1px solid ${C.borderLight}`,
              cursor: 'pointer', fontFamily: FONT_STACK, textAlign: 'left',
            }}>
              <span aria-hidden="true" style={{
                width: 24, height: 24, flexShrink: 0, borderRadius: 6,
                border: `2px solid ${on ? C.teal : C.border}`,
                background: on ? C.teal : 'transparent', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
              }}>{on ? '✓' : ''}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: T.body.fontSize, color: C.text }}>
                {m.fullName}
              </span>
            </button>
          )
        })
      )}
      {error ? <ErrorNote message={error} /> : null}
    </Sheet>
  )
}

// ── Details sheet ─────────────────────────────────────────────
// UPDATE_CLUB writes name unconditionally and the column is NOT NULL, so
// this always sends the full set — never a partial patch.
function DetailsSheet({
  club, onClose, onSaved,
}: { club: any; onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState(club?.name || '')
  const [description, setDescription] = useState(club?.description || '')
  const [notes, setNotes] = useState(club?.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (name.trim().length < 2) { setError('The club needs a name.'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/grocery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_CLUB',
          clubId: club.id,
          name: name.trim(),
          description: description.trim() || null,
          coordinatorId: club.coordinatorId || null,
          surplusNotes: club.surplusNotes || null,
          notes: notes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not save.')
      onSaved(json.message || 'Club updated.')
    } catch (e: any) {
      setError(e?.message || 'Could not save.')
    } finally { setSaving(false) }
  }, [name, description, notes, club, onSaved])

  return (
    <Sheet
      title="Club details"
      onClose={onClose}
      disabled={saving}
      footer={<PrimaryButton label={saving ? 'Saving…' : 'Save'} onClick={submit} disabled={saving} />}
    >
      <Field label="Club name">
        <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Description" hint="optional">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
          style={{ ...inputStyle, minHeight: 80, padding: S.md, resize: 'vertical' }} />
      </Field>
      <Field label="Notes" hint="optional">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          style={{ ...inputStyle, minHeight: 80, padding: S.md, resize: 'vertical' }} />
      </Field>
      <p style={{ fontSize: T.caption.fontSize, color: C.textFaint, lineHeight: 1.5, margin: 0 }}>
        The contribution schedule and dates are set when the club is activated
        and cannot be changed here.
      </p>
      {error ? <ErrorNote message={error} /> : null}
    </Sheet>
  )
}

// ── Assignment sheets ─────────────────────────────────────────
//
// Hands one item to one member with an advance. Mirrors the desktop modal's
// rules exactly: quantity cannot exceed what is unassigned, and the advance
// cannot exceed the club's uncommitted cash — the money is leaving to a
// named person, so there is nothing to overdraw against.
function AssignSheet({
  item, members, clubId, available, existing, periodNumber, suppliers, currency, onClose, onSaved,
}: any) {
  const mine      = existing || null
  // An existing assignment's own quantity is not "taken" from itself when
  // it is being edited, so it is added back to the headroom.
  const remaining = Number(item.qtyUnassigned ?? item.totalQty) + Number(mine?.qtyAssigned || 0)
  const headroom  = Number(available || 0) + Number(mine?.advanceAmount || 0)

  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<string>(mine?.userId || '')
  const [qty, setQty]       = useState<string>(String(mine?.qtyAssigned || remaining || ''))
  const [advance, setAdv]   = useState<string>(String(mine?.advanceAmount || ''))
  const [touched, setTouched] = useState(Boolean(mine))
  const [mode, setMode]     = useState<string>(mine?.fundingMode || 'MEMBER_CASH')
  const [supplier, setSup]  = useState<string>(mine?.supplierAccountId || '')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const qtyNum = parseFloat(qty || '0')
  const advNum = parseFloat(advance || '0')
  // The advance follows the estimate until the admin types their own figure,
  // then stops moving — otherwise editing quantity would silently overwrite
  // a number they deliberately chose.
  const suggested = Number((qtyNum * Number(item.estimatedUnitPrice || 0)).toFixed(2))
  const effAdv    = touched ? advNum : suggested

  const qtyBad = !(qtyNum > 0) || qtyNum > remaining + 0.0001
  const advBad = !(effAdv >= 0) || effAdv > headroom + 0.0001
  const supBad = mode === 'SUPPLIER_DIRECT' && !supplier
  const blocked = saving || !picked || qtyBad || advBad || supBad

  const term = search.trim().toLowerCase()
  const visible = term
    ? members.filter((m: any) => (m.fullName || '').toLowerCase().includes(term))
    : members

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/grocery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ASSIGN_ITEM', clubId, itemId: item.id,
          assignedToId: picked, qtyAssigned: qtyNum, advanceAmount: effAdv,
          periodNumber: periodNumber || 1, fundingMode: mode,
          supplierAccountId: mode === 'SUPPLIER_DIRECT' ? supplier : null,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not assign this item.')
      onSaved(json.message || 'Item assigned.')
    } catch (e: any) {
      setError(e?.message || 'Could not assign this item.')
      setSaving(false)
    }
  }

  return (
    <Sheet
      title={`Assign ${item.name}`}
      onClose={onClose}
      disabled={saving}
      footer={<PrimaryButton label={saving ? 'Assigning…' : 'Assign item'} disabled={blocked} onClick={submit} />}
    >
      <Field label="Who is buying it">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search members" style={inputStyle}
        />
        <div style={{ marginTop: S.sm, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          {visible.length === 0 ? (
            <p style={{ fontSize: T.small.fontSize, color: C.textMuted, margin: 0, padding: S.md }}>
              No members match.
            </p>
          ) : visible.map((m: any) => (
            <button
              key={m.userId}
              onClick={() => setPicked(m.userId)}
              style={{
                display: 'flex', alignItems: 'center', gap: S.md, width: '100%',
                minHeight: TOUCH.min, padding: `10px ${S.md}px`, textAlign: 'left',
                background: picked === m.userId ? C.tealBg : C.surface,
                border: 'none', borderTop: `1px solid ${C.borderLight}`,
                cursor: 'pointer', fontFamily: FONT_STACK,
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${picked === m.userId ? C.teal : C.border}`,
                background: picked === m.userId ? C.teal : 'transparent',
                color: '#fff', fontSize: 13, lineHeight: '19px', textAlign: 'center',
              }}>{picked === m.userId ? '✓' : ''}</span>
              <span style={{
                flex: 1, minWidth: 0, fontSize: T.body.fontSize, color: C.text,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{m.fullName || 'Member'}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Quantity" hint={`${remaining} ${item.unit} unassigned`}>
        <input
          type="text" inputMode="decimal" value={qty}
          onChange={e => setQty(e.target.value)}
          style={{ ...inputStyle, textAlign: 'right' }}
        />
        {qtyBad && qty ? <ErrorNote message={`Enter between 0 and ${remaining} ${item.unit}.`} /> : null}
      </Field>

      <Field label="Cash advance" hint={`${money(headroom, currency)} uncommitted`}>
        <input
          type="text" inputMode="decimal"
          value={touched ? advance : String(suggested)}
          onChange={e => { setTouched(true); setAdv(e.target.value) }}
          style={{ ...inputStyle, textAlign: 'right' }}
        />
        {advBad ? (
          <ErrorNote message={`The club has ${money(headroom, currency)} uncommitted. An advance cannot exceed it.`} />
        ) : null}
      </Field>

      <Field label="Where the money goes">
        <div style={{ display: 'flex', gap: S.sm }}>
          {[['MEMBER_CASH', 'To the member'], ['SUPPLIER_DIRECT', 'To a supplier']].map(([v, label]) => (
            <button
              key={v} onClick={() => setMode(v)}
              style={{
                flex: 1, minHeight: TOUCH.min, borderRadius: 10, fontSize: 14,
                fontFamily: FONT_STACK, cursor: 'pointer',
                border: `1.5px solid ${mode === v ? C.teal : C.border}`,
                background: mode === v ? C.tealBg : C.surface,
                color: mode === v ? C.tealDark : C.textMuted,
              }}
            >{label}</button>
          ))}
        </div>
      </Field>

      {mode === 'SUPPLIER_DIRECT' ? (
        <Field label="Supplier account">
          {suppliers.length === 0 ? (
            <p style={{ fontSize: T.small.fontSize, color: C.textMuted, margin: 0, lineHeight: 1.5 }}>
              No supplier accounts are set up for this club yet. Add one on the desktop, or pay the member instead.
            </p>
          ) : (
            <select value={supplier} onChange={e => setSup(e.target.value)} style={inputStyle}>
              <option value="">Choose an account…</option>
              {suppliers.map((x: any) => (
                <option key={x.id} value={x.id}>{x.supplierName} · {x.bankName || 'bank'}</option>
              ))}
            </select>
          )}
        </Field>
      ) : null}

      {error ? <ErrorNote message={error} /> : null}
    </Sheet>
  )
}

// Records what was actually spent against an advance. The difference is the
// whole point: over means the member is out of pocket, under means they are
// holding the club's change, and settlement places both.
function AcquitSheet({ assign, clubId, currency, onClose, onSaved }: any) {
  const [spent, setSpent] = useState<string>(String(assign.actualSpent ?? assign.advanceAmount ?? ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spentNum = parseFloat(spent || '0')
  const bad      = !Number.isFinite(spentNum) || spentNum < 0
  const variance = Number((Number(assign.advanceAmount || 0) - spentNum).toFixed(2))

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/grocery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ACQUIT_ASSIGNMENT', clubId, assignmentId: assign.id, actualSpent: spentNum }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not record this.')
      onSaved(json.message || 'Acquitted.')
    } catch (e: any) {
      setError(e?.message || 'Could not record this.')
      setSaving(false)
    }
  }

  return (
    <Sheet
      title={`Acquit ${assign.itemName}`}
      onClose={onClose}
      disabled={saving}
      footer={<PrimaryButton label={saving ? 'Recording…' : 'Record spend'} disabled={saving || bad} onClick={submit} />}
    >
      <StatLine label="Bought by"  value={assign.memberName || 'Member'} />
      <StatLine label="Advanced"   value={money(assign.advanceAmount, currency)} />

      <div style={{ marginTop: S.lg }}>
        <Field label="Actually spent">
          <input
            type="text" inputMode="decimal" value={spent}
            onChange={e => setSpent(e.target.value)}
            style={{ ...inputStyle, textAlign: 'right' }}
          />
        </Field>
      </div>

      {!bad && variance !== 0 ? (
        <div style={{
          background: variance > 0 ? C.amberBg : '#EEF2FF',
          color: variance > 0 ? C.amberText : '#3730A3',
          borderRadius: 10, padding: S.md, fontSize: T.small.fontSize, lineHeight: 1.5,
        }}>
          {variance > 0
            ? `${assign.memberName || 'They'} is holding ${money(variance, currency)} of the club's change. Settlement will tell them who to pass it to.`
            : `The club owes ${assign.memberName || 'them'} ${money(Math.abs(variance), currency)} — they spent more than they were advanced.`}
        </div>
      ) : null}

      {error ? <ErrorNote message={error} /> : null}
    </Sheet>
  )
}

// ── Rows ──────────────────────────────────────────────────────
function ItemRow({
  item, currency, editable, onEdit, onDelete,
}: {
  item: any
  currency: string
  editable: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: S.md,
      padding: `11px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}`,
      minHeight: TOUCH.min,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: T.body.fontSize, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{item.name}</div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 2 }}>
          {item.qtyPerMember} {item.unit} each · {money(item.estimatedUnitPrice, currency)} per {item.unit}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ ...MONEY_STYLE, fontSize: 14, color: C.text }}>
          {money(item.estimatedTotalPrice, currency)}
        </div>
      </div>
      {editable ? (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={onEdit} aria-label={`Edit ${item.name}`} style={{
            width: TOUCH.icon, height: TOUCH.icon, background: 'transparent',
            border: 'none', color: C.teal, fontSize: 16, cursor: 'pointer', fontFamily: FONT_STACK,
          }}>✎</button>
          <button onClick={onDelete} aria-label={`Remove ${item.name}`} style={{
            width: TOUCH.icon, height: TOUCH.icon, background: 'transparent',
            border: 'none', color: C.red, fontSize: 18, cursor: 'pointer', fontFamily: FONT_STACK,
          }}>×</button>
        </div>
      ) : null}
    </div>
  )
}

function MemberRow({
  member, currency, editable, onRemove,
}: { member: any; currency: string; editable: boolean; onRemove: () => void }) {
  const name = member.fullName || 'Member'
  const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: S.md,
      padding: `11px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}`,
      minHeight: TOUCH.min,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%', background: C.tealBg, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: T.caption.fontSize, fontWeight: 500, color: C.tealDark,
      }}>{initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: T.body.fontSize, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name}</div>
        <div style={{ ...MONEY_STYLE, fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 2 }}>
          {money(member.totalContributed, currency)} paid in
        </div>
      </div>
      {editable ? (
        <button onClick={onRemove} aria-label={`Remove ${name}`} style={{
          width: TOUCH.icon, height: TOUCH.icon, flexShrink: 0, background: 'transparent',
          border: 'none', color: C.red, fontSize: 18, cursor: 'pointer', fontFamily: FONT_STACK,
        }}>×</button>
      ) : null}
    </div>
  )
}

// A label/value pair. The whole summary is built from these rather than a
// grid: at 360px a two-column grid gives each cell ~150px, and
// "Contribution per member" over a formatted amount does not fit that.
function StatLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: S.md, padding: `9px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}`,
    }}>
      <span style={{ fontSize: T.small.fontSize, color: C.textMuted, flexShrink: 0 }}>{label}</span>
      <span style={{ ...MONEY_STYLE, fontSize: 14, color: tone || C.text, textAlign: 'right', minWidth: 0 }}>
        {value}
      </span>
    </div>
  )
}

// Four counts across is 90px a tile at 360px, and "Distributed" alone needs
// most of that. Two by two instead.
function ItemStatusGrid({ items }: { items: any[] }) {
  const count = (st: string) => items.filter((i: any) => String(i.status).toUpperCase() === st).length
  const tiles = [
    { label: 'To buy',      n: count('PENDING'),     fg: C.textMuted },
    { label: 'Assigned',    n: count('ASSIGNED'),    fg: C.amberText },
    { label: 'Bought',      n: count('PURCHASED'),   fg: C.tealDark },
    { label: 'Distributed', n: count('DISTRIBUTED'), fg: C.teal },
  ]
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: S.sm,
      padding: `${S.md}px ${S.screenX}px`,
    }}>
      {tiles.map(t => (
        <div key={t.label} style={{
          background: C.surfaceAlt, borderRadius: 10, padding: `${S.sm}px ${S.md}px`, minWidth: 0,
        }}>
          <div style={{ ...MONEY_STYLE, fontSize: 20, color: t.fg }}>{t.n}</div>
          <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 1 }}>{t.label}</div>
        </div>
      ))}
    </div>
  )
}

// One member's contribution for one period.
function ContribRow({ c, currency, canManage, onPay }: {
  c: any; currency: string; canManage: boolean; onPay: () => void
}) {
  const tone = contribTone(c)
  const paid = String(c.status).toUpperCase() === 'PAID'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: S.md,
      padding: `11px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}`,
      minHeight: TOUCH.min,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: T.body.fontSize, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{c.memberName || 'Member'}</div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 2 }}>
          <span style={{
            background: tone.bg, color: tone.fg, padding: '1px 6px',
            borderRadius: 20, marginRight: 6,
          }}>{tone.label}</span>
          {/* Carried arrears change what is actually owed this period, so the
              base and the adjustment are both shown rather than just a total
              the member cannot reconcile. */}
          {c.carryAdjustment
            ? `${money(c.amountDue, currency)} base ${c.carryAdjustment < 0 ? '−' : '+'} ${money(Math.abs(c.carryAdjustment), currency)} carried`
            : `Due ${c.dueDate ? new Date(c.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}`}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ ...MONEY_STYLE, fontSize: 14, color: paid ? C.teal : C.text }}>
          {money(c.amountPayable ?? c.amountDue, currency)}
        </div>
      </div>
      {!paid && canManage ? (
        <button onClick={onPay} style={{
          flexShrink: 0, minHeight: TOUCH.icon, padding: `0 ${S.md}px`,
          background: C.tealBg, color: C.tealDark, border: 'none', borderRadius: 9,
          fontSize: T.small.fontSize, fontWeight: 500, fontFamily: FONT_STACK, cursor: 'pointer',
        }}>Mark paid</button>
      ) : null}
    </div>
  )
}

// A save bar that pins to the bottom of the screen while there are unsaved
// edits. Sits above the app's bottom nav and clears the home indicator.
function SaveBar({
  label, onSave, onDiscard, busy, blocked,
}: { label: string; onSave: () => void; onDiscard: () => void; busy: boolean; blocked?: string | null }) {
  return (
    <div style={{
      position: 'sticky', bottom: 0, zIndex: 5, background: C.surface,
      borderTop: `1px solid ${C.border}`,
      padding: `${S.md}px ${S.screenX}px calc(${S.md}px + env(safe-area-inset-bottom, 0px))`,
    }}>
      {blocked ? (
        <div style={{ fontSize: T.caption.fontSize, color: C.red, marginBottom: S.sm, lineHeight: 1.45 }}>
          {blocked}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: S.sm }}>
        <button onClick={onDiscard} disabled={busy} style={{
          flex: '0 0 auto', minHeight: TOUCH.min, padding: `0 ${S.lg}px`,
          background: C.surfaceAlt, color: C.textMuted, border: 'none', borderRadius: 12,
          fontSize: 15, fontFamily: FONT_STACK, cursor: busy ? 'default' : 'pointer',
        }}>Discard</button>
        <button onClick={onSave} disabled={busy || Boolean(blocked)} style={{
          flex: 1, minHeight: TOUCH.min,
          background: (busy || blocked) ? C.textFaint : C.teal, color: '#fff',
          border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 500,
          fontFamily: FONT_STACK, cursor: (busy || blocked) ? 'default' : 'pointer',
        }}>{label}</button>
      </div>
    </div>
  )
}

// One catalogue item in the period plan. The tick decides whether it is
// being bought this period; quantity and price sit underneath rather than
// beside, because three numeric fields on one 360px line leaves each about
// 70px.
function PlanRow({
  item, on, qty, price, editable, onToggle, onQty, onPrice, currency, assignedQty,
}: {
  item: any; on: boolean; qty: string; price: string; editable: boolean
  onToggle: () => void; onQty: (v: string) => void; onPrice: (v: string) => void
  currency: string; assignedQty: number
}) {
  const line = (Number(qty) || 0) * (Number(price) || 0)
  return (
    <div style={{
      padding: `11px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}`,
      background: on ? C.tealBg : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.md }}>
        <button
          onClick={editable ? onToggle : undefined}
          aria-label={`${on ? 'Remove' : 'Add'} ${item.name}`}
          aria-pressed={on}
          disabled={!editable}
          style={{
            width: 32, height: 32, marginTop: 1, flexShrink: 0, borderRadius: 9,
            border: `2px solid ${on ? C.teal : C.border}`, background: on ? C.teal : C.surface,
            color: '#fff', fontSize: 17, lineHeight: 1, padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: editable ? 'pointer' : 'default', fontFamily: FONT_STACK,
          }}
        >{on ? '✓' : ''}</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: T.body.fontSize, color: C.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{item.name}</div>
          <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 2 }}>
            {item.unit} · list price {money(item.estimatedUnitPrice, currency)}
            {assignedQty > 0 ? (
              <span style={{ color: C.amberText }}> · {assignedQty} already assigned</span>
            ) : null}
          </div>
        </div>

        {on ? (
          <div style={{ ...MONEY_STYLE, fontSize: 14, color: C.tealDark, flexShrink: 0, textAlign: 'right' }}>
            {money(line, currency)}
          </div>
        ) : null}
      </div>

      {on ? (
        <div style={{ display: 'flex', gap: S.sm, marginTop: S.sm, paddingLeft: 32 + S.md }}>
          <label style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: T.caption.fontSize, color: C.textFaint, marginBottom: 3 }}>
              Quantity
            </span>
            <input
              type="text" inputMode="decimal" value={qty} disabled={!editable}
              onChange={e => onQty(e.target.value)}
              style={{ ...inputStyle, textAlign: 'right' }}
            />
          </label>
          <label style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: T.caption.fontSize, color: C.textFaint, marginBottom: 3 }}>
              Price each
            </span>
            <input
              type="text" inputMode="decimal" value={price} disabled={!editable}
              onChange={e => onPrice(e.target.value)}
              style={{ ...inputStyle, textAlign: 'right' }}
            />
          </label>
        </div>
      ) : null}
    </div>
  )
}

// One member in the roll-call. Has money / not yet, as a pair of equal
// targets under the name — the coordinator goes down the list one-handed
// while the room waits.
function RollCallRow({ row, currency, editable, onAnswer }: {
  row: any; currency: string; editable: boolean; onAnswer: (has: boolean) => void
}) {
  const yes = row.answer === true
  const no  = row.answer === false
  const btn = (active: boolean, tone: 'yes' | 'no'): React.CSSProperties => ({
    flex: 1, minHeight: TOUCH.min, borderRadius: 10, fontSize: 14, fontWeight: 500,
    fontFamily: FONT_STACK, cursor: editable ? 'pointer' : 'default',
    border: `1.5px solid ${active ? (tone === 'yes' ? C.teal : C.red) : C.border}`,
    background: active ? (tone === 'yes' ? C.tealBg : C.redBg) : C.surface,
    color: active ? (tone === 'yes' ? C.tealDark : '#7F1D1D') : C.textMuted,
  })
  return (
    <div style={{
      padding: `11px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}`,
      background: yes ? C.tealBg : no ? C.redBg : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md }}>
        <div style={{
          flex: 1, minWidth: 0, fontSize: T.body.fontSize, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{row.memberName || 'Member'}</div>
        <div style={{ ...MONEY_STYLE, fontSize: 14, color: C.text, flexShrink: 0 }}>
          {money(row.payable, currency)}
        </div>
      </div>
      {row.carryAdjustment ? (
        <div style={{ fontSize: T.caption.fontSize, color: C.amberText, marginTop: 2 }}>
          {money(row.amountDue, currency)} base {row.carryAdjustment < 0 ? '−' : '+'} {money(Math.abs(row.carryAdjustment), currency)} carried
        </div>
      ) : null}
      {editable ? (
        <div style={{ display: 'flex', gap: S.sm, marginTop: S.sm }}>
          <button onClick={() => onAnswer(true)}  style={btn(yes, 'yes')}>✓ Has money</button>
          <button onClick={() => onAnswer(false)} style={btn(no, 'no')}>✗ Not yet</button>
        </div>
      ) : (
        <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 4 }}>
          {yes ? 'Confirmed' : no ? 'Declined — carried forward' : 'No answer'}
        </div>
      )}
    </div>
  )
}

// One line of the period plan awaiting assignment.
function UnassignedRow({ row, currency, editable, onAssign }: any) {
  const value = Number(row.qtyUnassigned) * Number(row.unitPrice)
  return (
    <div style={{
      padding: `11px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md }}>
        <div style={{
          flex: 1, minWidth: 0, fontSize: T.body.fontSize, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{row.itemName}</div>
        <div style={{ ...MONEY_STYLE, fontSize: 14, color: C.amberText, flexShrink: 0 }}>
          {money(value, currency)}
        </div>
      </div>
      <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 2 }}>
        {row.qtyUnassigned} of {row.qty} {row.unit} still to allocate
      </div>
      {editable ? (
        <button onClick={onAssign} style={{
          width: '100%', minHeight: TOUCH.min, marginTop: S.sm,
          background: '#EEF2FF', color: '#3730A3', border: 'none', borderRadius: 10,
          fontSize: 14, fontWeight: 500, fontFamily: FONT_STACK, cursor: 'pointer',
        }}>Assign to a member</button>
      ) : null}
    </div>
  )
}

// One member's advance, and what became of it.
function AssignmentRow({ a, currency, canAct, onAcquit, onWithdraw }: any) {
  const done = String(a.status).toUpperCase() === 'ACQUITTED'
  return (
    <div style={{ padding: `11px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md }}>
        <div style={{
          flex: 1, minWidth: 0, fontSize: T.body.fontSize, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{a.itemName}</div>
        <span style={{
          flexShrink: 0, fontSize: T.micro.fontSize, padding: '2px 8px', borderRadius: 20,
          background: done ? C.tealBg : C.amberBg, color: done ? C.tealDark : C.amberText,
        }}>{done ? 'Acquitted' : 'Open'}</span>
      </div>
      <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 2 }}>
        {a.memberName} · {a.qtyAssigned} {a.unit}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: S.sm,
        background: C.surfaceAlt, borderRadius: 10, padding: `${S.sm}px ${S.md}px`, marginTop: S.sm,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>Advanced</div>
          <div style={{ ...MONEY_STYLE, fontSize: 13, color: C.text }}>{money(a.advanceAmount, currency)}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>Spent</div>
          <div style={{ ...MONEY_STYLE, fontSize: 13, color: a.actualSpent != null ? C.text : C.textFaint }}>
            {a.actualSpent != null ? money(a.actualSpent, currency) : '—'}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: T.caption.fontSize, color: C.textFaint }}>
            {a.variance == null ? 'Variance' : a.variance > 0 ? 'Change held' : a.variance < 0 ? 'Out of pocket' : 'Variance'}
          </div>
          <div style={{
            ...MONEY_STYLE, fontSize: 13,
            color: a.variance == null ? C.textFaint : a.variance === 0 ? C.teal : a.variance > 0 ? C.amberText : '#3730A3',
          }}>
            {a.variance == null ? '—' : a.variance === 0 ? 'exact' : money(Math.abs(a.variance), currency)}
          </div>
        </div>
      </div>

      {!done && canAct ? (
        <div style={{ display: 'flex', gap: S.sm, marginTop: S.sm }}>
          <button onClick={onAcquit} style={{
            flex: 1, minHeight: TOUCH.min, background: C.tealBg, color: C.tealDark,
            border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 500,
            fontFamily: FONT_STACK, cursor: 'pointer',
          }}>Acquit</button>
          <button onClick={onWithdraw} style={{
            flex: 1, minHeight: TOUCH.min, background: C.surface, color: C.red,
            border: `1px solid ${C.redBg}`, borderRadius: 10, fontSize: 14,
            fontFamily: FONT_STACK, cursor: 'pointer',
          }}>Withdraw</button>
        </div>
      ) : null}
    </div>
  )
}

// One payment instruction. The verbs are deliberately full width: confirming
// receipt of money by mis-tap is not a recoverable mistake.
function TransferRow({ t, currency, busy, onState }: any) {
  const st   = String(t.status).toUpperCase()
  const tone = TRANSFER_LABEL[st] || TRANSFER_LABEL.INSTRUCTED
  const done = st === 'CONFIRMED'
  return (
    <div style={{ padding: `11px ${S.screenX}px`, borderTop: `1px solid ${C.borderLight}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: S.md }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: T.body.fontSize, color: C.text, lineHeight: 1.4 }}>
          {t.payerName} <span style={{ color: C.textFaint }}>pays</span> {t.payeeName}
        </div>
        <div style={{ ...MONEY_STYLE, fontSize: 14, color: C.text, flexShrink: 0 }}>
          {money(t.amount, currency)}
        </div>
      </div>
      <div style={{ marginTop: 3, fontSize: T.caption.fontSize, color: C.textFaint }}>
        <span style={{ background: tone.bg, color: tone.fg, padding: '1px 6px', borderRadius: 20, marginRight: 6 }}>
          {tone.text}
        </span>
        {t.payeeType === 'SUPPLIER' && t.accountNumber
          ? `${t.bankName || 'Bank'} · ${t.accountNumber}`
          : t.reference || 'Hand to hand'}
      </div>
      <div style={{ display: 'flex', gap: S.sm, marginTop: S.sm }}>
        {st === 'INSTRUCTED' ? (
          <button onClick={() => onState('CLAIM_TRANSFER', t.id)} disabled={busy} style={{
            flex: 1, minHeight: TOUCH.min, background: C.amberBg, color: C.amberText,
            border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 500,
            fontFamily: FONT_STACK, cursor: busy ? 'default' : 'pointer',
          }}>Mark sent</button>
        ) : null}
        {!done ? (
          <button onClick={() => onState('CONFIRM_TRANSFER', t.id)} disabled={busy} style={{
            flex: 1, minHeight: TOUCH.min, background: C.tealBg, color: C.tealDark,
            border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 500,
            fontFamily: FONT_STACK, cursor: busy ? 'default' : 'pointer',
          }}>Confirm received</button>
        ) : (
          <button onClick={() => onState('DISPUTE_TRANSFER', t.id)} disabled={busy} style={{
            flex: 1, minHeight: TOUCH.min, background: C.surface, color: C.red,
            border: `1px solid ${C.redBg}`, borderRadius: 10, fontSize: 14,
            fontFamily: FONT_STACK, cursor: busy ? 'default' : 'pointer',
          }}>Dispute</button>
        )}
      </div>
    </div>
  )
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: S.md, width: '100%',
      minHeight: TOUCH.min, padding: `11px ${S.screenX}px`,
      background: 'transparent', border: 'none', borderTop: `1px solid ${C.borderLight}`,
      cursor: 'pointer', fontFamily: FONT_STACK, textAlign: 'left',
    }}>
      <span aria-hidden="true" style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: C.tealBg, color: C.teal,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19,
      }}>+</span>
      <span style={{ flex: 1, fontSize: T.body.fontSize, fontWeight: 500, color: C.teal }}>{label}</span>
    </button>
  )
}

// ── Main ──────────────────────────────────────────────────────
type Props = {
  clubId: string
  onBack: () => void
  // Called after activation so the caller can refresh the passbook behind
  // this screen — an activated club has a ledger where it had none.
  onChanged?: () => void
}

export default function MobileGroceryClubManage({ clubId, onBack, onChanged }: Props) {
  const [club, setClub] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string[]>(['items'])
  const [itemSheet, setItemSheet] = useState<{ item: any | null } | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  // Draft edits for the two cycle stages. Null means "not yet touched this
  // load" — the row values are read straight from the server payload until
  // the admin changes something, so a background refetch cannot clobber a
  // draft that does not exist yet.
  const [planDraft, setPlanDraft] = useState<Record<string, { on: boolean; qty: string; price: string }> | null>(null)
  const [rollDraft, setRollDraft] = useState<Record<string, boolean> | null>(null)
  const [assignFor, setAssignFor] = useState<any | null>(null)
  const [acquitFor, setAcquitFor] = useState<any | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/grocery?clubId=${encodeURIComponent(clubId)}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not load the club.')
      setClub(json.data)
    } catch (e: any) {
      setError(e?.message || 'Could not load the club.')
    } finally {
      setLoading(false)
    }
  }, [clubId])

  useEffect(() => { load() }, [load])

  const toggle = useCallback((key: string) => {
    setOpen(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }, [])

  const afterChange = useCallback((msg: string) => {
    setItemSheet(null)
    setShowPicker(false)
    setShowDetails(false)
    // Drops both drafts. The reload that follows is the new truth, and
    // keeping edits on top of it would show a dirty bar over data that
    // already contains those very changes.
    setPlanDraft(null)
    setRollDraft(null)
    setAssignFor(null)
    setAcquitFor(null)
    setNotice(msg)
    load()
    if (onChanged) onChanged()
  }, [load, onChanged])

  const act = useCallback(async (body: any, busyLabel?: string) => {
    if (busyLabel) setBusy(busyLabel)
    try {
      const res = await fetch('/api/grocery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubId, ...body }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || 'That did not work.')
      afterChange(json.message || 'Done.')
    } catch (e: any) {
      setNotice(null)
      setError(e?.message || 'That did not work.')
    } finally {
      setBusy(null)
    }
  }, [clubId, afterChange])

  const items = Array.isArray(club?.items) ? club.items : []
  const members = Array.isArray(club?.members) ? club.members : []
  const currency = club?.currency || club?.groupCurrency || 'USD'
  const status = String(club?.status || 'SETUP').toUpperCase()

  // Already in the payload — previously fetched and thrown away.
  const contribs = Array.isArray(club?.contributions) ? club.contributions : []
  const cycles   = Array.isArray(club?.cycles) ? club.cycles : []
  const cycle    = cycles.find((c: any) => String(c.status).toUpperCase() !== 'CLOSED') || cycles[0] || null
  const period   = cycle?.periodNumber ?? 1

  // Only the current period, newest first. The desktop shows a rolling
  // window across periods; on a phone that becomes an unreadable wall, and
  // the period an admin is standing in is the one they need.
  const periodContribs = contribs.filter((c: any) => c.periodNumber === period)
  const paidCount      = periodContribs.filter((c: any) => String(c.status).toUpperCase() === 'PAID').length
  const overdueCount   = periodContribs.filter((c: any) => c.isOverdue).length

  // Collected against the whole list, which is what the progress bar means.
  const listValue   = Number(club?.listValue ?? club?.totalBudget ?? 0)
  const collected   = Number(club?.totalContributed ?? 0)
  const collectedPct = listValue > 0 ? Math.min(100, Math.round((collected / listValue) * 100)) : 0

  const canDistribute = ['ACTIVE', 'PURCHASING'].includes(status)
    && items.some((i: any) => String(i.status).toUpperCase() === 'PURCHASED')

  // ── Cycle stages ────────────────────────────────────────────
  const cycleStatus  = String(cycle?.status || '').toUpperCase()
  const cycleOpen    = CYCLE_EDITABLE.has(cycleStatus)
  const plan         = (Array.isArray(club?.periodPurchases) ? club.periodPurchases : [])
    .filter((r: any) => r.periodNumber === period)

  // Server truth for the plan, keyed by item. The draft overlays this.
  const planServer: Record<string, { on: boolean; qty: string; price: string }> = {}
  items.forEach((i: any) => {
    const line = plan.find((r: any) => r.itemId === i.id)
    planServer[i.id] = line
      ? { on: true, qty: String(line.qty), price: String(line.unitPrice) }
      : { on: false, qty: String(i.qtyPerMember ?? 1), price: String(i.estimatedUnitPrice ?? 0) }
  })
  const planRows = planDraft || planServer
  const planDirty = planDraft !== null && items.some((i: any) => {
    const a = planRows[i.id], b = planServer[i.id]
    return a.on !== b.on || (a.on && (a.qty !== b.qty || a.price !== b.price))
  })
  const planChosen  = items.filter((i: any) => planRows[i.id]?.on)
  const plannedTotal = planChosen.reduce((t: number, i: any) =>
    t + (Number(planRows[i.id].qty) || 0) * (Number(planRows[i.id].price) || 0), 0)
  // Mirrors the route's own validation so a bad line is caught before the
  // request, not after a round trip to Tokyo.
  const planInvalid = planChosen.find((i: any) => {
    const r = planRows[i.id]
    return !(Number(r.qty) > 0) || !(Number(r.price) >= 0)
  })

  // Roll-call rows: one per contribution in this period, with the draft
  // answer overlaid on whatever the server already recorded.
  const rollRows = periodContribs.map((c: any) => {
    const stored = c.fundsConfirmedAt ? true : c.fundsDeclinedAt ? false : null
    const draft  = rollDraft ? rollDraft[c.userId] : undefined
    return {
      id: c.id, userId: c.userId, memberName: c.memberName,
      amountDue: c.amountDue, carryAdjustment: c.carryAdjustment,
      payable: c.amountPayable ?? c.amountDue,
      answer: draft === undefined ? stored : draft,
      stored,
    }
  })
  const rollDirty     = rollRows.some((r: any) => r.answer !== r.stored)
  const rollAnswered  = rollRows.filter((r: any) => r.answer !== null)
  const rollConfirmed = rollRows.filter((r: any) => r.answer === true)
  const rollSilent    = rollRows.filter((r: any) => r.answer === null)
  const confirmedPot  = rollConfirmed.reduce((t: number, r: any) => t + Number(r.payable || 0), 0)

  // ── Assignments and settlement ──────────────────────────────
  const assigns   = (Array.isArray(club?.assignments) ? club.assignments : [])
    .filter((a: any) => a.periodNumber === period && String(a.status).toUpperCase() !== 'CANCELLED')
  const transfers = (Array.isArray(club?.settlementTransfers) ? club.settlementTransfers : [])
    .filter((t: any) => t.periodNumber === period)
  const suppliers = Array.isArray(club?.supplierAccounts) ? club.supplierAccounts : []

  // Items in this period's plan that still have quantity nobody is buying.
  const unassigned = plan.filter((r: any) => Number(r.qtyUnassigned) > 0)
  const openAssigns = assigns.filter((a: any) => String(a.status).toUpperCase() !== 'ACQUITTED')

  // Allocation happens once the pot is confirmed and stops when the cycle
  // locks — the same window handleAssignItem enforces.
  const canAssign  = cycleStatus === 'FUNDED'
  const uncommitted = Number(club?.uncommittedCash || 0)

  const settledTotal = transfers
    .filter((t: any) => String(t.status).toUpperCase() === 'CONFIRMED')
    .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0)
  const movedTotal = transfers.reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0)

  const setPlanRow = (itemId: string, patch: Partial<{ on: boolean; qty: string; price: string }>) => {
    setPlanDraft(prev => {
      const base = prev || planServer
      return { ...base, [itemId]: { ...base[itemId], ...patch } }
    })
  }
  const setRollAnswer = (userId: string, has: boolean) => {
    setRollDraft(prev => {
      const base = prev || {}
      // Tapping the same answer again undoes an unsaved change, so a
      // mis-tap is recoverable without a third "unanswered" button. An
      // answer already saved on the server is cleared by the API, not
      // here — this only rolls back the draft.
      const current = base[userId] !== undefined
        ? base[userId]
        : (rollRows.find((r: any) => r.userId === userId)?.stored ?? null)
      const next = { ...base }
      if (current === has) delete next[userId]
      else next[userId] = has
      return next
    })
  }
  const editable = EDITABLE.has(status)
  const canActivate = status === 'SETUP' && members.length > 0 && items.length > 0
  const existingIds = new Set<string>(members.map((m: any) => m.userId))

  if (loading && !club) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: C.surfaceAlt, minHeight: '100vh' }}>
        <div style={{ background: C.navy, padding: `14px ${S.screenX}px 40px` }} />
        <div style={{ padding: `${S.xxl}px ${S.screenX}px`, color: C.textFaint, fontSize: T.small.fontSize }}>
          Loading…
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: FONT_STACK, background: C.surfaceAlt, minHeight: '100vh' }}>
      {busy ? <BusyOverlay label={busy} /> : null}

      {itemSheet ? (
        <ItemSheet
          clubId={clubId}
          item={itemSheet.item}
          memberCount={members.length || 1}
          currency={currency}
          onClose={() => setItemSheet(null)}
          onSaved={afterChange}
        />
      ) : null}

      {showPicker && club?.groupId ? (
        <MemberPicker
          clubId={clubId}
          groupId={club.groupId}
          existingIds={existingIds}
          onClose={() => setShowPicker(false)}
          onSaved={afterChange}
        />
      ) : null}

      {showDetails && club ? (
        <DetailsSheet club={club} onClose={() => setShowDetails(false)} onSaved={afterChange} />
      ) : null}

      {assignFor ? (
        <AssignSheet
          item={assignFor}
          members={members}
          clubId={clubId}
          currency={currency}
          available={uncommitted}
          existing={assigns.find((a: any) => a.itemId === assignFor.itemId || a.itemId === assignFor.id) || null}
          periodNumber={period}
          suppliers={suppliers}
          onClose={() => setAssignFor(null)}
          onSaved={afterChange}
        />
      ) : null}

      {acquitFor ? (
        <AcquitSheet
          assign={acquitFor}
          clubId={clubId}
          currency={currency}
          onClose={() => setAcquitFor(null)}
          onSaved={afterChange}
        />
      ) : null}

      <div style={{ background: C.navy, padding: `14px ${S.screenX}px 18px` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm }}>
          <button onClick={onBack} aria-label="Back" style={{
            width: TOUCH.icon, height: TOUCH.icon, marginLeft: -12, flexShrink: 0,
            background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.8)',
            fontSize: 22, cursor: 'pointer', fontFamily: FONT_STACK,
          }}>←</button>
          <span style={{
            flex: 1, minWidth: 0, color: '#fff', fontSize: T.heading.fontSize, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{club?.name || 'Grocery club'}</span>
          <span style={{
            background: 'rgba(255,255,255,0.14)', color: '#fff', fontSize: T.micro.fontSize,
            padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0,
          }}>{STATUS_LABEL[status] || status}</span>
        </div>

        <div style={{ display: 'flex', gap: S.xl, marginTop: 16, paddingTop: 13, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: T.caption.fontSize, color: 'rgba(255,255,255,0.6)' }}>Budget</div>
            <div style={{ ...MONEY_STYLE, fontSize: 22, color: '#fff', marginTop: 2 }}>
              {money(club?.totalBudget, currency)}
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: T.caption.fontSize, color: 'rgba(255,255,255,0.6)' }}>Each member</div>
            <div style={{ ...MONEY_STYLE, fontSize: 22, color: '#fff', marginTop: 2 }}>
              {money(club?.contributionAmount, currency)}
            </div>
          </div>
        </div>
      </div>

      {notice ? (
        <div role="status" style={{
          margin: `${S.md}px ${S.screenX}px 0`, padding: `${S.sm}px ${S.md}px`,
          background: C.tealBg, color: C.tealDark, borderRadius: 10,
          fontSize: T.small.fontSize, lineHeight: 1.45,
        }}>{notice}</div>
      ) : null}

      {error ? (
        <div role="alert" style={{
          margin: `${S.md}px ${S.screenX}px 0`, padding: `${S.sm}px ${S.md}px`,
          background: C.redBg, color: '#7F1D1D', borderRadius: 10,
          fontSize: T.small.fontSize, lineHeight: 1.45,
        }}>{error}</div>
      ) : null}

      {/* The one thing standing between a new club and a working passbook.
          Shown as a checklist rather than a disabled button, so an admin can
          see WHICH condition is unmet instead of guessing. */}
      {status === 'SETUP' ? (
        <div style={{ background: C.surface, marginTop: S.md, padding: `${S.lg}px ${S.screenX}px` }}>
          <div style={{ fontSize: T.heading.fontSize, fontWeight: 500, color: C.text, marginBottom: S.sm }}>
            Ready to start?
          </div>
          <div style={{ fontSize: T.small.fontSize, color: members.length > 0 ? C.teal : C.textMuted, marginBottom: 4 }}>
            {members.length > 0 ? '✓' : '○'} {members.length} member{members.length === 1 ? '' : 's'} in the club
          </div>
          <div style={{ fontSize: T.small.fontSize, color: items.length > 0 ? C.teal : C.textMuted, marginBottom: S.lg }}>
            {items.length > 0 ? '✓' : '○'} {items.length} item{items.length === 1 ? '' : 's'} on the list
          </div>
          <PrimaryButton
            label="Activate club"
            disabled={!canActivate}
            onClick={() => act({ action: 'ACTIVATE' }, 'Activating club…')}
          />
          <p style={{ fontSize: T.caption.fontSize, color: C.textFaint, lineHeight: 1.5, margin: `${S.md}px 0 0` }}>
            Activating builds the contribution schedule and everyone&rsquo;s passbook.
            Members and items cannot be changed once buying starts.
          </p>
        </div>
      ) : null}

      {/* ── Summary ─────────────────────────────────────────── */}
      {status !== 'SETUP' ? (
        <div style={{ background: C.surface, marginTop: S.md }}>
          <SectionHeader
            label="Summary"
            hint={collectedPct > 0 ? `${collectedPct}% collected` : undefined}
            open={open.includes('summary')}
            onToggle={() => toggle('summary')}
          />
          {open.includes('summary') ? (
            <div>
              <ItemStatusGrid items={items} />

              <div style={{ padding: `0 ${S.screenX}px ${S.md}px` }}>
                <div style={{
                  height: 6, borderRadius: 3, background: C.borderLight, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${collectedPct}%`, height: '100%', background: C.teal,
                    borderRadius: 3, transition: 'width 200ms',
                  }} />
                </div>
                <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 6 }}>
                  {money(collected, currency)} collected of {money(listValue, currency)}
                </div>
              </div>

              <StatLine label="Spent so far"  value={money(club?.totalSpent, currency)} />
              {Number(club?.advancedOut || 0) > 0 ? (
                <StatLine label="Advanced out" value={money(club?.advancedOut, currency)} tone={C.amberText} />
              ) : null}
              {Number(club?.unacquitted || 0) > 0 ? (
                <StatLine label="Not yet acquitted" value={money(club?.unacquitted, currency)} tone={C.red} />
              ) : null}
              <StatLine label="Each member" value={money(club?.contributionAmount, currency)} />
              {typeof club?.daysLeft === 'number' ? (
                <StatLine label="Days left" value={`${club.daysLeft}`} tone={club.daysLeft < 0 ? C.red : undefined} />
              ) : null}

              {/* The bulk hand-over. Only offered once something has actually
                  been bought — before that it would post a no-op. */}
              {canDistribute ? (
                <div style={{ padding: `${S.md}px ${S.screenX}px ${S.lg}px` }}>
                  <button
                    onClick={() => act({ action: 'MARK_DISTRIBUTED' }, 'Marking items as handed over…')}
                    style={{
                      width: '100%', minHeight: TOUCH.min, background: C.surface, color: C.teal,
                      border: `1px solid ${C.teal}`, borderRadius: 12, fontSize: 15, fontWeight: 500,
                      fontFamily: FONT_STACK, cursor: 'pointer',
                    }}
                  >Mark all bought items as handed over</button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Cycle: period purchases ─────────────────────────── */}
      {cycle ? (
        <div style={{ background: C.surface, marginTop: S.md }}>
          <SectionHeader
            label="Period purchases"
            hint={planChosen.length ? `${planChosen.length} chosen` : CYCLE_LABEL[cycleStatus] || undefined}
            open={open.includes('plan')}
            onToggle={() => toggle('plan')}
          />
          {open.includes('plan') ? (
            <div>
              <p style={{
                fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
                margin: 0, padding: `${S.md}px ${S.screenX}px`,
              }}>
                {cycleOpen
                  ? 'Tick what the club is buying this period and set the price you expect to pay. This is the plan the target contribution is worked out from.'
                  : `Cycle ${period} is ${(CYCLE_LABEL[cycleStatus] || cycleStatus).toLowerCase()} — the plan is closed.`}
              </p>

              {items.length === 0 ? (
                <p style={{
                  fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
                  margin: 0, padding: `0 ${S.screenX}px ${S.lg}px`,
                }}>
                  There are no items to choose from yet. Add them under Items first.
                </p>
              ) : (
                <>
                  {items.map((i: any) => {
                    const line = plan.find((r: any) => r.itemId === i.id)
                    return (
                      <PlanRow
                        key={i.id}
                        item={i}
                        currency={currency}
                        editable={cycleOpen}
                        on={planRows[i.id]?.on || false}
                        qty={planRows[i.id]?.qty ?? ''}
                        price={planRows[i.id]?.price ?? ''}
                        assignedQty={Number(line?.qtyAssigned || 0)}
                        onToggle={() => setPlanRow(i.id, { on: !planRows[i.id]?.on })}
                        onQty={v => setPlanRow(i.id, { qty: v })}
                        onPrice={v => setPlanRow(i.id, { price: v })}
                      />
                    )
                  })}

                  <StatLine label="Planned total" value={money(plannedTotal, currency)} tone={C.tealDark} />
                  {cycle?.targetContribution ? (
                    <StatLine label="Target each" value={money(cycle.targetContribution, currency)} />
                  ) : null}

                  {/* Publishing turns the planned total into everyone's
                      target contribution. Offered only once the plan is
                      saved, because publishing a dirty plan would set a
                      target from figures nobody has committed. */}
                  {cycleOpen && !planDirty && planChosen.length > 0 ? (
                    <div style={{ padding: `${S.md}px ${S.screenX}px ${S.lg}px` }}>
                      <button
                        onClick={() => act({ action: 'SET_PERIOD_BUDGET', periodNumber: period }, 'Setting the target…')}
                        style={{
                          width: '100%', minHeight: TOUCH.min, background: C.surface, color: C.teal,
                          border: `1px solid ${C.teal}`, borderRadius: 12, fontSize: 15, fontWeight: 500,
                          fontFamily: FONT_STACK, cursor: 'pointer',
                        }}
                      >Set target contribution from this plan</button>
                    </div>
                  ) : null}

                  {planDirty ? (
                    <SaveBar
                      label="Save plan"
                      busy={Boolean(busy)}
                      blocked={planInvalid
                        ? `${planInvalid.name} needs a quantity above zero and a price that is not negative.`
                        : null}
                      onDiscard={() => setPlanDraft(null)}
                      onSave={() => act({
                        action: 'SAVE_PERIOD_PLAN',
                        periodNumber: period,
                        lines: planChosen.map((i: any) => ({
                          itemId: i.id,
                          qty: Number(planRows[i.id].qty),
                          unitPrice: Number(planRows[i.id].price),
                        })),
                      }, 'Saving the plan…')}
                    />
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Cycle: roll-call ────────────────────────────────── */}
      {cycle ? (
        <div style={{ background: C.surface, marginTop: S.md }}>
          <SectionHeader
            label="Roll-call"
            hint={rollRows.length ? `${rollConfirmed.length}/${rollRows.length} confirmed` : undefined}
            open={open.includes('rollcall')}
            onToggle={() => toggle('rollcall')}
          />
          {open.includes('rollcall') ? (
            <div>
              <p style={{
                fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
                margin: 0, padding: `${S.md}px ${S.screenX}px`,
              }}>
                {cycleOpen
                  ? 'Ask each member whether they have their money with them now. A tick is not a payment — nothing moves until settlement.'
                  : `Cycle ${period} is ${(CYCLE_LABEL[cycleStatus] || cycleStatus).toLowerCase()}. Reopen it to change an answer.`}
              </p>

              {rollRows.length === 0 ? (
                <p style={{
                  fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
                  margin: 0, padding: `0 ${S.screenX}px ${S.lg}px`,
                }}>
                  Nobody has a contribution raised for this period yet.
                </p>
              ) : (
                <>
                  {rollRows.map((r: any) => (
                    <RollCallRow
                      key={r.id}
                      row={r}
                      currency={currency}
                      editable={cycleOpen}
                      onAnswer={has => setRollAnswer(r.userId, has)}
                    />
                  ))}

                  <StatLine label="Confirmed pot" value={money(confirmedPot, currency)} tone={C.tealDark} />
                  {rollSilent.length > 0 ? (
                    <StatLine label="No answer yet" value={`${rollSilent.length}`} tone={C.amberText} />
                  ) : null}

                  {/* Closing locks the pot and carries every decline forward
                      as arrears. Held back until everyone has answered: a
                      silent member closed out is a debt raised against
                      somebody who was never asked. */}
                  {cycleOpen && !rollDirty && rollAnswered.length > 0 ? (
                    <div style={{ padding: `${S.md}px ${S.screenX}px ${S.lg}px` }}>
                      <PrimaryButton
                        label="Close roll-call"
                        disabled={rollSilent.length > 0 || rollConfirmed.length === 0}
                        onClick={() => act({ action: 'LOCK_CONTRIBUTIONS', periodNumber: period }, 'Closing the roll-call…')}
                      />
                      {rollSilent.length > 0 ? (
                        <p style={{ fontSize: T.caption.fontSize, color: C.textFaint, lineHeight: 1.5, margin: `${S.sm}px 0 0` }}>
                          {rollSilent.length} member{rollSilent.length === 1 ? ' has' : 's have'} not answered yet.
                        </p>
                      ) : (
                        <p style={{ fontSize: T.caption.fontSize, color: C.textFaint, lineHeight: 1.5, margin: `${S.sm}px 0 0` }}>
                          Locks {money(confirmedPot, currency)} for this cycle. Anyone who declined carries their amount forward.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {rollDirty ? (
                    <SaveBar
                      label="Save roll-call"
                      busy={Boolean(busy)}
                      onDiscard={() => setRollDraft(null)}
                      onSave={() => act({
                        action: 'SAVE_ROLL_CALL',
                        periodNumber: period,
                        responses: rollRows
                          .filter((r: any) => r.answer !== r.stored)
                          .map((r: any) => ({ userId: r.userId, hasFunds: r.answer })),
                      }, 'Saving the roll-call…')}
                    />
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Cycle: assignments ──────────────────────────────── */}
      {cycle && ['FUNDED', 'LOCKED', 'SETTLED', 'CLOSED'].includes(cycleStatus) ? (
        <div style={{ background: C.surface, marginTop: S.md }}>
          <SectionHeader
            label="Assignments"
            hint={assigns.length ? `${assigns.length - openAssigns.length}/${assigns.length} acquitted` : undefined}
            open={open.includes('assigns')}
            onToggle={() => toggle('assigns')}
          />
          {open.includes('assigns') ? (
            <div>
              <p style={{
                fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
                margin: 0, padding: `${S.md}px ${S.screenX}px`,
              }}>
                {canAssign
                  ? 'Hand each item to whoever is buying it, with the cash they need. The club holds nothing — advances go straight to the member or the supplier.'
                  : `Cycle ${period} is ${(CYCLE_LABEL[cycleStatus] || cycleStatus).toLowerCase()} — allocation is closed.`}
              </p>

              <StatLine label="Uncommitted cash" value={money(uncommitted, currency)}
                tone={uncommitted < 0 ? C.red : C.tealDark} />
              {Number(club?.unacquitted || 0) > 0 ? (
                <StatLine label="Not yet acquitted" value={money(club?.unacquitted, currency)} tone={C.amberText} />
              ) : null}

              {unassigned.length > 0 ? (
                <>
                  <div style={{
                    padding: `${S.sm}px ${S.screenX}px`, fontSize: T.caption.fontSize,
                    color: C.textFaint, borderTop: `1px solid ${C.borderLight}`,
                  }}>Still to allocate</div>
                  {unassigned.map((r: any) => (
                    <UnassignedRow
                      key={r.id} row={r} currency={currency} editable={canAssign}
                      onAssign={() => setAssignFor({
                        // The sheet works in item terms; the plan line carries
                        // the period's agreed price and remaining quantity.
                        id: r.itemId, itemId: r.itemId, name: r.itemName, unit: r.unit,
                        totalQty: r.qty, qtyUnassigned: r.qtyUnassigned,
                        estimatedUnitPrice: r.unitPrice,
                      })}
                    />
                  ))}
                </>
              ) : null}

              {assigns.length === 0 ? (
                <p style={{
                  fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
                  margin: 0, padding: `${S.lg}px ${S.screenX}px`,
                }}>
                  Nothing assigned yet for this period.
                </p>
              ) : (
                <>
                  <div style={{
                    padding: `${S.sm}px ${S.screenX}px`, fontSize: T.caption.fontSize,
                    color: C.textFaint, borderTop: `1px solid ${C.borderLight}`,
                  }}>Assigned</div>
                  {assigns.map((a: any) => (
                    <AssignmentRow
                      key={a.id} a={a} currency={currency} canAct={canAssign}
                      onAcquit={() => setAcquitFor(a)}
                      onWithdraw={() => act({
                        action: 'CANCEL_ASSIGNMENT', itemId: a.itemId, assignedToId: a.userId,
                      }, 'Withdrawing…')}
                    />
                  ))}
                </>
              )}

              {/* Locking freezes allocation so the solver has a fixed graph
                  to work from. Held back while anything is unallocated —
                  locking with quantity outstanding strands that money. */}
              {canAssign && assigns.length > 0 ? (
                <div style={{ padding: `${S.md}px ${S.screenX}px ${S.lg}px` }}>
                  <PrimaryButton
                    label="Lock assignments"
                    disabled={unassigned.length > 0}
                    onClick={() => act({ action: 'LOCK_CYCLE', periodNumber: period }, 'Locking assignments…')}
                  />
                  {unassigned.length > 0 ? (
                    <p style={{ fontSize: T.caption.fontSize, color: C.textFaint, lineHeight: 1.5, margin: `${S.sm}px 0 0` }}>
                      {unassigned.length} item{unassigned.length === 1 ? '' : 's'} still to allocate.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Cycle: settlement ───────────────────────────────── */}
      {cycle && ['LOCKED', 'SETTLED', 'CLOSED'].includes(cycleStatus) ? (
        <div style={{ background: C.surface, marginTop: S.md }}>
          <SectionHeader
            label="Settlement"
            hint={transfers.length ? `${transfers.filter((t: any) => String(t.status).toUpperCase() === 'CONFIRMED').length}/${transfers.length} done` : undefined}
            open={open.includes('settle')}
            onToggle={() => toggle('settle')}
          />
          {open.includes('settle') ? (
            <div>
              {transfers.length === 0 ? (
                <>
                  <p style={{
                    fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
                    margin: 0, padding: `${S.md}px ${S.screenX}px`,
                  }}>
                    Work out who hands money to whom. Nobody pays the club — every
                    payment goes directly to the member or supplier who needs it.
                  </p>
                  <div style={{ padding: `0 ${S.screenX}px ${S.lg}px` }}>
                    <PrimaryButton
                      label="Work out the payments"
                      onClick={() => act({ action: 'SOLVE_SETTLEMENT', periodNumber: period }, 'Working out the payments…')}
                    />
                  </div>
                </>
              ) : (
                <>
                  <StatLine label="To move"   value={money(movedTotal, currency)} />
                  <StatLine label="Confirmed" value={money(settledTotal, currency)}
                    tone={settledTotal >= movedTotal ? C.teal : C.tealDark} />

                  {transfers.map((t: any) => (
                    <TransferRow
                      key={t.id} t={t} currency={currency} busy={Boolean(busy)}
                      onState={(action: string, transferId: string) =>
                        act({ action, transferId }, 'Updating payment…')}
                    />
                  ))}

                  <div style={{ padding: `${S.md}px ${S.screenX}px ${S.lg}px` }}>
                    <button
                      onClick={() => act({ action: 'SOLVE_SETTLEMENT', periodNumber: period }, 'Re-working the payments…')}
                      style={{
                        width: '100%', minHeight: TOUCH.min, background: C.surface, color: C.teal,
                        border: `1px solid ${C.teal}`, borderRadius: 12, fontSize: 15, fontWeight: 500,
                        fontFamily: FONT_STACK, cursor: 'pointer',
                      }}
                    >Work them out again</button>
                    <p style={{ fontSize: T.caption.fontSize, color: C.textFaint, lineHeight: 1.5, margin: `${S.sm}px 0 0` }}>
                      Use this if an acquittal changed after the payments were worked out.
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ background: C.surface, marginTop: S.md }}>
        <SectionHeader label="Items" hint={String(items.length)} open={open.includes('items')} onToggle={() => toggle('items')} />
        {open.includes('items') ? (
          <div>
            {items.length === 0 ? (
              <p style={{ fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5, margin: 0, padding: `${S.lg}px ${S.screenX}px` }}>
                No items yet. Add what the club is buying — the budget and each member&rsquo;s
                share are worked out from this list.
              </p>
            ) : (
              items.map((i: any) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  currency={currency}
                  editable={editable}
                  onEdit={() => setItemSheet({ item: i })}
                  onDelete={() => act({ action: 'DELETE_ITEM', itemId: i.id })}
                />
              ))
            )}
            {editable ? <AddRow label="Add an item" onClick={() => setItemSheet({ item: null })} /> : null}
          </div>
        ) : null}
      </div>

      <div style={{ background: C.surface, marginTop: S.md }}>
        <SectionHeader label="Members" hint={String(members.length)} open={open.includes('members')} onToggle={() => toggle('members')} />
        {open.includes('members') ? (
          <div>
            {members.length === 0 ? (
              <p style={{ fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5, margin: 0, padding: `${S.lg}px ${S.screenX}px` }}>
                Nobody is in this club yet.
              </p>
            ) : (
              members.map((m: any) => (
                <MemberRow
                  key={m.userId}
                  member={m}
                  currency={currency}
                  editable={editable}
                  onRemove={() => act({ action: 'REMOVE_MEMBER', userId: m.userId })}
                />
              ))
            )}
            {editable ? <AddRow label="Add members" onClick={() => setShowPicker(true)} /> : null}
          </div>
        ) : null}
      </div>

      {/* ── Contributions ───────────────────────────────────── */}
      {status !== 'SETUP' ? (
        <div style={{ background: C.surface, marginTop: S.md }}>
          <SectionHeader
            label="Contributions"
            hint={periodContribs.length ? `${paidCount}/${periodContribs.length} paid` : undefined}
            open={open.includes('contribs')}
            onToggle={() => toggle('contribs')}
          />
          {open.includes('contribs') ? (
            <div>
              {periodContribs.length === 0 ? (
                <p style={{
                  fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.5,
                  margin: 0, padding: `${S.lg}px ${S.screenX}px`,
                }}>
                  No contributions raised yet. Activating the club builds the schedule.
                </p>
              ) : (
                <>
                  <div style={{
                    padding: `${S.sm}px ${S.screenX}px`, fontSize: T.caption.fontSize,
                    color: C.textFaint, borderTop: `1px solid ${C.borderLight}`,
                  }}>
                    Period {period}
                    {overdueCount > 0 ? (
                      <span style={{ color: C.red }}> · {overdueCount} overdue</span>
                    ) : null}
                  </div>
                  {periodContribs.map((c: any) => (
                    <ContribRow
                      key={c.id}
                      c={c}
                      currency={currency}
                      canManage
                      // Records the full amount owed, carried arrears
                      // included — the same figure the row displays, so a
                      // part payment is never silently booked as settled.
                      onPay={() => act({
                        action: 'PAY_CONTRIBUTION',
                        contributionId: c.id,
                        amountPaid: c.amountPayable ?? c.amountDue,
                        paymentMethod: 'BANK_TRANSFER',
                      }, 'Recording payment…')}
                    />
                  ))}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ background: C.surface, marginTop: S.md }}>
        <SectionHeader label="Club details" open={open.includes('details')} onToggle={() => toggle('details')} />
        {open.includes('details') ? (
          <div style={{ padding: `${S.lg}px ${S.screenX}px` }}>
            <div style={{ fontSize: T.small.fontSize, color: C.textMuted, lineHeight: 1.6, marginBottom: S.lg }}>
              {club?.description || 'No description.'}
            </div>
            <button onClick={() => setShowDetails(true)} style={{
              width: '100%', minHeight: TOUCH.min, background: C.surface, color: C.teal,
              border: `1px solid ${C.teal}`, borderRadius: 12, fontSize: 15, fontWeight: 500,
              fontFamily: FONT_STACK, cursor: 'pointer',
            }}>Edit details</button>
          </div>
        ) : null}
      </div>

      <div style={{ height: `calc(${APP_BOTTOM_NAV_HEIGHT}px + ${S.xxl}px + env(safe-area-inset-bottom, 0px))` }} />
    </div>
  )
}
