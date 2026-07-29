'use client'
// src/lib/mobile/useIsMobile.ts
//
// Replaces the per-page useIsMobile copies.
//
// TWO FIXES OVER THE OLD VERSION
//
// 1. MOBILE-FIRST DEFAULT. The old hook initialised to `false`, so every
//    page server-rendered the DESKTOP layout, then flipped to mobile
//    after hydration. For an app whose users are overwhelmingly on
//    phones, that is backwards — and the reflow lands hardest on the
//    slowest devices. This defaults to `true` on the server, so phones
//    get a correct first paint and desktop users absorb the one flip.
//
// 2. matchMedia INSTEAD OF resize. The old hook called setState on every
//    resize event — dozens of renders while a window drags, and on
//    Android an address-bar show/hide counts as a resize. matchMedia
//    fires only when the breakpoint is actually crossed.
//
// The lazy initialiser also means client-side navigations have no flash
// at all: only the very first server-rendered paint uses the default.

import { useState, useEffect } from 'react'
import { MEDIA } from './tokens'

function query(media: string): boolean | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null
  return window.matchMedia(media).matches
}

export function useMediaQuery(media: string, ssrDefault: boolean): boolean {
  const [matches, setMatches] = useState<boolean>(() => query(media) ?? ssrDefault)

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(media)

    // Re-sync once on mount: if SSR guessed wrong, correct it immediately.
    setMatches(mq.matches)

    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)

    if (mq.addEventListener) {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    // Older Android WebView (Chrome < 39) has no addEventListener on
    // MediaQueryList. Worth keeping — plenty of these devices are live.
    mq.addListener(onChange)
    return () => mq.removeListener(onChange)
  }, [media])

  return matches
}

/** True on phone-sized screens. Defaults to true during SSR. */
export function useIsMobile(): boolean {
  return useMediaQuery(MEDIA.mobile, true)
}

/**
 * True once the component has mounted on the client.
 *
 * Use this to gate anything that MUST NOT render differently between
 * server and client — for example a layout whose desktop and mobile
 * versions have different DOM structure and would otherwise throw a
 * hydration mismatch.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

/**
 * Respects the OS "reduce motion" setting. Defaults to true on the
 * server — no animation is the safe first paint, and animating on a
 * low-end device is a cost, not a flourish.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)', true)
}
