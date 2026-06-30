// src/app/api/contributions/generate/route.ts
// Generates contribution records for all members of an active cycle
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const schema = z.object({ cycleId: z.string().uuid() })

export async function POST(req: NextRequest) {
  try {
    const { cycleId } = schema.parse(await req.json())

    const cycle = await prisma.cycle.findUniqueOrThrow({
      where: { id: cycleId },
      include: {
        group: { include: { members: { where: { status: 'ACTIVE' }, select: { userId: true } } } },
      },
    })

    const existingCount = await prisma.contribution.count({ where: { cycleId } })
    if (existingCount > 0) {
      return NextResponse.json({ success: false, error: 'Contributions already generated for this cycle' }, { status: 400 })
    }

    const startDate = new Date(cycle.startDate)
    const contributions = []

    for (const member of cycle.group.members) {
      for (let month = 1; month <= cycle.totalMembers; month++) {
        const dueDate = new Date(startDate)
        dueDate.setMonth(dueDate.getMonth() + month - 1)
        dueDate.setDate(cycle.group.contributionDay)
        contributions.push({
          cycleId,
          userId:      member.userId,
          monthNumber: month,
          amountDue:   cycle.group.contributionAmount,
          currency:    cycle.group.currency,
          dueDate,
        })
      }
    }

    await prisma.contribution.createMany({ data: contributions, skipDuplicates: true })

    return NextResponse.json({
      success: true,
      message: `Generated ${contributions.length} contribution records`,
      data: { count: contributions.length },
    })
  } catch (error) {
    console.error('Generate contributions error:', error)
    return NextResponse.json({ success: false, error: 'Failed to generate contributions' }, { status: 500 })
  }
}
