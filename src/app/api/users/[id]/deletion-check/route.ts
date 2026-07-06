// src/app/api/users/[id]/deletion-check/route.ts
// Rule 2: only users not in any group can be deleted
// Rule 3: users with transactions/contributions cannot be deleted
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true, fullName: true, email: true, role: true,
        _count: {
          select: {
            groupMemberships:       true,
            contributions:          true,
            payoutsReceived:        true,
            loansAsBorrower:        true,
            loansAsGuarantor:       true,
            assetOwnerships:        true,
            assetQueueEntries:      true,
            savingsPoolMemberships: true,
            savingsContributions:   true,
            savingsLoans:           true,
            savingsPayouts:         true,
            propertyStakes:         true,
            investmentAllocations:  true,
            sentInvitations:        true,
          },
        },
      },
    })
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })

    // Payment transactions (Transaction table) — rule 3
    const transactionCount = await prisma.transaction.count({ where: { userId: params.id } })

    const c = user._count
    const blockers: string[] = []

    // Rule 2 — group membership blocks account deletion
    if (c.groupMemberships > 0)
      blockers.push(`Member of ${c.groupMemberships} group${c.groupMemberships > 1 ? 's' : ''} — remove from all groups first`)

    // Rule 3 — payments / contributions block deletion
    if (c.contributions > 0)      blockers.push(`${c.contributions} contribution record${c.contributions > 1 ? 's' : ''}`)
    if (transactionCount > 0)     blockers.push(`${transactionCount} payment transaction${transactionCount > 1 ? 's' : ''}`)
    if (c.payoutsReceived > 0)    blockers.push(`${c.payoutsReceived} payout${c.payoutsReceived > 1 ? 's' : ''} received`)

    // Scheme participation — must exit schemes before deletion
    if (c.savingsPoolMemberships > 0) blockers.push(`Member of ${c.savingsPoolMemberships} savings pool${c.savingsPoolMemberships > 1 ? 's' : ''}`)
    if (c.savingsContributions > 0)   blockers.push(`${c.savingsContributions} savings contribution${c.savingsContributions > 1 ? 's' : ''}`)
    if (c.savingsLoans > 0)           blockers.push(`${c.savingsLoans} savings loan${c.savingsLoans > 1 ? 's' : ''}`)
    if (c.savingsPayouts > 0)         blockers.push(`${c.savingsPayouts} savings payout${c.savingsPayouts > 1 ? 's' : ''}`)
    if (c.loansAsBorrower > 0)        blockers.push(`${c.loansAsBorrower} loan${c.loansAsBorrower > 1 ? 's' : ''} as borrower`)
    if (c.loansAsGuarantor > 0)       blockers.push(`Guarantor on ${c.loansAsGuarantor} loan${c.loansAsGuarantor > 1 ? 's' : ''}`)
    if (c.assetOwnerships > 0)        blockers.push(`${c.assetOwnerships} asset ownership stake${c.assetOwnerships > 1 ? 's' : ''}`)
    if (c.assetQueueEntries > 0)      blockers.push(`${c.assetQueueEntries} asset queue position${c.assetQueueEntries > 1 ? 's' : ''}`)
    if (c.propertyStakes > 0)         blockers.push(`${c.propertyStakes} property stake${c.propertyStakes > 1 ? 's' : ''}`)
    if (c.investmentAllocations > 0)  blockers.push(`${c.investmentAllocations} investment allocation${c.investmentAllocations > 1 ? 's' : ''}`)
    if (c.sentInvitations > 0)        blockers.push(`Has sent ${c.sentInvitations} member invitation${c.sentInvitations > 1 ? 's' : ''}`)

    return NextResponse.json({
      success: true,
      data: {
        userId:    user.id,
        fullName:  user.fullName,
        email:     user.email,
        canDelete: blockers.length === 0,
        blockers,
      },
    })
  } catch (e: any) {
    console.error('deletion-check error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
