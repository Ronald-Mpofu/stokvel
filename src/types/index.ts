// src/types/index.ts
// Shared TypeScript types across the platform

export type UserRole =
  | 'SYSTEM_ADMIN' | 'NATIONAL_ADMIN' | 'GROUP_ADMIN'
  | 'TREASURER' | 'INVESTMENT_MANAGER' | 'MEMBER' | 'AUDITOR'

export type KycStatus = 'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED'
export type MemberTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM'
export type MemberStatus = 'ACTIVE' | 'SUSPENDED' | 'DEFAULTED' | 'EXITED' | 'BLACKLISTED'
export type GroupStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'DISSOLVED'
export type CycleStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
export type PayoutStrategy = 'RANDOM' | 'SENIORITY' | 'GROUP_VOTE'
export type ContributionStatus = 'PENDING' | 'PAID' | 'PRE_PAID' | 'LATE' | 'FAILED' | 'DEFAULTED' | 'WAIVED'
export type PayoutStatus = 'SCHEDULED' | 'PENDING_GATES' | 'PROCESSING' | 'COMPLETED' | 'HELD' | 'CANCELLED'
export type LoanStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PENDING_APPROVAL' | 'APPROVED' | 'DISBURSED' | 'ACTIVE' | 'SETTLED' | 'DEFAULTED' | 'REJECTED' | 'CANCELLED'
export type AssetType = 'VEHICLE' | 'AGRICULTURAL_MACHINERY' | 'INDUSTRIAL_MACHINERY' | 'COMPUTER_EQUIPMENT' | 'HOME' | 'OTHER'
export type AssetStatus = 'FUNDING' | 'ACQUIRED' | 'ACTIVE' | 'DISPOSED' | 'WRITTEN_OFF'
export type PaymentMethod = 'ECOCASH' | 'MPESA' | 'MTN_MOMO' | 'BANK_TRANSFER' | 'CARD' | 'USSD' | 'INTERNAL_TRANSFER'
export type CurrencyCode = 'USD' | 'ZAR' | 'ZWG' | 'KES' | 'TZS' | 'UGX' | 'ZMW' | 'BWP' | 'MWK' | 'EUR' | 'GBP'
export type TransactionType = 'CONTRIBUTION' | 'PAYOUT' | 'PRE_ESCROW' | 'LOAN_DISBURSEMENT' | 'LOAN_REPAYMENT' | 'ASSET_CONTRIBUTION' | 'RENTAL_INCOME' | 'INVESTMENT_CONTRIBUTION' | 'INVESTMENT_RETURN' | 'INSURANCE_POOL' | 'FEE' | 'REFUND' | 'ADJUSTMENT'

// ── Auth ──────────────────────────────────────────────────────
export interface SessionUser {
  id: string
  email: string
  fullName: string
  role: UserRole
  tier: MemberTier
  kycStatus: KycStatus
  reputationScore: number
  profilePhotoUrl?: string | null
}

export interface AuthTokenPayload {
  sub: string       // user ID
  email: string
  role: UserRole
  iat: number
  exp: number
}

