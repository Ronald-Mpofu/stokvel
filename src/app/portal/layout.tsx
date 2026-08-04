// src/app/portal/layout.tsx
// Wrapper for every /portal/* page.
//
// ── DELIBERATELY EMPTY OF CHROME ─────────────────────────────
// v1 mounted AccountStatusBanner here. That put it ABOVE the portal's
// own sticky header — a warning floating over the app bar, before the
// member had seen the app at all. See Portal_Panel_Headers screenshot.
//
// The banner now renders inside src/app/portal/page.tsx, at the top of
// the content container and BELOW the header, which is where a page
// notice belongs.
//
// This layout is kept because /portal/membership and any future portal
// route still need a segment wrapper, and because deleting it would
// change routing behaviour for no benefit.

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
