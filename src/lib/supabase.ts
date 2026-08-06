// src/lib/supabase/server.ts
//
// Server-only Supabase client, used exclusively for Storage.
//
// WHY THIS EXISTS AT ALL
//   Every other database access on this platform goes through Prisma,
//   which talks to Postgres directly and never needs the Supabase SDK.
//   Storage is the exception: object upload and signed-URL issuance
//   have no Prisma equivalent.
//
// SECURITY
//   This module uses SUPABASE_SERVICE_ROLE_KEY, which bypasses row-level
//   security entirely. It must never reach the browser. Two guards:
//
//     1. import 'server-only' — the build FAILS if any client component
//        imports this file, rather than silently shipping the key.
//     2. The key is read from a non-NEXT_PUBLIC_ variable, so Next.js
//        will not inline it into the client bundle.
//
//   Authorisation is enforced in the API routes that call this, not by
//   storage policies. The 'group-documents' bucket is private with no
//   RLS policies: nothing reaches an object except through a route that
//   has already checked the session and the caller's group role.

import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const GROUP_DOCS_BUCKET = 'group-documents'

// Signed URLs are short-lived. A group constitution carries every
// member's name and often their contribution amounts; a long-lived URL
// is a permanent leak if it is ever pasted into a chat or email.
export const SIGNED_URL_TTL_SECONDS = 300 // 5 minutes

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB — matches the bucket

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
] as const

let cached: SupabaseClient | null = null

/**
 * Returns the service-role Supabase client.
 *
 * Throws rather than returning null: a route that reaches this point has
 * already decided it needs storage, and a null client would surface as a
 * confusing downstream TypeError instead of a clear configuration error.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  }
  if (!key) {
    // Named explicitly: this is the single most common deployment
    // failure here, because the variable exists in .env.local but was
    // never added to the Vercel environment.
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — add it to the Vercel environment and redeploy')
  }

  cached = createClient(url, key, {
    auth: {
      // No session persistence or token refresh: this client is
      // stateless and per-request on the server.
      persistSession:   false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return cached
}

/**
 * Builds the storage object key for a group document.
 *
 * Layout: groups/{groupId}/{docType}/v{version}-{safeName}
 *
 * Version is in the path, so a new version never overwrites its
 * predecessor and a superseded constitution stays retrievable — which
 * matters, because the bank may still be acting on the version it holds.
 */
export function buildDocumentPath(
  groupId: string,
  docType: string,
  version: number,
  originalName: string,
): string {
  // Storage keys must not carry path separators or exotic characters.
  // Collapse anything unsafe and cap the length so the key stays sane.
  const safeName = (originalName || 'document')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(-80)

  return `groups/${groupId}/${docType.toLowerCase()}/v${version}-${safeName}`
}

/**
 * Issues a short-lived signed URL for a stored object.
 * Returns null when the object is missing or the signing call fails —
 * callers decide whether that is a 404 or a partial result.
 */
export async function getSignedUrl(storagePath: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .storage
      .from(GROUP_DOCS_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)

    if (error || !data?.signedUrl) {
      console.error('Signed URL error:', error?.message, storagePath)
      return null
    }
    return data.signedUrl
  } catch (e: any) {
    console.error('Signed URL exception:', e?.message)
    return null
  }
}
