// src/app/api/notifications/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { sendNotification, templates } from '@/lib/notifications/engine'

// ── GET — fetch notifications for a user ──────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId   = searchParams.get('userId')
    const unreadOnly = searchParams.get('unread') === 'true'
    const limit    = parseInt(searchParams.get('limit') || '50')

    if (!userId) return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 })

    const where: any = { userId, channel: 'IN_APP' }
    if (unreadOnly) where.status = 'DELIVERED'  // IN_APP unread = DELIVERED not READ

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    limit,
    })

    const unreadCount = await prisma.notification.count({
      where: { userId, channel: 'IN_APP', status: 'DELIVERED' },
    })

    return NextResponse.json({
      success: true,
      data: {
        notifications: notifications.map(n => ({
          id:        n.id,
          subject:   n.subject,
          body:      n.body,
          isRead:    n.status !== 'DELIVERED',
          metadata:  n.metadata,
          createdAt: n.createdAt,
        })),
        unreadCount,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST — mark read, mark all read, or send manual notification ─
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Mark single notification as read
    if (body.action === 'MARK_READ') {
      await prisma.notification.update({
        where: { id: body.notificationId },
        data:  { status: 'SENT' },  // SENT = read for IN_APP
      })
      return NextResponse.json({ success: true })
    }

    // Mark all as read for a user
    if (body.action === 'MARK_ALL_READ') {
      await prisma.notification.updateMany({
        where: { userId: body.userId, channel: 'IN_APP', status: 'DELIVERED' },
        data:  { status: 'SENT' },
      })
      return NextResponse.json({ success: true, message: 'All notifications marked as read' })
    }

    // Send announcement to all members of a group
    if (body.action === 'SEND_ANNOUNCEMENT') {
      const { groupId, title, message, channels, sentById } = body

      const members = await prisma.groupMember.findMany({
        where:   { groupId, status: 'ACTIVE' },
        include: { user: { select: { id: true, fullName: true } }, group: { select: { name: true } } },
      })

      let sent = 0
      for (const m of members) {
        const tmpl = templates.announcement(m.user.fullName, m.group.name, title, message)
        await sendNotification({
          userId:   m.userId,
          type:     'ANNOUNCEMENT',
          subject:  tmpl.subject,
          body:     tmpl.body,
          channels: channels || ['IN_APP', 'EMAIL'],
          metadata: { groupId, title, sentById },
        })
        sent++
      }

      return NextResponse.json({ success: true, message: `Announcement sent to ${sent} members` })
    }

    // Send a single manual notification
    if (body.action === 'SEND') {
      const { userId, subject, message, channels } = body
      const result = await sendNotification({
        userId,
        type:     'ANNOUNCEMENT',
        subject,
        body:     message,
        channels: channels || ['IN_APP'],
        metadata: { manual: true },
      })
      return NextResponse.json({ success: true, data: result })
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
