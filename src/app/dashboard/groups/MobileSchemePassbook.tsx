'use client'
// src/app/dashboard/groups/MobileSchemePassbook.tsx — v4
//
// Fetches one scheme's passbook and hands it to PassbookShell.
//
// The split is deliberate. PassbookShell knows how to draw a ledger and
// nothing else — no fetching, no routing, no payment. This container knows
// where the data comes from and what the empty copy should say. So the
// shell stays reusable for the stake and repayment books when they arrive,
// and stays testable without a network.
//
// The route can legitimately return no view: the member may not be
// enrolled, the scheme's grammar may not be built, or the scheme may keep
// no ledger at all. Each is a real state with its own words, not an error,
// and none should show a spinner forever or a blank page.
//
// The admin's "set up first cycle" action carried over from the old
// NoCycleYet helper. An empty passbook is the state most admins meet first,
// and it should offer the one thing that fixes it.
//
// CHOOSING A BOOK
//   A scheme can hold several ledgers. WindfallScheme is one row per type,
//   but a group may run two grocery clubs or two savings pools beneath it.
//   When the route cannot tell which one the member means it returns the
//   list rather than picking, and this screen renders it as a chooser. The
//   choice is local state, so backing out of a book returns to the list
//   rather than reloading the scheme.
//
//   The list is a permanent level, not a tie-breaker — it shows even for a
//   single ledger, because it is where "add another" lives. An admin
//   already inside the one club needs somewhere to stand to create a
//   second, and the scheme card cannot offer that: they are enrolled.

import { useState, useEffect, useCallback } from 'react'
import { C, S, T, TOUCH, FONT_STACK } from '@/lib/mobile/tokens'
import { isPassbookView } from '@/lib/mobile/passbook'
import type { PassbookView } from '@/lib/mobile/passbook'
import PassbookShell from '@/components/mobile/PassbookShell'
import MobileGroceryClubSheet from './MobileGroceryClubSheet'
import MobileGroceryClubManage from './MobileGroceryClubManage'

// One ledger the member could open. Grocery clubs and savings pools both
// arrive in this shape; only the noun in the copy differs.
type LedgerChoice = {
  id: string
  name: string
  status?: string | null
  endDate?: string | null
  mine?: boolean
}

type Unavailable = {
  reason: string
  grammar?: string
  message: string
  clubs?: LedgerChoice[]
  pools?: LedgerChoice[]
  // Whether the caller may add another ledger under this scheme. Resolved
  // server-side by the same rule the hub uses.
  canManage?: boolean
  schemeType?: string
  groupId?: string
}

// Reasons that mean "pick one", not "nothing to show".
const CHOOSER_REASONS = new Set(['MULTIPLE_CLUBS', 'MULTIPLE_POOLS'])

const CLUB_STATUS_LABEL: Record<string, string> = {
  SETUP:       'Being set up',
  ACTIVE:      'Collecting contributions',
  PURCHASING:  'Buying under way',
  DISTRIBUTED: 'Goods handed over',
  CLOSED:      'Closed',
  CANCELLED:   'Cancelled',
}

// Empty-ledger copy per grammar. A savings pool and a grocery club are
// both waiting on an admin, but a member reads "collect" not "rotation".
const EMPTY_COPY: Record<string, { admin: string; member: string }> = {
  ROTATING: {
    admin: 'A cycle sets the contribution schedule and the payout order. Once it starts, everyone’s passbook fills in here.',
    member: 'Your passbook appears here once the group admin opens the first cycle.',
  },
  ACCUMULATING: {
    admin: 'Add the grocery items, then activate the club. That builds the contribution schedule and everyone’s passbook fills in here.',
    member: 'Your passbook appears here once the club has been activated.',
  },
}

const EMPTY_FALLBACK = {
  admin: 'Once contributions start being recorded for this scheme, they appear here.',
  member: 'When contributions start being recorded for this scheme, they appear here.',
}

