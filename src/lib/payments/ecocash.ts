// src/lib/payments/ecocash.ts
// EcoCash mobile money integration for Zimbabwe

import prisma from '@/lib/prisma/client'
import type { CurrencyCode } from '@/types'

interface EcoCashPaymentRequest {
  amount: number
  currency: CurrencyCode
  phoneNumber: string
  reference: string
  description: string
  callbackUrl?: string
}

interface EcoCashPaymentResponse {
  success: boolean
  transactionId?: string
  status?: string
  message?: string
  pollUrl?: string
}

// EcoCash Paynow integration (production-ready pattern for Zimbabwe)
export async function initiateEcoCashPayment(
  req: EcoCashPaymentRequest
): Promise<EcoCashPaymentResponse> {
  try {
    // Format phone number (strip +263, ensure starts with 07x)
    const phone = formatZimPhone(req.phoneNumber)

    const body = new URLSearchParams({
      id: process.env.PAYNOW_INTEGRATION_ID!,
      key: process.env.PAYNOW_INTEGRATION_KEY!,
      reference: req.reference,
      amount: req.amount.toFixed(2),
      additionalinfo: req.description,
      authemail: '',
      phone,
      method: 'ecocash',
      resulturl: process.env.PAYNOW_RESULT_URL!,
      returnurl: process.env.PAYNOW_RETURN_URL!,
    })

    // Hash for security
    const hash = generatePaynowHash(body)
    body.append('hash', hash)

    const response = await fetch('https://www.paynow.co.zw/interface/remotetransaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    const text = await response.text()
    const result = parsePaynowResponse(text)

    if (result.status?.toLowerCase() === 'ok') {
      return {
        success: true,
        transactionId: result.paynowreference,
        pollUrl: result.pollurl,
        status: 'PENDING',
        message: 'Payment initiated — customer will receive EcoCash prompt',
      }
    }

    return {
      success: false,
      message: result.error || 'EcoCash payment initiation failed',
    }
  } catch (error) {
    console.error('EcoCash payment error:', error)
    return { success: false, message: 'Payment service unavailable' }
  }
}

// Poll payment status
export async function pollEcoCashStatus(pollUrl: string): Promise<{
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
  transactionId?: string
}> {
  try {
    const response = await fetch(pollUrl)
    const text = await response.text()
    const result = parsePaynowResponse(text)

    const status = result.status?.toLowerCase()
    if (status === 'paid') return { status: 'PAID', transactionId: result.paynowreference }
    if (status === 'cancelled') return { status: 'CANCELLED' }
    if (status === 'failed' || status === 'disputed') return { status: 'FAILED' }
    return { status: 'PENDING' }
  } catch {
    return { status: 'FAILED' }
  }
}

// Process Paynow callback (webhook handler)
export async function processPaynowCallback(params: Record<string, string>): Promise<void> {
  const { reference, status, paynowreference, amount } = params
  if (!reference || !status) return

  const transaction = await prisma.transaction.findFirst({
    where: { reference },
  })
  if (!transaction) return

  const isPaid = status.toLowerCase() === 'paid'

  await prisma.$transaction(async (tx) => {
    // Update transaction status
    await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: isPaid ? 'COMPLETED' : 'FAILED',
        externalRef: paynowreference,
      },
    })

    // Update contribution if this was a contribution payment
    if (transaction.contributionId && isPaid) {
      await tx.contribution.update({
        where: { id: transaction.contributionId },
        data: {
          status: 'PAID',
          amountPaid: parseFloat(amount || '0'),
          paidAt: new Date(),
          paymentRef: paynowreference,
        },
      })
      // Credit escrow
      if (transaction.groupId) {
        await tx.group.update({
          where: { id: transaction.groupId },
          data: { escrowBalance: { increment: parseFloat(amount || '0') } },
        })
      }
    }
  })
}

// ── Helpers ───────────────────────────────────────────────────
function formatZimPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('263')) return '0' + digits.slice(3)
  if (digits.startsWith('0')) return digits
  return '0' + digits
}

function generatePaynowHash(params: URLSearchParams): string {
  const { createHash } = require('crypto')
  const key = process.env.PAYNOW_INTEGRATION_KEY!
  const values = [...params.values()].join('')
  return createHash('md5').update(values + key).digest('hex').toUpperCase()
}

function parsePaynowResponse(text: string): Record<string, string> {
  return Object.fromEntries(
    text.split('&').map(pair => {
      const [key, val] = pair.split('=')
      return [key, decodeURIComponent(val || '')]
    })
  )
}
