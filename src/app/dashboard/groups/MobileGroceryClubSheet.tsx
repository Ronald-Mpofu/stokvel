'use client'
// src/app/dashboard/groups/MobileGroceryClubSheet.tsx
//
// Create a grocery club from a phone.
//
// WHY THIS EXISTS
//   The desktop create modal is 820px wide. On the premise that a phone is
//   the only device many admins have, a group that cannot start a scheme on
//   mobile cannot be run at all. So this is a real create surface, not a
//   link to the desktop one.
//
// WHAT IT IS NOT
//   It does not create a WindfallScheme. WindfallScheme has
//   UNIQUE ("groupId","schemeType") — six rows per group, fixed. A grocery
//   club is an INSTANCE underneath the single GROCERY_CLUB row, which is
//   why making another one never adds a seventh card to the hub. The route
//   resolves and links the scheme itself.
//
// FIELD DISCIPLINE
//   Two fields are required: name and start date. Everything else has a
//   database default, so it lives behind "More options" and a first-time
//   admin can finish in two taps and a date. Full editing stays on the
//   club's own settings tab.
//
// ROSTER
//   "Add everyone in the group" sends enrolAllMembers and lets the server
//   resolve the roster. Selecting members individually would mean fetching
//   the member list before the sheet could open — a round trip on a metered
//   connection to fill a control most admins would leave alone.
//
// All sub-components are at module level. Declared inside the render they
// remount on every keystroke and steal input focus mid-typing.

import { useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { C, S, T, TOUCH, FONT_STACK } from '@/lib/mobile/tokens'

const FREQUENCIES: { value: string; label: string }[] = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'FORTNIGHTLY', label: 'Fortnightly' },
  { value: 'MONTHLY', label: 'Monthly' },
]

// Today in the device's own timezone. toISOString() would convert to UTC
// and hand an Australian admin yesterday's date for most of the morning.
function todayLocal(): string {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: T.small.fontSize,
  color: C.textMuted,
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: TOUCH.min,
  padding: `0 ${S.md}px`,
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  // 16px, from the token scale. Anything smaller makes iOS Safari zoom the
  // page on focus and throw the layout sideways mid-form.
  fontSize: T.input.fontSize,
  fontFamily: FONT_STACK,
  color: C.text,
  boxSizing: 'border-box',
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: S.lg }}>
      <label style={labelStyle}>
        {label}
        {hint ? (
          <span style={{ color: C.textFaint, fontWeight: 400 }}> · {hint}</span>
        ) : null}
      </label>
      {children}
    </div>
  )
}

function SegmentedControl({
  options, value, onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div
      role="radiogroup"
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        background: C.surfaceAlt,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
      }}
    >
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

function ToggleRow({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: S.md,
        width: '100%',
        minHeight: TOUCH.min,
        padding: `${S.sm}px 0`,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: FONT_STACK,
        textAlign: 'left',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: T.body.fontSize, color: C.text }}>{label}</div>
        {hint ? (
          <div style={{ fontSize: T.caption.fontSize, color: C.textFaint, marginTop: 2 }}>
            {hint}
          </div>
        ) : null}
      </div>
      <div
        aria-hidden="true"
        style={{
          width: 46,
          height: 28,
          flexShrink: 0,
          borderRadius: 999,
          background: checked ? C.teal : C.border,
          position: 'relative',
          transition: 'background 150ms',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 21 : 3,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 150ms',
          }}
        />
      </div>
    </button>
  )
}

type Props = {
  groupId: string
  onClose: () => void
  onCreated: (message: string) => void
}

