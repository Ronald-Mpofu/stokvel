// src/app/api/auth/me/route.ts
// Current user identity + entitlement.
// Version 2.0 — security rewrite.
//
// ── WHAT v1 DID ──────────────────────────────────────────────
// v1 had four identity paths. Three were exploitable:
//
//   1. ?as=email        No NODE_ENV guard. Live in production. Any
//                       authenticated caller could read any other
//                       user's identity, SYSTEM_ADMIN included.
//
//   2. JWT verify       Own hardcoded secret fallback,
//                       'stokvel-secret-key-2025', which differs from
//                       the one in lib/auth AND lib/auth/edge and is in
//                       git history. Used bare jwtVerify, so no `typ`
//                       check — a 7-day refresh token was accepted as
//                       an access token, defeating the 15-minute expiry
//                       that verifyAccessToken exists to enforce.
//
//   3. portal_user_id   An UNSIGNED cookie treated as identity.
//                       Setting it to any uuid impersonated that user
//                       outright.
//
//   4. Admin fallback   Returned the first SYSTEM_ADMIN with NO
//                       credentials presented at all.
//
// Only middleware.ts stood in front of paths 3 and 4 — /api/auth/me is
// not in API_PUBLIC, so unauthenticated callers got a 401. That made
// the entire identity layer rest on one middleware allowlist entry.
//
// ── WHAT v2 DOES ─────────────────────────────────────────────
// One path: verified access token → session → entitlement. The dev
// override survives, gated behind NODE_ENV !== 'production'. Paths 3
// and 4 are deleted. No local secret — all verification goes through
// lib/auth, which fixes the secret divergence as a side effect.
//
// grep confirmed portal_user_id appeared in this file and nowhere else
// in src/, so removing it breaks no other call site.
//
// ── RESPONSE SHAPE ───────────────────────────────────────────
// Backwards compatible. `data` still carries { id, fullName, email,
// role }; existing callers are unaffected. New fields are additive:
//   data.tier, data.kycStatus, data.status
//   entitlement  — phase 1 shadow mode; ADVISORY ONLY, enforces nothing

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { getClaimsFromRequest, unauthorized } from '@/lib/auth'
import { getEntitlementFromRequest, ENTITLEMENT_ENFORCED } from '@/lib/entitlement'

export const dynamic = 'force-dynamic'

const USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  tier: true,
  kycStatus: true,
  status: true,
} as const

export async function GET(req: NextRequest) {
  try {
    // ── Development-only impersonation ──────────────────────
    // Hard-gated. In production this branch does not exist: the check
    // is on NODE_ENV, not on a header or a query flag a caller could
    // influence. Returns 403 rather than silently ignoring the param,
    // so a stray ?as= in deployed client code fails loudly in testing
    // instead of quietly returning the wrong user.
    const asEmail = req.nextUrl.searchParams.get('as')
    if (asEmail) {
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json(
          { success: false, error: 'Not available.' },
          { status: 403 }
        )
      }

      const devUser = await prisma.user.findUnique({
        where: { email: asEmail },
        select: USER_SELECT,
      })

      if (!devUser) {
        return NextResponse.json(
          { success: false, error: `No user found with email: ${asEmail}` },
          { status: 404 }
        )
      }

      return NextResponse.json({
        success: true,
        data: devUser,
        entitlement: null,
        dev: true,
      })
    }

    // ── The only production identity path ───────────────────
    // getClaimsFromRequest reads the access_token cookie or Bearer
    // header, verifies via lib/auth (which rejects refresh tokens and
    // throws in production on a missing JWT_SECRET), and memoises per
    // request. Zero database queries.
    const claims = await getClaimsFromRequest(req)
    if (!claims) return unauthorized('Not authenticated.')

    // One query for the live record. The token is a snapshot from issue
    // time; role and status can have changed since, and this endpoint is
    // what the client trusts for identity, so it reads live.
    const user = await prisma.user.findUnique({
      where: { id: claims.id },
      select: USER_SELECT,
    })

    if (!user) {
      // Valid signature, user no longer exists — deleted or purged.
      return unauthorized('Account no longer exists.')
    }

    if (user.status === 'BLACKLISTED') {
      return NextResponse.json(
        { success: false, error: 'This account has been suspended.' },
        { status: 403 }
      )
    }

    // Entitlement is advisory in phase 1. It is resolved and returned
    // so the client can be built against it and so the shadow log fills
    // up, but nothing here acts on the result. Memoised per request, so
    // this costs one query no matter how many guards also call it.
    const entitlement = await getEntitlementFromRequest(req)

    return NextResponse.json({
      success: true,
      data: user,
      entitlement,
      enforced: ENTITLEMENT_ENFORCED,
    })
  } catch (e: any) {
    console.error('GET /api/auth/me error:', e?.message)
    return NextResponse.json(
      { success: false, error: 'Could not resolve current user.' },
      { status: 500 }
    )
  }
}
