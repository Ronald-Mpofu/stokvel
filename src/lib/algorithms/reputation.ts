// src/lib/algorithms/reputation.ts
// Reputation scoring system — updates member score and tier

import Decimal from 'decimal.js'
import prisma from '@/lib/prisma/client'
import { REPUTATION_EVENTS, getTierFromScore } from '@/types'

type ReputationEventKey = keyof typeof REPUTATION_EVENTS

export async function updateReputationScore(
  userId: string,
  eventKey: ReputationEventKey,
  entityId?: string
): Promise<{ newScore: number; newTier: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { reputationScore: true, tier: true },
  })

  const event = REPUTATION_EVENTS[eventKey]
  const currentScore = new Decimal(user.reputationScore)
  const newScore = Decimal.max(0, currentScore.plus(event.delta))
  const newTier = getTierFromScore(newScore.toNumber())

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { reputationScore: newScore, tier: newTier },
    })

    await tx.reputationEvent.create({
      data: {
        userId,
        event: event.label,
        scoreDelta: new Decimal(event.delta),
        scoreAfter: newScore,
        entityId,
        entityType: entityId ? 'unknown' : undefined,
      },
    })
  })

  return { newScore: newScore.toNumber(), newTier }
}

// ── Contribution punctuality scorer ──────────────────────────
export function getContributionEvent(
  dueDate: Date,
  paidAt: Date
): ReputationEventKey {
  const diffMs = paidAt.getTime() - dueDate.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  if (diffDays <= 0) return 'CONTRIBUTION_ON_TIME'
  if (diffDays <= 3) return 'CONTRIBUTION_LATE_1_3'
  return 'CONTRIBUTION_LATE_OVER_3'
}

// ── Tier access rules ─────────────────────────────────────────
export function getEarliestAllowedPosition(tier: string, totalMembers: number): number {
  switch (tier) {
    case 'PLATINUM': return 1
    case 'GOLD': return 1
    case 'SILVER': return Math.ceil(totalMembers * 0.5)
    default: return Math.ceil(totalMembers * 0.7) // BRONZE: last 30%
  }
}
