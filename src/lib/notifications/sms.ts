// src/lib/notifications/sms.ts
// SMS notifications via Africa's Talking

import prisma from '@/lib/prisma/client'

interface SmsPayload {
  to: string | string[]
  message: string
  userId?: string
  templateId?: string
}

export async function sendSms(payload: SmsPayload): Promise<boolean> {
  const numbers = Array.isArray(payload.to) ? payload.to : [payload.to]

  try {
    const body = new URLSearchParams({
      username: process.env.AFRICASTALKING_USERNAME!,
      to: numbers.join(','),
      message: payload.message,
      from: process.env.AFRICASTALKING_SENDER_ID || 'STOKVEL',
    })

    const response = await fetch(
      'https://api.africastalking.com/version1/messaging',
      {
        method: 'POST',
        headers: {
          'apiKey': process.env.AFRICASTALKING_API_KEY!,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }
    )

    const result = await response.json()
    const success = result.SMSMessageData?.Recipients?.some(
      (r: any) => r.status === 'Success'
    )

    // Log to DB
    if (payload.userId) {
      await prisma.notification.create({
        data: {
          userId: payload.userId,
          channel: 'SMS',
          body: payload.message,
          status: success ? 'SENT' : 'FAILED',
          sentAt: success ? new Date() : undefined,
          templateId: payload.templateId,
        },
      })
    }

    return success
  } catch (error) {
    console.error('SMS send error:', error)
    return false
  }
}

// ── Notification templates ────────────────────────────────────
export const SMS_TEMPLATES = {
  contributionDue: (name: string, amount: string, date: string, group: string) =>
    `Hi ${name}, your ${group} contribution of ${amount} is due on ${date}. Pay via the platform or EcoCash to avoid late fees.`,

  contributionReceived: (name: string, amount: string, ref: string) =>
    `Hi ${name}, your contribution of ${amount} has been received. Ref: ${ref}. Thank you!`,

  payoutReleased: (name: string, amount: string, ref: string) =>
    `Congratulations ${name}! Your payout of ${amount} has been released. Ref: ${ref}. Check your EcoCash.`,

  paymentLate: (name: string, amount: string, daysLate: number) =>
    `Hi ${name}, your contribution of ${amount} is ${daysLate} day(s) overdue. Please pay immediately to avoid default. Visit the platform now.`,

  defaultWarning: (name: string, group: string) =>
    `IMPORTANT: ${name}, you have been declared in default on your ${group} group. Your account has been flagged. Contact your group admin immediately.`,

  loanApproved: (name: string, amount: string) =>
    `Hi ${name}, your loan application for ${amount} has been approved! Funds will be disbursed to your account within 2 business days.`,

  loanPaymentDue: (name: string, amount: string, date: string) =>
    `Hi ${name}, your loan repayment of ${amount} is due on ${date}. Ensure your account has sufficient funds.`,

  otpVerification: (otp: string) =>
    `Your Stokvel Platform verification code is: ${otp}. Valid for 10 minutes. Do not share this code with anyone.`,

  welcomeMember: (name: string, group: string) =>
    `Welcome to Stokvel Platform, ${name}! You have been added to ${group}. Complete your KYC verification to activate your account.`,
}