// ── API Response ──────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
  pagination?: PaginationMeta
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PaginationParams {
  page?: number
  pageSize?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

// ── Dashboard Stats ───────────────────────────────────────────
export interface DashboardStats {
  totalGroups: number
  totalMembers: number
  totalEscrow: number
  monthlyContributions: number
  monthlyPayouts: number
  activeLoans: number
  defaulters: number
  revenueThisMonth: number
  currency: CurrencyCode
}

// ── Member ────────────────────────────────────────────────────
export interface MemberProfile {
  id: string
  fullName: string
  email: string
  phone: string
  kycStatus: KycStatus
  tier: MemberTier
  reputationScore: number
  status: MemberStatus
  country?: string | null
  city?: string | null
  profilePhotoUrl?: string | null
  totalContributed: number
  groupCount: number
  cyclesCompleted: number
  joinedAt: Date
}

// ── Group ─────────────────────────────────────────────────────
export interface GroupSummary {
  id: string
  name: string
  status: GroupStatus
  currency: CurrencyCode
  contributionAmount: number
  memberCount: number
  maxMembers: number
  escrowBalance: number
  activeCycle?: CycleSummary | null
  adminName: string
  logoUrl?: string | null
  createdAt: Date
}

export interface CycleSummary {
  id: string
  cycleNumber: number
  status: CycleStatus
  startDate: Date
  endDate: Date
  totalMembers: number
  poolAmount: number
  currentMonth: number
  paidCount: number
  pendingCount: number
}

// ── Contribution ──────────────────────────────────────────────
export interface ContributionRecord {
  id: string
  userId: string
  memberName: string
  cycleId: string
  monthNumber: number
  amountDue: number
  amountPaid: number
  currency: CurrencyCode
  dueDate: Date
  paidAt?: Date | null
  status: ContributionStatus
  paymentMethod?: PaymentMethod | null
  retryCount: number
}

// ── Payout ────────────────────────────────────────────────────
export interface PayoutRecord {
  id: string
  recipientId: string
  recipientName: string
  cycleId: string
  amount: number
  currency: CurrencyCode
  scheduledDate: Date
  status: PayoutStatus
  gate1Passed: boolean
  gate2Passed: boolean
  gate3Passed: boolean
  gate4Passed: boolean
  processedAt?: Date | null
  completedAt?: Date | null
}

// ── Asset ─────────────────────────────────────────────────────
export interface AssetRecord {
  id: string
  groupId: string
  name: string
  type: AssetType
  status: AssetStatus
  targetAmount: number
  raisedAmount: number
  currency: CurrencyCode
  fundingProgress: number  // 0-100
  ownerCount: number
  acquiredAt?: Date | null
  photoUrls?: string[] | null
}

// ── Loan ──────────────────────────────────────────────────────
export interface LoanRecord {
  id: string
  borrowerId: string
  borrowerName: string
  groupId: string
  amount: number
  currency: CurrencyCode
  interestRatePa: number
  termMonths: number
  status: LoanStatus
  outstandingBalance: number
  nextPaymentDate?: Date | null
  nextPaymentAmount?: number | null
  disbursedAt?: Date | null
}

// ── Reputation Score Events ───────────────────────────────────
export const REPUTATION_EVENTS = {
  KYC_VERIFIED: { delta: 20, label: 'KYC verification completed' },
  CONTRIBUTION_ON_TIME: { delta: 5, label: 'Contribution paid on time' },
  CONTRIBUTION_LATE_1_3: { delta: 1, label: 'Contribution paid 1-3 days late' },
  CONTRIBUTION_LATE_OVER_3: { delta: 0, label: 'Contribution paid >3 days late' },
  CONTRIBUTION_MISSED: { delta: -10, label: 'Contribution missed' },
  DEFAULT_DECLARED: { delta: -100, label: 'Default declared' },
  CYCLE_COMPLETED: { delta: 50, label: 'Full cycle completed' },
  PAYOUT_RECEIVED: { delta: 10, label: 'Payout received' },
  LOAN_REPAYMENT_ON_TIME: { delta: 3, label: 'Loan repayment on time' },
  LOAN_DEFAULT: { delta: -75, label: 'Loan default' },
  DISPUTE_UPHELD_AGAINST: { delta: -25, label: 'Dispute upheld against member' },
  GUARANTOR_SUCCESS: { delta: 15, label: 'Successful loan guarantor' },
} as const

// ── Tier Thresholds ───────────────────────────────────────────
export const TIER_THRESHOLDS = {
  BRONZE: 0,
  SILVER: 50,
  GOLD: 100,
  PLATINUM: 150,
} as const

export function getTierFromScore(score: number): MemberTier {
  if (score >= TIER_THRESHOLDS.PLATINUM) return 'PLATINUM'
  if (score >= TIER_THRESHOLDS.GOLD) return 'GOLD'
  if (score >= TIER_THRESHOLDS.SILVER) return 'SILVER'
  return 'BRONZE'
}

// ── Currency helpers ──────────────────────────────────────────
export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$', ZAR: 'R', ZWG: 'ZiG', KES: 'KSh', TZS: 'TSh',
  UGX: 'USh', ZMW: 'K', BWP: 'P', MWK: 'MK', EUR: '€', GBP: '£',
}

export function formatCurrency(amount: number, currency: CurrencyCode = 'USD'): string {
  return `${CURRENCY_SYMBOLS[currency]}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
