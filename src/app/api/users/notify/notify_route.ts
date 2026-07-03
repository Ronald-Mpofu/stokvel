// src/app/api/users/notify/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function POST(req: NextRequest) {
  try {
    const { userId, email, fullName, subject, body, template } = await req.json()

    if (!email || !subject || !body) {
      return NextResponse.json({ success: false, error: 'email, subject and body are required' }, { status: 400 })
    }

    // ── Send via Resend (or any email provider) ───────────────
    // Resend is the recommended provider for Next.js/Vercel
    // Install: npm install resend
    // Set env var: RESEND_API_KEY in Vercel
    const RESEND_API_KEY = process.env.RESEND_API_KEY
    const FROM_EMAIL     = process.env.FROM_EMAIL || 'noreply@windfall.app'

    if (RESEND_API_KEY) {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from:    FROM_EMAIL,
          to:      [email],
          subject: subject,
          html:    `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#F8FAFC;padding:20px">
              <div style="background:#0D2137;borderRadius:12px;padding:24px;marginBottom:20px;text-align:center">
                <h1 style="color:white;font-size:20px;margin:0">🔄 Windfall Community Deals</h1>
              </div>
              <div style="background:white;borderRadius:12px;padding:24px;border:1px solid #E2E8F0">
                <pre style="font-family:Arial,sans-serif;white-space:pre-wrap;font-size:14px;color:#374151;line-height:1.6">${body}</pre>
              </div>
              <p style="text-align:center;color:#94A3B8;font-size:11px;margin-top:16px">
                Windfall Community Deals · stokvel-six.vercel.app
              </p>
            </div>
          `,
          text: body,
        }),
      })

      if (!emailRes.ok) {
        const err = await emailRes.json()
        console.error('Resend error:', err)
        // Fall through to notification log even if email fails
      }
    } else {
      // No email provider configured — log only
      console.log(`[EMAIL NOT SENT - No RESEND_API_KEY] To: ${email} | Subject: ${subject}`)
    }

    // ── Always create in-app notification ────────────────────
    if (userId) {
      await prisma.notification.create({
        data: {
          userId,
          type:    'SYSTEM',
          title:   subject,
          message: body.slice(0, 500),
          channel: 'EMAIL',
        } as any,
      }).catch(e => console.warn('Notification create failed (non-critical):', e.message))
    }

    // ── Audit log ─────────────────────────────────────────────
    await prisma.auditLog.create({
      data: {
        entityType:  'User',
        entityId:    userId || email,
        action:      'NOTIFY',
        description: `Email sent: "${subject}" to ${email} (template: ${template || 'CUSTOM'})`,
      } as any,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: RESEND_API_KEY
        ? `Email sent to ${email}`
        : `Notification logged (add RESEND_API_KEY to Vercel env vars to enable real email delivery)`,
    })
  } catch (e: any) {
    console.error('POST /api/users/notify error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
