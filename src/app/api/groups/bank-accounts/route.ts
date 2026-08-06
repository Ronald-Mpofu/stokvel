// src/app/api/groups/bank-accounts/route.ts
//
// Group bank accounts and their mandate signatories.
//
// SCOPE
//   Windfall never holds group funds. These records exist so that
//   contributions and payouts can be INSTRUCTED and RECONCILED against
//   a destination the group itself owns. Nothing here moves money.
//
// WHY SIGNATORIES LIVE IN THIS FILE
//   A signatory has no meaning outside its account — the mandate is per
//   account, not per group, because a group may run a current account
//   and a fixed deposit under different mandates. Splitting them across
//   two routes would mean two round trips to render one panel.
//
// THE RULE THAT MAKES THE MANDATE REAL
//   An account cannot reach ACTIVE until it has at least
//   signatoriesRequired active signatories. Without that check the
//   field is decorative: a group could record "two signatories
//   required" and name none.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'
import { getSessionFromRequest, requireGroupManager } from '@/lib/auth'

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

// ── Schemas ───────────────────────────────────────────────────
const accountSchema = z.object({
  groupId:             z.string().uuid(),
  accountType:         z.enum(['BANK','MOBILE_WALLET']).default('BANK'),
  bankName:            z.string().max(160).nullish().transform(v => v || null),
  accountName:         z.string().min(2).max(160),
  accountNumber:       z.string().max(64).nullish().transform(v => v || null),
  branchName:          z.string().max(160).nullish().transform(v => v || null),
  branchCode:          z.string().max(32).nullish().transform(v => v || null),
  swiftCode:           z.string().max(32).nullish().transform(v => v || null),
  walletProvider:      z.string().max(80).nullish().transform(v => v || null),
  walletNumber:        z.string().max(64).nullish().transform(v => v || null),
  walletName:          z.string().max(160).nullish().transform(v => v || null),
  currency:            z.string().min(3).max(3).default('USD'),
  country:             z.string().max(2).nullish().transform(v => v || null),
  signatoriesRequired: z.coerce.number().int().min(1).max(10).default(2),
  isPrimary:           z.coerce.boolean().default(false),
  notes:               z.string().max(600).nullish().transform(v => v || null),
})

const signatorySchema = z.object({
  bankAccountId: z.string().uuid(),
  userId:        z.string().uuid(),
  mandateRole:   z.enum(['CHAIRPERSON','SECRETARY','TREASURER','MEMBER']).default('MEMBER'),
})

// The identifier CHECK constraint is enforced in Postgres, but catching
// it here returns a field-level message instead of a driver error.
function identifierError(d: z.infer<typeof accountSchema>): string | null {
  if (d.accountType === 'BANK' && !d.accountNumber) return 'Account number is required for a bank account'
  if (d.accountType === 'MOBILE_WALLET' && !d.walletNumber) return 'Wallet number is required for a mobile wallet'
  return null
}

// ── GET — accounts with signatories, one round trip ──────────
// Supabase is in Tokyo and Vercel in Washington DC, so every extra
// query costs ~160ms. Signatories come back as a JSON array on each
// account row rather than as a second query.
export async function GET(req: NextRequest) {
  try {
    const groupId = req.nextUrl.searchParams.get('groupId')
    if (!groupId) {
      return NextResponse.json({ success: false, error: 'groupId is required' }, { status: 400 })
    }

    const guardErr = await requireGroupManager(req, groupId, { verifyStatus: false })
    if (guardErr) return guardErr

    const rows = await sql(
      `SELECT
         a.id, a."groupId", a."accountType",
         a."bankName", a."accountName", a."accountNumber",
         a."branchName", a."branchCode", a."swiftCode",
         a."walletProvider", a."walletNumber", a."walletName",
         a.currency, a.country, a."signatoriesRequired",
         a."isPrimary", a.status, a."verifiedAt", a.notes,
         a."createdAt", a."updatedAt",
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id',          s.id,
                    'userId',      s."userId",
                    'fullName',    u."fullName",
                    'email',       u.email,
                    'mandateRole', s."mandateRole",
                    'status',      s.status,
                    'appointedAt', s."appointedAt"
                  ) ORDER BY
                    CASE s."mandateRole"
                      WHEN 'CHAIRPERSON' THEN 1
                      WHEN 'TREASURER'   THEN 2
                      WHEN 'SECRETARY'   THEN 3
                      ELSE 4
                    END,
                    u."fullName")
           FROM "GroupSignatory" s
           JOIN "User" u ON u.id = s."userId"
           WHERE s."bankAccountId" = a.id AND s.status = 'ACTIVE'
         ), '[]'::json) AS signatories
       FROM "GroupBankAccount" a
       WHERE a."groupId" = $1 AND a."deletedAt" IS NULL
       ORDER BY a."isPrimary" DESC, a."createdAt" ASC`,
      [groupId],
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (e: any) {
    console.error('GET /api/groups/bank-accounts error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to load bank accounts') }, { status: 500 })
  }
}

