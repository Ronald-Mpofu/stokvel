'use client'
// src/components/mobile/LedgerRow.tsx
//
// One row of a passbook. The same component renders all four grammars —
// a paid month, an overdue installment, a rental distribution, a delivery
// — because the row's meaning arrives as a kind, not as a different shape.
//
// Row height, chip size and padding are identical across every kind on
// purpose. A ledger has to scan as a single column; if paid rows were
// shorter than due rows the eye would lose the column at the first
// status change.
//
// Module level, not defined inside a render. Helper components declared
// inside a parent remount on every state change, which on this screen
// would rebuild the whole ledger each time an accordion opened.

import { C, S, T, TOUCH, MONEY_STYLE, money } from '@/lib/mobile/tokens'
import { rowTone } from '@/lib/mobile/passbook'
import type { PassbookRow } from '@/lib/mobile/passbook'

type Props = {
  row: PassbookRow
  currency: string
}

export default function LedgerRow({ row, currency }: Props) {
  const tone = rowTone(row.kind, C as unknown as Record<string, string>)

  // amountText wins only when there is no number, so a "Nov" delivery row
  // and a "$1,400" funding row can sit in the same column.
  const value =
    typeof row.amount === 'number'
      ? money(row.amount, currency)
      : (row.amountText || '')

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: S.md,
        padding: `13px ${S.screenX}px`,
        minHeight: TOUCH.min,
        background: tone.rowBg || 'transparent',
        borderTop: `1px solid ${tone.ruleColor || C.border}`,
        opacity: tone.dim ? 0.6 : 1,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          flexShrink: 0,
          background: tone.chipBg,
          color: tone.chipFg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 17,
        }}
      >
        {tone.glyph}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: T.body.fontSize,
            fontWeight: 500,
            color: tone.titleColor || C.text,
          }}
        >
          {row.label}
        </div>
        <div
          style={{
            fontSize: T.caption.fontSize,
            color: tone.detailColor || C.textFaint,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.detail}
        </div>
      </div>

      <span
        style={{
          ...MONEY_STYLE,
          fontSize: 15,
          flexShrink: 0,
          fontWeight: row.kind === 'DUE' || row.kind === 'GOAL' ? 500 : 400,
          color: tone.amountColor || C.text,
        }}
      >
        {value}
      </span>
    </div>
  )
}