function Notice({
  title, body, onBack,
}: {
  title: string
  body: string
  onBack: () => void
}) {
  return (
    <div style={{ fontFamily: FONT_STACK, background: C.surfaceAlt, minHeight: '100vh' }}>
      <div style={{ background: C.navy, padding: `14px ${S.screenX}px 18px` }}>
        <button
          onClick={onBack}
          aria-label="Back"
          style={{
            width: TOUCH.icon,
            height: TOUCH.icon,
            marginLeft: -12,
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.8)',
            fontSize: 22,
            cursor: 'pointer',
            fontFamily: FONT_STACK,
          }}
        >
          ←
        </button>
        <div
          style={{
            color: '#fff',
            fontSize: T.title.fontSize,
            fontWeight: 500,
            marginTop: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
      </div>

      <div style={{ background: C.surface, marginTop: S.md, padding: `${S.xxl}px ${S.screenX}px` }}>
        <p
          style={{
            fontSize: T.small.fontSize,
            color: C.textMuted,
            lineHeight: 1.6,
            margin: 0,
            maxWidth: 300,
          }}
        >
          {body}
        </p>
        <button
          onClick={onBack}
          style={{
            marginTop: S.xl,
            width: '100%',
            minHeight: TOUCH.primary,
            background: C.teal,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 16,
            fontWeight: 500,
            fontFamily: FONT_STACK,
            cursor: 'pointer',
          }}
        >
          Back to your schemes
        </button>
      </div>
    </div>
  )
}

// Module level, not defined in render — a chooser rebuilt on every state
// change would remount its rows and lose the tap mid-press.
function Chooser({
  title, intro, choices, onPick, onManage, onBack, createLabel, onCreate,
}: {
  title: string
  intro: string
  choices: LedgerChoice[]
  onPick: (id: string) => void
  // Set only for managers. Turns a club the caller is not in from an inert
  // row into a way to reach its setup screen.
  onManage?: (id: string) => void
  onBack: () => void
  // Absent for members, and for scheme types with no mobile create sheet.
  createLabel?: string | null
  onCreate?: () => void
}) {
  return (
    <div style={{ fontFamily: FONT_STACK, background: C.surfaceAlt, minHeight: '100vh' }}>
      <div style={{ background: C.navy, padding: `14px ${S.screenX}px 18px` }}>
        <button
          onClick={onBack}
          aria-label="Back"
          style={{
            width: TOUCH.icon,
            height: TOUCH.icon,
            marginLeft: -12,
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.8)',
            fontSize: 22,
            cursor: 'pointer',
            fontFamily: FONT_STACK,
          }}
        >
          ←
        </button>
        <div
          style={{
            color: '#fff',
            fontSize: T.title.fontSize,
            fontWeight: 500,
            marginTop: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: T.caption.fontSize, marginTop: 4 }}>
          {intro}
        </div>
      </div>

      <div style={{ background: C.surface, marginTop: S.md }}>
        {choices.map(c => {
          // A club the member is not in has no passbook of theirs to show.
          // Greyed and inert rather than hidden, so they can see it exists
          // and ask to be added — the same rule the scheme hub follows.
          const mine = c.mine !== false
          const manageable = !mine && Boolean(onManage)
          const status = c.status ? CLUB_STATUS_LABEL[c.status] || c.status : ''
          const detail = mine
            ? status || 'Open your book'
            : manageable
              ? status ? `${status} · set up` : 'Set up'
              : status ? `${status} · not enrolled` : 'Not enrolled'

          const body = (
            <>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div
                  style={{
                    fontSize: T.body.fontSize,
                    fontWeight: 500,
                    color: mine ? C.text : C.textMuted,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                </div>
                <div
                  style={{
                    fontSize: T.caption.fontSize,
                    color: C.textFaint,
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {detail}
                </div>
              </div>
              {mine || manageable ? (
                <span style={{ fontSize: 18, color: C.textFaint, flexShrink: 0 }}>›</span>
              ) : null}
            </>
          )

          const shared = {
            display: 'flex' as const,
            alignItems: 'center' as const,
            gap: S.md,
            width: '100%',
            minHeight: TOUCH.min,
            padding: `13px ${S.screenX}px`,
            borderTop: `1px solid ${C.border}`,
            background: mine ? C.surface : C.surfaceAlt,
            fontFamily: FONT_STACK,
          }

          if (!mine && !manageable) {
            return <div key={c.id} style={shared}>{body}</div>
          }

          // A manager in the club needs BOTH: the row opens their book, the
          // gear opens setup. Nested buttons are invalid HTML, so the two
          // sit side by side in a wrapper rather than one inside the other.
          const rowButton = (
            <button
              onClick={() => (mine ? onPick(c.id) : onManage!(c.id))}
              aria-label={mine ? `Open ${c.name}` : `Set up ${c.name}`}
              style={{
                ...shared,
                borderTop: 'none',
                border: 'none',
                cursor: 'pointer',
                paddingRight: mine && onManage ? S.sm : S.screenX,
              }}
            >
              {body}
            </button>
          )

          if (!(mine && onManage)) {
            return (
              <div key={c.id} style={{ borderTop: `1px solid ${C.border}` }}>
                {rowButton}
              </div>
            )
          }

          return (
            <div
              key={c.id}
              style={{ display: 'flex', alignItems: 'center', borderTop: `1px solid ${C.border}` }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>{rowButton}</div>
              <button
                onClick={() => onManage(c.id)}
                aria-label={`Set up ${c.name}`}
                style={{
                  width: TOUCH.icon,
                  height: TOUCH.icon,
                  marginRight: S.sm,
                  flexShrink: 0,
                  background: 'transparent',
                  border: 'none',
                  color: C.teal,
                  fontSize: 17,
                  cursor: 'pointer',
                  fontFamily: FONT_STACK,
                }}
              >
                ⚙
              </button>
            </div>
          )
        })}

        {createLabel && onCreate ? (
          <button
            onClick={onCreate}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: S.md,
              width: '100%',
              minHeight: TOUCH.min,
              padding: `13px ${S.screenX}px`,
              background: C.surface,
              border: 'none',
              borderTop: `1px solid ${C.border}`,
              cursor: 'pointer',
              fontFamily: FONT_STACK,
              textAlign: 'left',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                flexShrink: 0,
                background: C.tealBg,
                color: C.teal,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              +
            </span>
            <span style={{ flex: 1, fontSize: T.body.fontSize, fontWeight: 500, color: C.teal }}>
              {createLabel}
            </span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

// Scheme types with a mobile create sheet. A type absent from here shows
// its list without a create action rather than a button that opens nothing.
const CREATE_LABEL: Record<string, string> = {
  GROCERY_CLUB: 'New grocery club',
}

type Props = {
  schemeId: string
  schemeName: string
  onBack: () => void
  // Payment is not this component's business. The caller decides whether
  // that opens a sheet, a gateway, or a "not yet" toast.
  onPay?: (view: PassbookView) => void
  canManage?: boolean
  onStartCycle?: () => void
}

export default function MobileSchemePassbook({
  schemeId, schemeName, onBack, onPay, canManage, onStartCycle,
}: Props) {
  const [view, setView] = useState<PassbookView | null>(null)
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Which ledger the member picked from a chooser, if any. Local state, so
  // backing out returns to the list rather than refetching the scheme.
  const [ledgerId, setLedgerId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  // Which ledger is being managed, if any. A manager reaches setup either
  // from the Manage action on their own book, or straight from the list
  // when the club is not theirs — there is no passbook of theirs to open.
  const [manageId, setManageId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setUnavailable(null)
    try {
      // The route accepts clubId for grocery and poolId for savings. Both
      // are sent when a choice has been made; the route reads whichever
      // matches the scheme type and ignores the other.
      const pick = ledgerId
        ? `&clubId=${encodeURIComponent(ledgerId)}&poolId=${encodeURIComponent(ledgerId)}`
        : ''
      const res = await fetch(
        `/api/schemes/passbook?schemeId=${encodeURIComponent(schemeId)}${pick}`,
        { cache: 'no-store' }
      )
      const json = await res.json()

      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Please check your connection and try again.')
      }

      if (json.data?.unavailable) {
        setUnavailable(json.data.unavailable)
        setView(null)
        return
      }

      // Guarded rather than trusted. A malformed payload should cost the
      // member a message, not a white screen.
      setView(isPassbookView(json.data?.view) ? json.data.view : null)
    } catch (e: any) {
      setError(e?.message || 'Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [schemeId, ledgerId])

  useEffect(() => {
    load()
  }, [load])

  // Backing out of a chosen book returns to the chooser, not to the hub.
  const backFromBook = useCallback(() => {
    if (ledgerId) {
      setLedgerId(null)
      return
    }
    onBack()
  }, [ledgerId, onBack])

  const afterCreate = useCallback((message: string) => {
    setShowCreate(false)
    setNotice(message)
    // Reload rather than patch: the new club changes the list, and the
    // route decides what each row now reads.
    load()
  }, [load])

  if (manageId) {
    return (
      <MobileGroceryClubManage
        clubId={manageId}
        onBack={() => { setManageId(null); load() }}
        onChanged={load}
      />
    )
  }

  if (error) {
    return <Notice title={schemeName} body={error} onBack={backFromBook} />
  }

  if (unavailable) {
    const choices = unavailable.clubs || unavailable.pools || []
    const createLabel = unavailable.canManage && unavailable.schemeType
      ? CREATE_LABEL[unavailable.schemeType] || null
      : null

    // The list shows whenever the route offered one, or whenever a manager
    // could start the first ledger — an empty scheme with a create action
    // is still a list, just an empty one.
    if (CHOOSER_REASONS.has(unavailable.reason) && (choices.length > 0 || createLabel)) {
      const noun = unavailable.reason === 'MULTIPLE_CLUBS' ? 'club' : 'pool'
      return (
        <>
          {showCreate && unavailable.groupId ? (
            <MobileGroceryClubSheet
              groupId={unavailable.groupId}
              onClose={() => setShowCreate(false)}
              onCreated={afterCreate}
            />
          ) : null}
          <Chooser
            title={schemeName}
            intro={notice || (choices.length === 0
              ? `No ${noun}s yet`
              : `${choices.length} ${noun}${choices.length === 1 ? '' : 's'}`)}
            choices={choices}
            onPick={setLedgerId}
            // A manager opening a club they are not in has no passbook of
            // their own to show, so the row goes to setup instead of a
            // dead end. Without this the greying rule locks an admin out of
            // the very club they created for other people.
            onManage={unavailable.canManage && unavailable.schemeType === 'GROCERY_CLUB'
              ? setManageId
              : undefined}
            onBack={onBack}
            createLabel={createLabel}
            onCreate={() => setShowCreate(true)}
          />
        </>
      )
    }
    return <Notice title={schemeName} body={unavailable.message} onBack={backFromBook} />
  }

  const copy = (view && EMPTY_COPY[view.scheme.grammar]) || EMPTY_FALLBACK
  const canStart = Boolean(canManage && onStartCycle)

  return (
    <PassbookShell
      view={view}
      loading={loading}
      onBack={backFromBook}
      onAction={() => {
        if (view && onPay) onPay(view)
      }}
      emptyTitle={canStart ? 'Start the first cycle' : 'No cycle running yet'}
      emptyBody={canStart ? copy.admin : copy.member}
      emptyActionLabel={canStart ? 'Set up first cycle' : undefined}
      onEmptyAction={canStart ? onStartCycle : undefined}
    />
  )
}
