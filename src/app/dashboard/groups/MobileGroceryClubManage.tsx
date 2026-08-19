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
// SCOPE
//   Items, members, club details, activation. Purchasing (actual prices,
//   receipts) and payment recording are deliberately absent: buying needs
//   a receipt-capture surface of its own, and recording payments needs the
//   attestation flow that is still pending. Both stay on desktop for now.
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