export default function MobileGroceryClubSheet({ groupId, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(todayLocal())
  const [frequency, setFrequency] = useState('MONTHLY')
  const [periodMonths, setPeriodMonths] = useState('3')
  const [description, setDescription] = useState('')
  const [enrolAll, setEnrolAll] = useState(true)
  const [more, setMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A sheet over a scrollable list lets the list scroll behind it on touch.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const submit = useCallback(async () => {
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError('Give the club a name of at least two characters.')
      return
    }
    if (!startDate) {
      setError('Choose a start date.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/grocery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          name: trimmed,
          description: description.trim() || null,
          periodMonths: Number(periodMonths) || 3,
          contributionFrequency: frequency,
          startDate,
          enrolAllMembers: enrolAll,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Could not create the club. Please try again.')
      }
      onCreated(json.message || `"${trimmed}" created.`)
    } catch (e: any) {
      setError(e?.message || 'Could not create the club. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [name, startDate, description, periodMonths, frequency, enrolAll, groupId, onCreated])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(13,33,55,0.5)',
        display: 'flex',
        alignItems: 'flex-end',
        fontFamily: FONT_STACK,
      }}
    >
      {/* Tapping the dimmed area closes, but not while a request is in
          flight — a half-created club is worse than a stuck sheet. */}
      <div
        onClick={saving ? undefined : onClose}
        style={{ position: 'absolute', inset: 0 }}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create a grocery club"
        style={{
          position: 'relative',
          width: '100%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: C.surfaceAlt,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: S.sm,
            padding: `${S.md}px ${S.screenX}px`,
            background: C.surface,
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1, fontSize: T.title.fontSize, fontWeight: 500, color: C.text }}>
            New grocery club
          </span>
          <button
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            style={{
              width: TOUCH.icon,
              height: TOUCH.icon,
              marginRight: -10,
              background: 'transparent',
              border: 'none',
              color: C.textMuted,
              fontSize: 24,
              fontFamily: FONT_STACK,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: `${S.lg}px ${S.screenX}px` }}>
          <Field label="Club name">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. December Hampers"
              autoFocus
              style={inputStyle}
            />
          </Field>

          <Field label="Start date">
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field label="Members contribute" hint="how often">
            <SegmentedControl options={FREQUENCIES} value={frequency} onChange={setFrequency} />
          </Field>

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: S.sm }}>
            <ToggleRow
              label="Add everyone in the group"
              hint="You can change who is in the club afterwards"
              checked={enrolAll}
              onChange={setEnrolAll}
            />
          </div>

          <button
            type="button"
            onClick={() => setMore(v => !v)}
            style={{
              width: '100%',
              minHeight: TOUCH.min,
              background: 'transparent',
              border: 'none',
              borderTop: `1px solid ${C.border}`,
              color: C.teal,
              fontSize: T.small.fontSize,
              fontFamily: FONT_STACK,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {more ? 'Fewer options' : 'More options'}
          </button>

          {more ? (
            <div style={{ paddingTop: S.md }}>
              <Field label="Runs for" hint="months">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={24}
                  value={periodMonths}
                  onChange={e => setPeriodMonths(e.target.value)}
                  style={inputStyle}
                />
              </Field>

              <Field label="Description" hint="optional">
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What is this club buying?"
                  style={{ ...inputStyle, minHeight: 84, padding: S.md, resize: 'vertical' }}
                />
              </Field>
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              style={{
                background: C.redBg,
                color: '#7F1D1D',
                borderRadius: 10,
                padding: `${S.md}px ${S.md}px`,
                fontSize: T.small.fontSize,
                lineHeight: 1.45,
                marginTop: S.sm,
              }}
            >
              {error}
            </div>
          ) : null}

          <p
            style={{
              fontSize: T.caption.fontSize,
              color: C.textFaint,
              lineHeight: 1.5,
              margin: `${S.lg}px 0 0`,
            }}
          >
            The club starts in setup. Add grocery items next, then activate it to
            build the contribution schedule.
          </p>
        </div>

        <div
          style={{
            flexShrink: 0,
            padding: `${S.md}px ${S.screenX}px calc(${S.md}px + env(safe-area-inset-bottom, 0px))`,
            background: C.surface,
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <button
            onClick={submit}
            disabled={saving}
            style={{
              width: '100%',
              minHeight: TOUCH.primary,
              background: saving ? C.textFaint : C.teal,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 500,
              fontFamily: FONT_STACK,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Creating…' : 'Create club'}
          </button>
        </div>
      </div>
    </div>
  )
}
