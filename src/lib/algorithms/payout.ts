// src/lib/algorithms/payout.ts
// Core payout algorithm — position assignment, gate checks, pre-escrow

import { randomBytes } from 'crypto'
import Decimal from 'decimal.js'
import prisma from '@/lib/prisma/client'
import { updateReputationScore } from '@/lib/algorithms/reputation'
import type { PayoutStrategy } from '@/types'

// ── Position Assignment ───────────────────────────────────────
export async function assignPayoutPositions(
  cycleId: string,
  groupId: string,
  strategy: PayoutStrategy
): Promise<void> {
  const cycle = await prisma.cycle.findUniqueOrThrow({ where: { id: cycleId } })
  if (cycle.status !== 'PENDING') throw new Error('Cycle must be PENDING to assign positions')

  const members = await prisma.groupMember.findMany({
    where: { groupId, status: 'ACTIVE' },
    include: { user: { select: { id: true, reputationScore: true, createdAt: true } } },
    orderBy: { joinedAt: 'asc' },
  })

  let ordered: typeof members

  if (strategy === 'RANDOM') {
    // Cryptographically secure shuffle
    ordered = cryptoShuffle(members)
  } else if (strategy === 'SENIORITY') {
    // Higher cycles completed = earlier position; tiebreak by join date
    ordered = [...members].sort((a, b) => {
      if (b.cyclesCompleted !== a.cyclesCompleted)
        return b.cyclesCompleted - a.cyclesCompleted
      return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
    })
  } else {
    // GROUP_VOTE — positions must already be set on GroupMember records
    ordered = [...members].sort((a, b) =>
      (a.payoutPosition ?? 999) - (b.payoutPosition ?? 999)
    )
  }

  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } })
  const poolAmount = new Decimal(group.contributionAmount).times(members.length)
  const startDate = new Date(cycle.startDate)

  // Write PAYOUT_SCHEDULE — immutable after this point
  await prisma.$transaction(
    ordered.map((member, i) => {
      const monthNumber = i + 1
      const scheduledDate = new Date(startDate)
      scheduledDate.setMonth(scheduledDate.getMonth() + i)

      return prisma.payoutSchedule.create({
        data: {
          cycleId,
          recipientId: member.userId,
          monthNumber,
          scheduledDate,
          payoutAmount: poolAmount,
          status: 'SCHEDULED',
        },
      })
    })
  )

  // Lock cycle to ACTIVE
  await prisma.cycle.update({
    where: { id: cycleId },
    data: { status: 'ACTIVE', lockedAt: new Date() },
  })

  // Create contribution records for every member × every month
  const contributions = []
  for (const member of members) {
    for (let month = 1; month <= members.length; month++) {
      const dueDate = new Date(startDate)
      dueDate.setMonth(dueDate.getMonth() + month - 1)
      dueDate.setDate(group.contributionDay)

      contributions.push({
        cycleId,
        userId: member.userId,
        monthNumber: month,
        amountDue: group.contributionAmount,
        currency: group.currency,
        dueDate,
      })
    }
  }
  await prisma.contribution.createMany({ data: contributions })
}

// ── 4-Gate Payout Release ─────────────────────────────────────
export async function checkPayoutGates(payoutId: string): Promise<{
  allPassed: boolean
  gates: { g1: boolean; g2: boolean; g3: boolean; g4: boolean }
  failReasons: string[]
}> {
  const payout = await prisma.payout.findUniqueOrThrow({
    where: { id: payoutId },
    include: {
      cycle: { include: { group: true } },
      recipient: { include: { agreementSignatures: true } },
      schedule: true,
    },
  })

  const failReasons: string[] = []

  // Gate 1: All contributions for this month must be PAID or PRE_PAID
  const monthContribs = await prisma.contribution.findMany({
    where: { cycleId: payout.cycleId, monthNumber: payout.schedule?.monthNumber },
  })
  const g1 = monthContribs.every(
    c => c.status === 'PAID' || c.status === 'PRE_PAID' || c.status === 'WAIVED'
  )
  if (!g1) {
    const unpaid = monthContribs.filter(c => !['PAID','PRE_PAID','WAIVED'].includes(c.status))
    failReasons.push(`Gate 1 FAILED: ${unpaid.length} unpaid contributions this month`)
  }

  // Gate 2: Recipient must be ACTIVE (not suspended/defaulted/blacklisted)
  const recipient = await prisma.user.findUniqueOrThrow({ where: { id: payout.recipientId } })
  const g2 = recipient.status === 'ACTIVE' && !recipient.isBlacklisted
  if (!g2) failReasons.push(`Gate 2 FAILED: Recipient status is ${recipient.status}`)

  // Gate 3: Recipient must have signed the group's current agreement
  const currentAgreement = await prisma.agreement.findFirst({
    where: { groupId: payout.cycle.groupId, status: 'ACTIVE' },
    orderBy: { effectiveFrom: 'desc' },
  })
  const g3 = currentAgreement
    ? !!(await prisma.agreementSignature.findUnique({
        where: { agreementId_userId: { agreementId: currentAgreement.id, userId: payout.recipientId } },
      }))
    : true
  if (!g3) failReasons.push('Gate 3 FAILED: Recipient has not signed the current group agreement')

  // Gate 4: Escrow balance is sufficient
  const group = payout.cycle.group
  const g4 = new Decimal(group.escrowBalance).gte(payout.amount)
  if (!g4) failReasons.push(`Gate 4 FAILED: Escrow balance ${group.escrowBalance} < payout ${payout.amount}`)

  // Update gate status on payout record
  await prisma.payout.update({
    where: { id: payoutId },
    data: { gate1Passed: g1, gate2Passed: g2, gate3Passed: g3, gate4Passed: g4 },
  })

  return { allPassed: g1 && g2 && g3 && g4, gates: { g1, g2, g3, g4 }, failReasons }
}

