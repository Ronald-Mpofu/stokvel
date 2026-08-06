// src/app/api/groups/documents/route.ts
//
// Group documents — constitution, welcome letter, dismissal letter,
// resolutions. Metadata in Postgres, bytes in the private
// 'group-documents' Supabase Storage bucket.
//
// VERSIONING IS NOT DECORATION
//   A constitution gets amended, and the bank may still be acting on
//   the version it holds. Uploading a replacement supersedes the
//   current row rather than overwriting it, and the old object stays
//   in storage under its own versioned key.
//
// ACCESS
//   The bucket is private with no RLS policies. Nothing reaches an
//   object except through GET ?action=download here, which checks the
//   session and group role and then issues a 5-minute signed URL.
//   A constitution carries every member's name and often their
//   contribution amounts; it must never sit behind a guessable
//   permanent URL.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'
import { getSessionFromRequest, requireGroupManager } from '@/lib/auth'
import {
  getSupabaseAdmin, getSignedUrl, buildDocumentPath,
  GROUP_DOCS_BUCKET, MAX_UPLOAD_BYTES, ALLOWED_MIME_TYPES,
} from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const IS_PROD = process.env.NODE_ENV === 'production'
function safeError(e: any, fallback: string): string {
  return IS_PROD ? fallback : (e?.message || fallback)
}

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

const DOC_TYPES = ['CONSTITUTION','WELCOME_LETTER','DISMISSAL_LETTER','RESOLUTION','OTHER'] as const

const DOC_LABELS: Record<string, string> = {
  CONSTITUTION:     'Constitution',
  WELCOME_LETTER:   'Welcome Letter',
  DISMISSAL_LETTER: 'Dismissal Letter',
  RESOLUTION:       'Board Resolution',
  OTHER:            'Document',
}

