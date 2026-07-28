// src/lib/auth/edge.ts
// Edge-runtime-safe JWT helpers.
//
// WHY THIS FILE EXISTS
// middleware.ts runs on the Edge runtime and cannot import
// src/lib/auth/index.ts, because that pulls in Prisma and next/headers.
// So middleware kept its own copy of JWT_SECRET — including its own
// copy of the insecure fallback. Two sources of truth for the value
// that secures every session in the platform.
//
// This module is the single source. It imports nothing beyond `jose`,
// so both the Edge middleware and the Node auth lib can use it.

import { jwtVerify } from 'jose'

let cachedSecret: Uint8Array | null = null

/**
 * Resolve the signing secret.
 *
 * Throws in production when unset or too short. That is deliberate: the
 * old fallback string is in git history, so signing with it would let
 * anyone forge a SYSTEM_ADMIN token. A loud 500 is strictly better than
 * a quiet forgeable session.
 */
export function getJwtSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret

  const raw = process.env.JWT_SECRET
  const isProd = process.env.NODE_ENV === 'production'

  if (!raw) {
    if (isProd) {
      throw new Error(
        '[auth/edge] JWT_SECRET is not set. Refusing to verify tokens ' +
        'with the development fallback in production.'
      )
    }
    console.warn('[auth/edge] JWT_SECRET not set — using INSECURE development fallback.')
    cachedSecret = new TextEncoder().encode('fallback-dev-secret-change-in-production')
    return cachedSecret
  }

  if (isProd && raw.length < 32) {
    throw new Error(
      '[auth/edge] JWT_SECRET must be at least 32 characters. ' +
      'Generate one with: openssl rand -base64 48'
    )
  }

  cachedSecret = new TextEncoder().encode(raw)
  return cachedSecret
}

export type EdgeClaims = {
  sub: string
  role: string | null
  email: string | null
  joiningFeePaid: boolean | undefined
}

/**
 * Verify an ACCESS token at the edge. Returns null on any failure.
 *
 * SECURITY: rejects refresh tokens. signRefreshToken uses the same
 * secret, so without this check a refresh token pasted into the
 * access_token cookie would grant a 7-day session — defeating the
 * 15-minute access token expiry entirely.
 *
 * Backwards compatible: tokens issued before the `typ` claim existed
 * carry no `typ` and still verify. Only explicit refresh tokens fail.
 */
export async function verifyEdgeAccessToken(token: string): Promise<EdgeClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())

    if (payload.typ === 'refresh' || (payload as any).type === 'refresh') return null
    if (!payload.sub) return null

    return {
      sub: String(payload.sub),
      role: (payload.role as string) ?? null,
      email: (payload.email as string) ?? null,
      // Older tokens will not carry this claim. `undefined` means
      // "unknown" and the fee gate deliberately fails open for unknown,
      // so pre-existing sessions are not locked out. `false` means
      // "known unpaid" and the gate closes.
      joiningFeePaid:
        typeof payload.joiningFeePaid === 'boolean'
          ? (payload.joiningFeePaid as boolean)
          : undefined,
    }
  } catch {
    return null
  }
}
