// src/app/api/notifications/route.ts
// Version 2.0 — authorisation + proper read state.
//
// ── WHAT v1 DID ──────────────────────────────────────────────
// No authorisation on any branch. Middleware only checks that the
// caller is logged in, so any authenticated user could:
//   · GET ?userId=<anyone>            read another person's notifications
//   · MARK_READ / MARK_ALL_READ       alter another person's state
//   · SEND_ANNOUNCEMENT               email + SMS every member of ANY
//                                     group they had nothing to do with
//   · SEND                            dispatch an arbitrary email and
//                                     SMS to any user
// The last two spend real money per message on Africa's Talking.
//
// ── READ STATE ───────────────────────────────────────────────
// v1 encoded read state in `status`: DELIVERED meant unread, SENT meant
// read. That collides with delivery semantics — a genuine receipt
// update would silently mark a notification read.
//
// v2 uses the readAt column from migration 2026-08-03. Both are written
// on mark-read so nothing that reads `status` breaks, and "unread" is
// readAt IS NULL AND status = 'DELIVERED' so pre-migration rows keep
// their existing behaviour.
//
// readAt is not in the Prisma model, so those queries use raw SQL.

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { sendNotification, templates } from '@/lib/notifications/engine'
import {
  getSessionFromRequest,
  requireGroupManager,
  unauthorized,
  forbidden,
  SUPER_ROLES,
} from '@/lib/auth'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 100

// ── GET — the caller's own notifications ──────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const requested = searchParams.get('userId')
    const unreadOnly = searchParams.get('unread') === 'true'
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1),
      MAX_LIMIT
    )

    // Defaults to the caller. Reading someone else needs a super role.
    const userId = requested || session.id
    if (userId !== session.id && !SUPER_ROLES.includes(session.role)) {
      return forbidden('Not authorised to view these notifications')
    }

    const unreadClause = `n."readAt" IS NULL AND n."status" = 'DELIVERED'::"NotificationStatus"`

    const notifications = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT n."id", n."subject", n."body", n."metadata", n."createdAt",
             n."readAt", n."groupId", n."templateId",
             (${unreadClause}) AS "isUnread"
      FROM "Notification" n
      WHERE n."userId" = $1
        AND n."channel" = 'IN_APP'::"NotificationChannel"
        ${unreadOnly ? `AND ${unreadClause}` : ''}
      ORDER BY n."createdAt" DESC
      LIMIT ${limit}
      `,
      userId
    )

    // Uses idx_notification_user_unread — one index scan, no table read.
    const counts = await prisma.$queryRawUnsafe<{ unread: bigint }[]>(
      `
      SELECT COUNT(*)::bigint AS unread
      FROM "Notification" n
      WHERE n."userId" = $1
        AND n."channel" = 'IN_APP'::"NotificationChannel"
        AND ${unreadClause}
      `,
      userId
    )

    return NextResponse.json({
      success: true,
      data: {
        notifications: notifications.map(n => ({
          id:        n.id,
          subject:   n.subject,
          body:      n.body,
          isRead:    !n.isUnread,
          readAt:    n.readAt,
          groupId:   n.groupId,
          templateId: n.templateId,
          metadata:  n.metadata,
          createdAt: n.createdAt,
        })),
        unreadCount: Number(counts?.[0]?.unread ?? 0),
      },
    })
  } catch (e: any) {
    console.error('GET /api/notifications error:', e?.message)
    return NextResponse.json({ success: false, error: 'Failed to load notifications' }, { status: 500 })
  }
}

// ── POST — mark read, mark all read, announce, or send ────────
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()

    const body = await req.json()
    const isSuper = SUPER_ROLES.includes(session.role)

    // ── Mark one as read ────────────────────────────────────
    if (body.action === 'MARK_READ') {
      if (!body.notificationId) {
        return NextResponse.json({ success: false, error: 'notificationId required' }, { status: 400 })
      }
      // Ownership is enforced in the WHERE clause, so a foreign id
      // simply updates nothing rather than leaking its existence.
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE "Notification"
         SET "readAt" = COALESCE("readAt", now()),
             "status" = 'SENT'::"NotificationStatus"
         WHERE "id" = $1 AND "userId" = $2`,
        body.notificationId, session.id
      )
      return NextResponse.json({ success: true, data: { updated: Number(updated) } })
    }

    // ── Mark all as read ────────────────────────────────────
    if (body.action === 'MARK_ALL_READ') {
      // userId from the body is ignored — always the caller.
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE "Notification"
         SET "readAt" = COALESCE("readAt", now()),
             "status" = 'SENT'::"NotificationStatus"
         WHERE "userId" = $1
           AND "channel" = 'IN_APP'::"NotificationChannel"
           AND "readAt" IS NULL`,
        session.id
      )
      return NextResponse.json({
        success: true,
        message: 'All notifications marked as read',
        data: { updated: Number(updated) },
      })
    }

    // ── Announcement to a group ─────────────────────────────
    if (body.action === 'SEND_ANNOUNCEMENT') {
      const { groupId, title, message, channels } = body
      if (!groupId || !title || !message) {
        return NextResponse.json(
          { success: false, error: 'groupId, title and message are required' },
          { status: 400 }
        )
      }

      // Only a manager of THIS group may broadcast to it.
      const guardErr = await requireGroupManager(req, groupId)
      if (guardErr) return guardErr

      const members = await prisma.groupMember.findMany({
        where:   { groupId, status: 'ACTIVE' },
        include: {
          user:  { select: { id: true, fullName: true, email: true, phone: true } },
          group: { select: { name: true } },
        },
      })

      // One key per announcement, so a double-click or a retry cannot
      // send the same broadcast twice.
      const batchKey = `announcement:${groupId}:${Date.now()}`

      let sent = 0
      for (const m of members) {
        const tmpl = templates.announcement(m.user.fullName, m.group.name, title, message)
        const res = await sendNotification({
          userId:   m.userId,
          type:     'ANNOUNCEMENT',
          subject:  tmpl.subject,
          body:     tmpl.body,
          channels: channels || ['IN_APP', 'EMAIL'],
          groupId,
          dedupeKey: `${batchKey}:${m.userId}`,
          email:    m.user.email,
          phone:    m.user.phone,
          fullName: m.user.fullName,
          // sentById comes from the session, not the body.
          metadata: { groupId, title, sentById: session.id },
        })
        if (res.sent.length) sent++
      }

      return NextResponse.json({
        success: true,
        message: `Announcement sent to ${sent} of ${members.length} members`,
      })
    }

    // ── Single manual send ──────────────────────────────────
    // Restricted to super roles: this dispatches real email and SMS to
    // an arbitrary user, which costs money per message and is the
    // obvious abuse route. Group admins broadcast via SEND_ANNOUNCEMENT,
    // which is scoped to a group they manage.
    if (body.action === 'SEND') {
      if (!isSuper) return forbidden('Not authorised to send direct notifications')

      const { userId, subject, message, channels } = body
      if (!userId || !subject || !message) {
        return NextResponse.json(
          { success: false, error: 'userId, subject and message are required' },
          { status: 400 }
        )
      }

      const result = await sendNotification({
        userId,
        type:     'ANNOUNCEMENT',
        subject,
        body:     message,
        channels: channels || ['IN_APP'],
        metadata: { manual: true, sentById: session.id },
      })
      return NextResponse.json({ success: true, data: result })
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    console.error('POST /api/notifications error:', e?.message)
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 })
  }
}
