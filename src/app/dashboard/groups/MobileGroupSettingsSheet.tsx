'use client'
// src/app/dashboard/groups/MobileGroupSettingsSheet.tsx
//
// Edit a group's details from a phone.
//
// THE TRAP THIS FILE EXISTS TO AVOID
//   PUT /api/groups takes no partial patches. The desktop update sends all
//   nineteen fields every time — even when it is only flipping status —
//   because the handler assigns every column from the body. A form that
//   posted only the fields it displays would blank treasurerId,
//   secretaryId, payoutStrategy, branding, penaltyRate and the rest.
//
//   So this sheet spreads the loaded group FIRST and overrides only what
//   the admin edited. Every field the phone does not show still travels,
//   carrying its current value.
//
// WHAT IS EDITABLE HERE
//   Name, description, where the group is, and the contribution terms. The
//   things an admin actually changes from a phone. Officers, payout
//   strategy, penalty and insurance rates stay on desktop: they are rarely
//   touched, and each needs explanation a 360px screen cannot give without
//   turning this into a form nobody finishes.
//
// All sub-components are at module level — declared inside the render they
// remount on every keystroke and steal focus mid-typing.

import { useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { C, S, T, TOUCH, FONT_STACK } from '@/lib/mobile/tokens'

const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: TOUCH.min,
  padding: `0 ${S.md}px`,
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  // 16px from the token scale. Smaller triggers iOS Safari zoom-on-focus.
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

function Segmented({
  options, value, onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div role="radiogroup" style={{
      display: 'flex', gap: 4, padding: 4, background: C.surfaceAlt,
      border: `1px solid ${C.border}`, borderRadius: 10,
    }}>
      {options.map(o => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: TOUCH.min - 10,
              background: on ? C.surface : 'transparent',
              color: on ? C.text : C.textMuted,
              border: on ? `1px solid ${C.border}` : '1px solid transparent',
              borderRadius: 8,
              fontSize: T.small.fontSize,
              fontWeight: on ? 500 : 400,
              fontFamily: FONT_STACK,
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

type Props = {
  group: any
  onClose: () => void
  onSaved: (message: string) => void
}

export default function MobileGroupSettingsSheet({ group, onClose, onSaved }: Props) {
  const [name, setName] = useState(group?.name || '')
  const [description, setDescription] = useState(group?.description || '')
  const [city, setCity] = useState(group?.city || '')
  const [contributionAmount, setContributionAmount] = useState(
    group?.contributionAmount != null ? String(group.contributionAmount) : ''
  )
  const [contributionDay, setContributionDay] = useState(
    group?.contributionDay != null ? String(group.contributionDay) : '1'
  )
  const [contributionFrequency, setContributionFrequency] = useState(
    group?.contributionFrequency || 'monthly'
  )
  const [maxMembers, setMaxMembers] = useState(
    group?.maxMembers != null ? String(group.maxMembers) : '10'
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const submit = useCallback(async () => {
    if (name.trim().length < 2) {
      setError('The group needs a name.')
      return
    }
    const day = Number(contributionDay)
    if (!Number.isFinite(day) || day < 1 || day > 28) {
      // 28 rather than 31: a contribution day of 30 has no February.
      setError('Contribution day must be between 1 and 28.')
      return
    }
    const amount = Number(contributionAmount)
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a valid contribution amount.')
      return
    }
    const cap = Number(maxMembers)
    if (!Number.isFinite(cap) || cap < 1) {
      setError('Enter a valid maximum number of members.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Everything the group already is. This spread is load-bearing:
          // the API assigns every column from the body, so a field omitted
          // here is a field wiped in the database.
          id: group.id,
          status: group.status,
          currency: group.currency,
          penaltyRate: group.penaltyRate,
          insurancePoolPct: group.insurancePoolPct,
          payoutStrategy: group.payoutStrategy,
          country: group.country || '',
          region: group.region || '',
          branding: group.branding || '',
          zipCode: group.zipCode || '',
          treasurerId: group.treasurerId || '',
          secretaryId: group.secretaryId || '',
          groupType: group.groupType || 'PRIVATE',
          publicAdvert: group.publicAdvert || '',

          // What this sheet edits.
          name: name.trim(),
          description: description.trim(),
          city: city.trim(),
          contributionAmount: amount,
          contributionDay: day,
          contributionFrequency,
          maxMembers: cap,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Could not save the group.')
      }
      onSaved(json.message || 'Group updated.')
    } catch (e: any) {
      setError(e?.message || 'Could not save the group.')
    } finally {
      setSaving(false)
    }
  }, [
    name, description, city, contributionAmount, contributionDay,
    contributionFrequency, maxMembers, group, onSaved,
  ])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(13,33,55,0.5)',
      display: 'flex', alignItems: 'flex-end', fontFamily: FONT_STACK,
    }}>
      <div
        onClick={saving ? undefined : onClose}
        style={{ position: 'absolute', inset: 0 }}
        aria-hidden="true"
      />

      <div role="dialog" aria-modal="true" aria-label="Group settings" style={{
        position: 'relative', width: '100%', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', background: C.surfaceAlt,
        borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: S.sm, flexShrink: 0,
          padding: `${S.md}px ${S.screenX}px`, background: C.surface,
          borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{ flex: 1, fontSize: T.title.fontSize, fontWeight: 500, color: C.text }}>
            Group settings
          </span>
          <button onClick={onClose} disabled={saving} aria-label="Close" style={{
            width: TOUCH.icon, height: TOUCH.icon, marginRight: -10,
            background: 'transparent', border: 'none', color: C.textMuted,
            fontSize: 24, fontFamily: FONT_STACK, cursor: saving ? 'default' : 'pointer',
          }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: `${S.lg}px ${S.screenX}px` }}>
          <Field label="Group name">
            <input value={name} onChange={e => setName(e.target.value)} autoFocus style={inputStyle} />
          </Field>

          <Field label="Description" hint="optional">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              style={{ ...inputStyle, minHeight: 84, padding: S.md, resize: 'vertical' }}
            />
          </Field>

          <Field label="City" hint="optional">
            <input value={city} onChange={e => setCity(e.target.value)} style={inputStyle} />
          </Field>

          <Field label="Contribution amount" hint={group?.currency || 'USD'}>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={contributionAmount}
              onChange={e => setContributionAmount(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field label="How often">
            <Segmented
              options={FREQUENCIES}
              value={contributionFrequency}
              onChange={setContributionFrequency}
            />
          </Field>

          <Field label="Contribution day" hint="1–28">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="28"
              value={contributionDay}
              onChange={e => setContributionDay(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field label="Maximum members">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={maxMembers}
              onChange={e => setMaxMembers(e.target.value)}
              style={inputStyle}
            />
          </Field>

          {error ? (
            <div role="alert" style={{
              background: C.redBg, color: '#7F1D1D', borderRadius: 10, padding: S.md,
              fontSize: T.small.fontSize, lineHeight: 1.45, marginBottom: S.md,
            }}>{error}</div>
          ) : null}

          <p style={{
            fontSize: T.caption.fontSize, color: C.textFaint,
            lineHeight: 1.5, margin: 0,
          }}>
            Officers, payout strategy and the penalty and insurance rates are
            changed from a computer.
          </p>
        </div>

        <div style={{
          flexShrink: 0, background: C.surface, borderTop: `1px solid ${C.border}`,
          padding: `${S.md}px ${S.screenX}px calc(${S.md}px + env(safe-area-inset-bottom, 0px))`,
        }}>
          <button onClick={submit} disabled={saving} style={{
            width: '100%', minHeight: TOUCH.primary,
            background: saving ? C.textFaint : C.teal, color: '#fff',
            border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 500,
            fontFamily: FONT_STACK, cursor: saving ? 'default' : 'pointer',
          }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