// ── GET — list documents, or issue a download URL ────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const action = searchParams.get('action')

    // ── Signed download URL for one document ────────────────
    if (action === 'download') {
      const docId = searchParams.get('id')
      if (!docId) {
        return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
      }

      const rows = await sql(
        `SELECT id, "groupId", "storagePath", "fileName", "mimeType"
           FROM "GroupDocument"
          WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [docId],
      )
      if (!rows.length) {
        return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 })
      }

      const guardErr = await requireGroupManager(req, rows[0].groupId, { verifyStatus: false })
      if (guardErr) return guardErr

      const url = await getSignedUrl(rows[0].storagePath)
      if (!url) {
        return NextResponse.json({ success: false, error: 'Could not generate download link' }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        data: { url, fileName: rows[0].fileName, mimeType: rows[0].mimeType },
      })
    }

    // ── List current documents for a group ──────────────────
    const groupId = searchParams.get('groupId')
    if (!groupId) {
      return NextResponse.json({ success: false, error: 'groupId is required' }, { status: 400 })
    }

    const guardErr = await requireGroupManager(req, groupId, { verifyStatus: false })
    if (guardErr) return guardErr

    // includeHistory=1 returns superseded versions too. Default is
    // current only, which is what the settings panel renders.
    const includeHistory = searchParams.get('includeHistory') === '1'

    const rows = await sql(
      `SELECT d.id, d."groupId", d."docType", d.title, d."fileName", d."mimeType",
              d."sizeBytes", d.version, d."isCurrent", d."uploadedAt", d."supersededAt",
              u."fullName" AS "uploadedByName"
         FROM "GroupDocument" d
         LEFT JOIN "User" u ON u.id = d."uploadedById"
        WHERE d."groupId" = $1
          AND d."deletedAt" IS NULL
          ${includeHistory ? '' : 'AND d."isCurrent" = true'}
        ORDER BY d."docType" ASC, d.version DESC`,
      [groupId],
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (e: any) {
    console.error('GET /api/groups/documents error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to load documents') }, { status: 500 })
  }
}

// ── POST — upload a document ─────────────────────────────────
// multipart/form-data: file, groupId, docType, title?
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const form = await req.formData()
    const file    = form.get('file') as File | null
    const groupId = String(form.get('groupId') || '')
    const docType = String(form.get('docType') || '')
    const title   = String(form.get('title') || '').slice(0, 200)

    if (!file || typeof file === 'string') {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
    }
    if (!groupId) {
      return NextResponse.json({ success: false, error: 'groupId is required' }, { status: 400 })
    }
    if (!DOC_TYPES.includes(docType as any)) {
      return NextResponse.json({ success: false, error: 'Invalid document type' }, { status: 400 })
    }

    const guardErr = await requireGroupManager(req, groupId, { verifyStatus: true })
    if (guardErr) return guardErr

    // Validate before touching storage — an oversized or wrong-typed
    // file should never reach the bucket.
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { success: false, error: `File is ${(file.size / 1048576).toFixed(1)} MB. Maximum is 10 MB.` },
        { status: 400 },
      )
    }
    if (file.size === 0) {
      return NextResponse.json({ success: false, error: 'File is empty' }, { status: 400 })
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type as any)) {
      return NextResponse.json(
        { success: false, error: 'Only PDF, Word, JPEG and PNG files are accepted' },
        { status: 400 },
      )
    }

    // Next version number for this group + type.
    const verRows = await sql(
      `SELECT COALESCE(MAX(version), 0)::int AS max_version
         FROM "GroupDocument"
        WHERE "groupId" = $1 AND "docType" = $2 AND "deletedAt" IS NULL`,
      [groupId, docType],
    )
    const version = (verRows[0]?.max_version || 0) + 1

    const storagePath = buildDocumentPath(groupId, docType, version, file.name)
    const buffer = Buffer.from(await file.arrayBuffer())

    const supabase = getSupabaseAdmin()
    const { error: uploadError } = await supabase
      .storage
      .from(GROUP_DOCS_BUCKET)
      .upload(storagePath, buffer, { contentType: file.type, upsert: false })

    if (uploadError) {
      console.error('Storage upload error:', uploadError.message, storagePath)
      return NextResponse.json({ success: false, error: safeError(uploadError, 'Upload failed') }, { status: 500 })
    }

    // Storage succeeded — now the metadata. If this fails, remove the
    // object so an orphan is not left in the bucket with no row to
    // reach it by.
    try {
      await exec(
        `UPDATE "GroupDocument"
            SET "isCurrent" = false, "supersededAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
          WHERE "groupId" = $1 AND "docType" = $2
            AND "isCurrent" = true AND "deletedAt" IS NULL`,
        [groupId, docType],
      )

      const id = randomUUID()
      await exec(
        `INSERT INTO "GroupDocument"
           (id, "groupId", "docType", title, "storagePath", "fileName",
            "mimeType", "sizeBytes", version, "isCurrent", "uploadedById")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
        [
          id, groupId, docType,
          title || DOC_LABELS[docType] || 'Document',
          storagePath, file.name, file.type, file.size, version,
          session.id,
        ],
      )

      return NextResponse.json({
        success: true,
        data: { id, version, fileName: file.name, sizeBytes: file.size },
        message: version > 1
          ? `${DOC_LABELS[docType]} uploaded as version ${version}. The previous version is retained.`
          : `${DOC_LABELS[docType]} uploaded.`,
      })
    } catch (dbError: any) {
      await supabase.storage.from(GROUP_DOCS_BUCKET).remove([storagePath]).catch(() => {})
      throw dbError
    }
  } catch (e: any) {
    console.error('POST /api/groups/documents error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Upload failed') }, { status: 500 })
  }
}

// ── DELETE — soft delete, restoring the previous version ─────
// The storage object is intentionally left in place. A constitution
// that was ever in force is a governance record, and deleting the
// bytes would make a superseded version unrecoverable.
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    }

    const rows = await sql(
      `SELECT id, "groupId", "docType", version, "isCurrent"
         FROM "GroupDocument"
        WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1`,
      [id],
    )
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 })
    }
    const doc = rows[0]

    const guardErr = await requireGroupManager(req, doc.groupId, { verifyStatus: true })
    if (guardErr) return guardErr

    await exec(
      `UPDATE "GroupDocument"
          SET "deletedAt" = CURRENT_TIMESTAMP, "isCurrent" = false,
              "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [id],
    )

    // Promote the most recent surviving version back to current, so
    // deleting a mistaken upload restores what was there before rather
    // than leaving the group with no constitution on record.
    if (doc.isCurrent) {
      await exec(
        `UPDATE "GroupDocument"
            SET "isCurrent" = true, "supersededAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = (
            SELECT id FROM "GroupDocument"
             WHERE "groupId" = $1 AND "docType" = $2 AND "deletedAt" IS NULL
             ORDER BY version DESC LIMIT 1
          )`,
        [doc.groupId, doc.docType],
      )
    }

    return NextResponse.json({ success: true, message: 'Document removed' })
  } catch (e: any) {
    console.error('DELETE /api/groups/documents error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to remove document') }, { status: 500 })
  }
}