// ── Release Payout ────────────────────────────────────────────
export async function releasePayout(
  payoutId: string,
  authorisedById: string
): Promise<{ success: boolean; message: string; authCode?: string }> {
  const { allPassed, failReasons } = await checkPayoutGates(payoutId)
  if (!allPassed) return { success: false, message: failReasons.join('; ') }

  const payout = await prisma.payout.findUniqueOrThrow({
    where: { id: payoutId },
    include: { cycle: { include: { group: true } } },
  })

  const authCode = randomBytes(32).toString('hex')
  const remainingMonths = await getRemainingMonths(payout.cycleId, payout.id)
  const preEscrowMonths = remainingMonths > 3 ? 2 : remainingMonths > 1 ? 1 : 0
  const preEscrowAmount = new Decimal(payout.cycle.group.contributionAmount)
    .times(preEscrowMonths)

  await prisma.$transaction(async (tx) => {
    // Deduct from escrow
    await tx.group.update({
      where: { id: payout.cycle.groupId },
      data: { escrowBalance: { decrement: payout.amount } },
    })

    // Mark future contributions as PRE_PAID if pre-escrow collected
    if (preEscrowMonths > 0) {
      const futureContribs = await tx.contribution.findMany({
        where: {
          cycleId: payout.cycleId,
          userId: payout.recipientId,
          status: 'PENDING',
        },
        orderBy: { monthNumber: 'asc' },
        take: preEscrowMonths,
      })
      for (const contrib of futureContribs) {
        await tx.contribution.update({
          where: { id: contrib.id },
          data: { status: 'PRE_PAID', preEscrowRef: payoutId, paidAt: new Date() },
        })
      }
    }

    // Mark payout complete
    await tx.payout.update({
      where: { id: payoutId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        releaseAuthCode: authCode,
        authorisedById,
        preEscrowCollected: preEscrowAmount,
        preEscrowMonths,
      },
    })

    // Transaction record
    await tx.transaction.create({
      data: {
        type: 'PAYOUT',
        status: 'COMPLETED',
        amount: payout.amount,
        currency: payout.cycle.group.currency,
        payoutId,
        groupId: payout.cycle.groupId,
        userId: payout.recipientId,
        reference: authCode,
        description: `Cycle ${payout.cycle.cycleNumber} payout`,
      },
    })

    // Audit log
    await tx.auditLog.create({
      data: {
        userId: authorisedById,
        groupId: payout.cycle.groupId,
        action: 'DISBURSE',
        entityType: 'Payout',
        entityId: payoutId,
        description: `Payout of ${payout.amount} released to ${payout.recipientId}`,
      },
    })
  })

  // Update reputation score outside transaction (non-critical)
  await updateReputationScore(payout.recipientId, 'PAYOUT_RECEIVED', payoutId)

  return { success: true, message: 'Payout released successfully', authCode }
}

// ── Helpers ───────────────────────────────────────────────────
function cryptoShuffle<T>(array: T[]): T[] {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const bytes = randomBytes(4)
    const j = bytes.readUInt32BE(0) % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

async function getRemainingMonths(cycleId: string, currentPayoutId: string): Promise<number> {
  const totalSchedule = await prisma.payoutSchedule.count({ where: { cycleId } })
  const completedPayouts = await prisma.payout.count({
    where: { cycleId, status: 'COMPLETED' },
  })
  return totalSchedule - completedPayouts - 1 // -1 for current
}
