'use client'
// src/components/SessionKeeper.tsx
//
// Keeps a signed-in session alive by calling /api/auth/refresh before
// the access token expires.
//
// WHY THIS IS NEEDED
//   The access token lives 15 minutes by default (JWT_EXPIRY) and the
//   refresh token lives 7 days — but nothing was calling the refresh
//   endpoint, so the 7-day capability sat unused and every session died
//   at the 15-minute mark. Anyone doing slow, careful work was logged
//   out mid-task with no warning.
//
// WHY NOT JUST LENGTHEN THE ACCESS TOKEN
//   The short expiry is what bounds how long a suspended or removed
//   member keeps working: middleware reads role and identity straight
//   from the token without a database hit. Lengthening it widens that
//   window. Refreshing keeps the window short AND the session alive.
//
// WHAT IT GUARDS AGAINST
//   - Background tabs: browsers throttle or suspend timers, so a timer
//     alone is not enough. Refreshing on visibilitychange covers the
//     case where a tab sits idle past the expiry and is then returned
//     to — which is exactly how sessions were being lost.
//   - Network drops: refresh again on 'online'.
//   - Multiple tabs: an in-flight guard plus a minimum interval stops
//     several tabs racing to rotate the same refresh token.
//   - Logged-out visitors: public pages never call refresh, so an
//     anonymous visitor generates no traffic and sees no errors.

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

// Pages that never have a session. Kept in sync with PUBLIC_ROUTES in
// middleware.ts — a page listed there must be listed here, or an
// anonymous visitor triggers a pointless 401 on a timer.
const PUBLIC_PREFIXES = [
  '/login', '/register', '/setup', '/invite', '/guarantor',
  '/forgot-password', '/reset-password', '/verify-email',
]

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true
  return PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
}

export default function SessionKeeper({
  intervalMinutes = 10,
  minGapSeconds = 120,
}: {
  /**
   * How often to refresh. Must stay comfortably below JWT_EXPIRY —
   * 10 minutes against the 15-minute default leaves a third of the
   * lifetime as headroom for a slow request or a suspended timer.
   * Raising JWT_EXPIRY does not require changing this; refreshing more
   * often than necessary is harmless.
   */
  intervalMinutes?: number
  /** Floor between refreshes, so focus events cannot cause a storm. */
  minGapSeconds?: number
}) {
  const pathname   = usePathname()
  const inFlight   = useRef(false)
  const lastRun    = useRef(0)
  const stopped    = useRef(false)

  useEffect(() => {
    if (isPublicPath(pathname || '')) return
    // A previous 401 means there is no valid refresh token. Retrying on
    // a timer would just generate noise until the user logs in again.
    if (stopped.current) return

    let timer: ReturnType<typeof setInterval> | null = null

    async function refresh(reason: string) {
      if (inFlight.current || stopped.current) return
      if (Date.now() - lastRun.current < minGapSeconds * 1000) return

      inFlight.current = true
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Cookies are httpOnly and same-origin; this is explicit
          // rather than relying on the default.
          credentials: 'same-origin',
        })

        if (res.status === 401) {
          // The refresh token is gone or expired. Stop trying. No
          // redirect from here: middleware will route the next
          // navigation to /login, and yanking someone out of a form
          // they are mid-way through is worse than letting them find
          // out when they next act.
          stopped.current = true
          return
        }

        if (res.ok) lastRun.current = Date.now()
      } catch {
        // Offline or transient. Leave lastRun alone so the next
        // trigger — including the 'online' event — retries promptly.
      } finally {
        inFlight.current = false
      }
    }

    // Refresh once on mount. A tab restored from bfcache, or opened
    // from a bookmark after a long gap, may already be close to expiry.
    refresh('mount')

    timer = setInterval(() => refresh('interval'), intervalMinutes * 60 * 1000)

    // Timers are throttled in background tabs, so returning to a tab is
    // the moment most likely to find a stale token.
    const onVisible = () => { if (document.visibilityState === 'visible') refresh('visible') }
    const onOnline  = () => refresh('online')

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onVisible)

    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onVisible)
    }
  }, [pathname, intervalMinutes, minGapSeconds])

  // Renders nothing. It exists only for its effect.
  return null
}