// ── POST — create account, or appoint a signatory ────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const action = body?.action || 'create-account'

    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // ── Appoint a signatory ──────────────────────────────────
    if (action === 'add-signatory') {
      const parsed = signatorySchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ success: false, error: parsed.error.errors[0]?.message || 'Invalid signatory' }, { status: 400 })
      }
      const d = parsed.data

      // Resolve the account's group from the account itself. Never trust
      // a groupId in the body — it would let a caller who manages group A
      // attach a signatory to group B's account.
      const acc = await sql(
        `SELECT id, "groupId", status FROM "GroupBankAccount"
          WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [d.bankAccountId],
      )
      if (!acc.length) {
        return NextResponse.json({ success: false, error: 'Bank account not found' }, { status: 404 })
      }

      const guardErr = await requireGroupManager(req, acc[0].groupId, { verifyStatus: true })
      if (guardErr) return guardErr

      // Signatories are drawn from active members of THIS group only.
      const member = await sql(
        `SELECT gm.id, u."fullName"
           FROM "GroupMember" gm
           JOIN "User" u ON u.id = gm."userId"
          WHERE gm."groupId" = $1 AND gm."userId" = $2 AND gm.status = 'ACTIVE'
          LIMIT 1`,
        [acc[0].groupId, d.userId],
      )
      if (!member.length) {
        return NextResponse.json(
          { success: false, error: 'That person is not an active member of this group' },
          { status: 400 },
        )
      }

      const existing = await sql(
        `SELECT id FROM "GroupSignatory"
          WHERE "bankAccountId" = $1 AND "userId" = $2 AND status = 'ACTIVE' LIMIT 1`,
        [d.bankAccountId, d.userId],
      )
      if (existing.length) {
        return NextResponse.json({ success: false, error: 'Already a signatory on this account' }, { status: 409 })
      }

      const id = randomUUID()
      await exec(
        `INSERT INTO "GroupSignatory"
           (id, "groupId", "bankAccountId", "userId", "mandateRole", status, "appointedById")
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)`,
        [id, acc[0].groupId, d.bankAccountId, d.userId, d.mandateRole, session.id],
      )

      return NextResponse.json({
        success: true,
        data: { id },
        message: `${member[0].fullName} added as ${d.mandateRole.toLowerCase()} signatory`,
      })
    }

    // ── Create a bank account ────────────────────────────────
    const parsed = accountSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0]?.message || 'Invalid account details' }, { status: 400 })
    }
    const d = parsed.data

    const idErr = identifierError(d)
    if (idErr) return NextResponse.json({ success: false, error: idErr }, { status: 400 })

    const guardErr = await requireGroupManager(req, d.groupId, { verifyStatus: true })
    if (guardErr) return guardErr

    const id = randomUUID()

    // If this account is being made primary, demote any existing primary
    // in the same currency first — the partial unique index would
    // otherwise reject the insert.
    if (d.isPrimary) {
      await exec(
        `UPDATE "GroupBankAccount"
            SET "isPrimary" = false, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "groupId" = $1 AND currency = $2 AND "isPrimary" = true AND "deletedAt" IS NULL`,
        [d.groupId, d.currency],
      )
    }

    await exec(
      `INSERT INTO "GroupBankAccount"
         (id, "groupId", "accountType", "bankName", "accountName", "accountNumber",
          "branchName", "branchCode", "swiftCode",
          "walletProvider", "walletNumber", "walletName",
          currency, country, "signatoriesRequired", "isPrimary",
          status, notes, "createdById")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'PENDING_VERIFICATION',$17,$18)`,
      [
        id, d.groupId, d.accountType, d.bankName, d.accountName, d.accountNumber,
        d.branchName, d.branchCode, d.swiftCode,
        d.walletProvider, d.walletNumber, d.walletName,
        d.currency, d.country, d.signatoriesRequired, d.isPrimary,
        d.notes, session.id,
      ],
    )

    return NextResponse.json({
      success: true,
      data: { id },
      message: 'Account added. Appoint signatories, then activate it.',
    })
  } catch (e: any) {
    console.error('POST /api/groups/bank-accounts error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to save') }, { status: 500 })
  }
}

// ── PUT — update account, activate it, or resign a signatory ─
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const action = body?.action || 'update-account'

    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // ── Resign a signatory ───────────────────────────────────
    if (action === 'resign-signatory') {
      const sigId = String(body?.signatoryId || '')
      if (!sigId) {
        return NextResponse.json({ success: false, error: 'signatoryId is required' }, { status: 400 })
      }

      const rows = await sql(
        `SELECT s.id, s."groupId", s."bankAccountId", a.status AS account_status,
                a."signatoriesRequired",
                (SELECT count(*) FROM "GroupSignatory" x
                  WHERE x."bankAccountId" = s."bankAccountId" AND x.status = 'ACTIVE')::int AS active_count
           FROM "GroupSignatory" s
           JOIN "GroupBankAccount" a ON a.id = s."bankAccountId"
          WHERE s.id = $1 AND s.status = 'ACTIVE' LIMIT 1`,
        [sigId],
      )
      if (!rows.length) {
        return NextResponse.json({ success: false, error: 'Signatory not found' }, { status: 404 })
      }
      const r = rows[0]

      const guardErr = await requireGroupManager(req, r.groupId, { verifyStatus: true })
      if (guardErr) return guardErr

      // Removing a signatory must not silently leave an ACTIVE account
      // under-mandated. Refuse, and say what has to happen first.
      if (r.account_status === 'ACTIVE' && r.active_count <= r.signatoriesRequired) {
        return NextResponse.json({
          success: false,
          error: `This account requires ${r.signatoriesRequired} signatories and has ${r.active_count}. Appoint a replacement before removing this one.`,
          code: 'MANDATE_WOULD_BREAK',
        }, { status: 409 })
      }

      await exec(
        `UPDATE "GroupSignatory"
            SET status = 'RESIGNED', "resignedAt" = CURRENT_TIMESTAMP,
                "resignedReason" = $2, "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [sigId, String(body?.reason || '').slice(0, 400) || null],
      )

      return NextResponse.json({ success: true, message: 'Signatory removed' })
    }

    // ── Activate / suspend / close an account ────────────────
    if (action === 'set-status') {
      const accountId = String(body?.id || '')
      const status    = String(body?.status || '')
      if (!accountId || !['ACTIVE','SUSPENDED','CLOSED','PENDING_VERIFICATION'].includes(status)) {
        return NextResponse.json({ success: false, error: 'Invalid account or status' }, { status: 400 })
      }

      const rows = await sql(
        `SELECT a.id, a."groupId", a."signatoriesRequired",
                (SELECT count(*) FROM "GroupSignatory" s
                  WHERE s."bankAccountId" = a.id AND s.status = 'ACTIVE')::int AS active_count
           FROM "GroupBankAccount" a
          WHERE a.id = $1 AND a."deletedAt" IS NULL LIMIT 1`,
        [accountId],
      )
      if (!rows.length) {
        return NextResponse.json({ success: false, error: 'Bank account not found' }, { status: 404 })
      }
      const r = rows[0]

      const guardErr = await requireGroupManager(req, r.groupId, { verifyStatus: true })
      if (guardErr) return guardErr

      // The rule that makes the mandate real.
      if (status === 'ACTIVE' && r.active_count < r.signatoriesRequired) {
        return NextResponse.json({
          success: false,
          error: `This account requires ${r.signatoriesRequired} signatories and has ${r.active_count}. Appoint the remaining signatories before activating.`,
          code: 'INSUFFICIENT_SIGNATORIES',
        }, { status: 409 })
      }

      await exec(
        `UPDATE "GroupBankAccount"
            SET status = $2,
                "verifiedAt"   = CASE WHEN $2 = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE "verifiedAt" END,
                "verifiedById" = CASE WHEN $2 = 'ACTIVE' THEN $3 ELSE "verifiedById" END,
                "updatedAt"    = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [accountId, status, session.id],
      )

      return NextResponse.json({ success: true, message: `Account ${status.toLowerCase().replace('_',' ')}` })
    }

    // ── Update account details ───────────────────────────────
    const accountId = String(body?.id || '')
    if (!accountId) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    }

    const parsed = accountSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0]?.message || 'Invalid account details' }, { status: 400 })
    }
    const d = parsed.data

    const idErr = identifierError(d)
    if (idErr) return NextResponse.json({ success: false, error: idErr }, { status: 400 })

    const guardErr = await requireGroupManager(req, d.groupId, { verifyStatus: true })
    if (guardErr) return guardErr

    if (d.isPrimary) {
      await exec(
        `UPDATE "GroupBankAccount"
            SET "isPrimary" = false, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "groupId" = $1 AND currency = $2 AND "isPrimary" = true
            AND id <> $3 AND "deletedAt" IS NULL`,
        [d.groupId, d.currency, accountId],
      )
    }

    await exec(
      `UPDATE "GroupBankAccount"
          SET "accountType" = $2, "bankName" = $3, "accountName" = $4, "accountNumber" = $5,
              "branchName" = $6, "branchCode" = $7, "swiftCode" = $8,
              "walletProvider" = $9, "walletNumber" = $10, "walletName" = $11,
              currency = $12, country = $13, "signatoriesRequired" = $14,
              "isPrimary" = $15, notes = $16, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1 AND "groupId" = $17 AND "deletedAt" IS NULL`,
      [
        accountId, d.accountType, d.bankName, d.accountName, d.accountNumber,
        d.branchName, d.branchCode, d.swiftCode,
        d.walletProvider, d.walletNumber, d.walletName,
        d.currency, d.country, d.signatoriesRequired, d.isPrimary, d.notes,
        d.groupId,
      ],
    )

    return NextResponse.json({ success: true, message: 'Bank account updated' })
  } catch (e: any) {
    console.error('PUT /api/groups/bank-accounts error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to update') }, { status: 500 })
  }
}

// ── DELETE — soft delete ─────────────────────────────────────
// Financial records are never hard-deleted on this platform. The row
// stays, its signatories cascade-resign, and the partial unique indexes
// stop applying because they exclude deletedAt IS NOT NULL.
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    }

    const rows = await sql(
      `SELECT id, "groupId", status FROM "GroupBankAccount"
        WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1`,
      [id],
    )
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Bank account not found' }, { status: 404 })
    }

    const guardErr = await requireGroupManager(req, rows[0].groupId, { verifyStatus: true })
    if (guardErr) return guardErr

    await exec(
      `UPDATE "GroupSignatory"
          SET status = 'REMOVED', "resignedAt" = CURRENT_TIMESTAMP,
              "resignedReason" = 'Account removed', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "bankAccountId" = $1 AND status = 'ACTIVE'`,
      [id],
    )

    await exec(
      `UPDATE "GroupBankAccount"
          SET "deletedAt" = CURRENT_TIMESTAMP, "isPrimary" = false,
              status = 'CLOSED', "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [id],
    )

    return NextResponse.json({ success: true, message: 'Bank account removed' })
  } catch (e: any) {
    console.error('DELETE /api/groups/bank-accounts error:', e?.message)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to remove') }, { status: 500 })
  }
}
