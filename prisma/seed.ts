// prisma/seed.ts
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

// Use DIRECT_URL for seeding to avoid connection pool timeout
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
  log: ['error'],
})

async function main() {
  console.log('🌱 Seeding database...')

  // ── System Admin ──────────────────────────────────────────────
  const adminPw = await bcrypt.hash('Admin@12345', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@stokvel.com' },
    update: {},
    create: {
      email: 'admin@stokvel.com',
      phone: '+263771000001',
      passwordHash: adminPw,
      fullName: 'System Administrator',
      role: 'SYSTEM_ADMIN',
      kycStatus: 'VERIFIED',
      tier: 'PLATINUM',
      reputationScore: 200,
      status: 'ACTIVE',
      country: 'Zimbabwe',
      city: 'Harare',
      preferredCurrency: 'USD',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  })
  console.log('✓ System admin created:', admin.email)

  // ── Group Admin ───────────────────────────────────────────────
  const groupAdminPw = await bcrypt.hash('Admin@12345', 12)
  const groupAdmin = await prisma.user.upsert({
    where: { email: 'groupadmin@stokvel.com' },
    update: {},
    create: {
      email: 'groupadmin@stokvel.com',
      phone: '+263771000002',
      passwordHash: groupAdminPw,
      fullName: 'Group Administrator',
      role: 'GROUP_ADMIN',
      kycStatus: 'VERIFIED',
      tier: 'GOLD',
      reputationScore: 130,
      status: 'ACTIVE',
      country: 'Zimbabwe',
      city: 'Harare',
      preferredCurrency: 'USD',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  })
  console.log('✓ Group admin created:', groupAdmin.email)

  // ── Sample Members (one at a time to avoid pool exhaustion) ───
  const memberPw = await bcrypt.hash('Member@12345', 12)
  const memberData = [
    { name: 'Tariro Moyo',      email: 'tariro@example.com',     phone: '+263772100001', score: 142 },
    { name: 'Chiedza Mutasa',   email: 'chiedza@example.com',    phone: '+263772100002', score: 118 },
    { name: 'Farai Khumalo',    email: 'farai@example.com',      phone: '+263772100003', score: 134 },
    { name: 'Simba Ndlovu',     email: 'simba@example.com',      phone: '+263772100004', score: 89  },
    { name: 'Paidamoyo Mhaka',  email: 'paidamoyo@example.com',  phone: '+263772100005', score: 76  },
    { name: 'Rudo Zimuto',      email: 'rudo@example.com',       phone: '+263772100006', score: 156 },
    { name: 'Kudzi Sithole',    email: 'kudzi@example.com',      phone: '+263772100007', score: 121 },
    { name: 'Nomsa Dube',       email: 'nomsa@example.com',      phone: '+263772100008', score: 98  },
    { name: 'Muchaneta Choto',  email: 'muchaneta@example.com',  phone: '+263772100009', score: 103 },
    { name: 'Blessing Mlilo',   email: 'blessing@example.com',   phone: '+263772100010', score: 87  },
  ]

  const members = []
  for (const m of memberData) {
    const tier = m.score >= 150 ? 'PLATINUM'
               : m.score >= 100 ? 'GOLD'
               : m.score >= 50  ? 'SILVER'
               : 'BRONZE'
    const member = await prisma.user.upsert({
      where: { email: m.email },
      update: {},
      create: {
        email: m.email,
        phone: m.phone,
        passwordHash: memberPw,
        fullName: m.name,
        role: 'MEMBER',
        kycStatus: 'VERIFIED',
        tier,
        reputationScore: m.score,
        status: 'ACTIVE',
        country: 'Zimbabwe',
        city: 'Harare',
        preferredCurrency: 'USD',
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    })
    members.push(member)
    console.log('✓ Member created:', member.fullName)
  }

  // ── Sample Group ──────────────────────────────────────────────
  const group = await prisma.group.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Harare Builders Circle',
      description: 'A savings and investment group focused on property and business ventures',
      adminUserId: groupAdmin.id,
      status: 'ACTIVE',
      currency: 'USD',
      contributionAmount: 100,
      contributionDay: 1,
      maxMembers: 10,
      penaltyRate: 0.20,
      insurancePoolPct: 0.015,
      platformFeePct: 0.02,
      payoutStrategy: 'SENIORITY',
      escrowBalance: 600,
      insurancePoolBalance: 90,
      country: 'Zimbabwe',
      region: 'Harare',
    },
  })
  console.log('✓ Group created:', group.name)

  // ── Default Chart of Accounts ─────────────────────────────────
  const accounts = [
    { code: '1000', name: 'Cash & Escrow',           type: 'ASSET'     },
    { code: '1100', name: 'EcoCash Account',          type: 'ASSET'     },
    { code: '1200', name: 'Bank Account',             type: 'ASSET'     },
    { code: '2000', name: 'Member Payouts Payable',   type: 'LIABILITY' },
    { code: '3000', name: 'Member Equity',            type: 'EQUITY'    },
    { code: '3100', name: 'Insurance Pool Reserve',   type: 'EQUITY'    },
    { code: '4000', name: 'Contribution Income',      type: 'INCOME'    },
    { code: '4100', name: 'Rental Income',            type: 'INCOME'    },
    { code: '5000', name: 'Platform Fees',            type: 'EXPENSE'   },
    { code: '5100', name: 'Bank Charges',             type: 'EXPENSE'   },
  ]
  for (const acc of accounts) {
    await prisma.ledgerAccount.upsert({
      where: { groupId_code: { groupId: group.id, code: acc.code } },
      update: {},
      create: { ...acc, groupId: group.id },
    })
  }
  console.log('✓ Chart of accounts created')

  // ── Group Admin as Member ─────────────────────────────────────
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId: groupAdmin.id } },
    update: {},
    create: {
      groupId: group.id,
      userId: groupAdmin.id,
      role: 'GROUP_ADMIN',
      status: 'ACTIVE',
      joinedAt: new Date('2025-01-01'),
      approvedAt: new Date('2025-01-01'),
      approvedById: admin.id,
      cyclesCompleted: 0,
      totalContributed: 0,
    },
  })

  // ── Members in Group (one at a time) ─────────────────────────
  for (let i = 0; i < members.length; i++) {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: members[i].id } },
      update: {},
      create: {
        groupId: group.id,
        userId: members[i].id,
        role: 'MEMBER',
        status: 'ACTIVE',
        payoutPosition: i + 1,
        joinedAt: new Date('2025-01-01'),
        approvedAt: new Date('2025-01-01'),
        approvedById: groupAdmin.id,
        cyclesCompleted: 0,
        totalContributed: (i + 1) * 100,
      },
    })
  }
  console.log('✓ Group members linked')

  // ── Active Cycle ──────────────────────────────────────────────
  const cycle = await prisma.cycle.upsert({
    where: { groupId_cycleNumber: { groupId: group.id, cycleNumber: 1 } },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      groupId: group.id,
      cycleNumber: 1,
      status: 'ACTIVE',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-10-31'),
      totalMembers: 10,
      poolAmount: 1000,
      escrowBalance: 600,
      lockedAt: new Date('2025-01-01'),
    },
  })
  console.log('✓ Active cycle created')

  // ── Payout Schedule (one at a time) ──────────────────────────
  for (let i = 0; i < members.length; i++) {
    try {
      await prisma.payoutSchedule.create({
        data: {
          cycleId: cycle.id,
          recipientId: members[i].id,
          monthNumber: i + 1,
          scheduledDate: new Date(2025, i, 1),
          payoutAmount: 1000,
          status: i < 6 ? 'COMPLETED' : 'SCHEDULED',
        },
      })
    } catch {
      // Skip if already exists
    }
  }
  console.log('✓ Payout schedule created')

  console.log('\n✅ Seeding complete!')
  console.log('\n📋 Login credentials:')
  console.log('   System Admin : admin@stokvel.com       / Admin@12345')
  console.log('   Group Admin  : groupadmin@stokvel.com  / Admin@12345')
  console.log('   Member       : tariro@example.com      / Member@12345')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seed error:', e.message)
    await prisma.$disconnect()
    process.exit(1)
  })
