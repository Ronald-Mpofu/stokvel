// src/lib/prisma/client.ts
// v2 — production-safe client reuse, plus cold-start connection instrumentation.
//
// WHAT CHANGED AND WHY
//
// 1. The client is now cached on globalThis in EVERY environment, not just
//    development. The old guard (`if NODE_ENV !== 'production'`) is the shape
//    Prisma's own docs use, but that guidance targets a long-lived Node server
//    where the only concern is hot-reload leaking clients. On Vercel, Next.js
//    App Router can bundle route handlers into separate lambdas, each with its
//    own module registry — so each route that imports this file can construct
//    its OWN PrismaClient, and each client opens its OWN connection pool
//    against the same Postgres instance. Caching on globalThis lets any that
//    do share a process share one pool instead of racing each other for
//    connections.
//
// 2. The first connection is timed and logged once per cold start. Connecting
//    to Supabase in Tokyo from a Vercel function in Washington is several
//    round trips of TCP and TLS before a single query runs, and that cost is
//    invisible in query timings — it is paid before the first query starts and
//    then never again for the life of that instance. If it turns out to be the
//    bulk of a slow first load, no amount of query tuning will touch it.
//
// 3. A one-time report of the connection target (host, port, pooling, limits)
//    with the password stripped, so the setup is visible in the logs rather
//    than being re-guessed. Measured 2026-08: the pooling setup is correct;
//    the cost is geographic. See the note at the bottom of this file.
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaConnect?: Promise<void>
  prismaBooted?: number
}

function createClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
    datasources: { db: { url: process.env.DATABASE_URL } },
  })

  // Do NOT connect during `next build`. Static generation spins up a worker
  // per bundle, each of which evaluates this module in its own process, so an
  // eager connect here opens one Postgres session per worker and adds its full
  // handshake to every build. (That is exactly what the seven
  // "cold-start connect" lines in the build log were — build workers, not
  // runtime traffic.) At build time there is nothing to warm: the connection
  // dies with the worker.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    globalForPrisma.prismaConnect = Promise.resolve()
    return client
  }

  // Prisma connects lazily on the first query. Kicking it off here means the
  // handshake overlaps with whatever else the request is doing rather than
  // sitting in front of the first query, and it gives us somewhere to measure.
  const started = Date.now()
  globalForPrisma.prismaBooted = started
  globalForPrisma.prismaConnect = client.$connect()
    .then(() => {
      const ms = Date.now() - started
      // Logged unconditionally: it happens once per cold start, so it cannot
      // spam, and it is the single most useful number for diagnosing a slow
      // first request.
      console.log(`[prisma] cold-start connect ${ms}ms`, describeTarget())
    })
    .catch((err: any) => {
      console.error(`[prisma] cold-start connect FAILED after ${Date.now() - started}ms`, err?.message)
    })

  return client
}

// Describes the connection target without ever revealing the password.
function describeTarget(): string {
  const url = process.env.DATABASE_URL || ''
  try {
    const u = new URL(url)
    const port   = u.port || '5432'
    const pooled = port === '6543' || u.hostname.includes('pooler')
    const limit  = u.searchParams.get('connection_limit') ?? '(default)'
    const pgb    = u.searchParams.get('pgbouncer') ?? 'not set'
    if (!pooled) {
      console.warn(
        '[prisma] DATABASE_URL appears to be a DIRECT Postgres connection ' +
        `(host ${u.hostname}, port ${port}). In a serverless runtime every ` +
        'concurrent function instance opens its own connection against a ' +
        'fixed server limit; once that limit is reached new requests wait for ' +
        'a free slot and then time out. If loads are slow in a way that does ' +
        'not track query cost, this is the first thing to change — point ' +
        'DATABASE_URL at the transaction pooler (port 6543) and keep the ' +
        'direct URL in DIRECT_URL for migrations.'
      )
    }
    return `host=${u.hostname} port=${port} pooled=${pooled} connection_limit=${limit} pgbouncer=${pgb} functionRegion=${process.env.VERCEL_REGION || 'local'}`
  } catch {
    return 'DATABASE_URL unparseable or unset'
  }
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient()

// Cached in all environments now — see note 1 above.
globalForPrisma.prisma = prisma

// Awaitable handle on the initial connection, for anything that wants to
// distinguish "waiting to connect" from "waiting for a query". Optional: every
// query already awaits the connection internally.
export const prismaReady: Promise<void> =
  globalForPrisma.prismaConnect ?? Promise.resolve()

export default prisma

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION SETUP — CONFIRMED GOOD, DO NOT "FIX" IT AGAIN
//
// Measured 2026-08: DATABASE_URL points at
//   aws-1-ap-northeast-1.pooler.supabase.com:6543
//   pooled=true  connection_limit=1  pgbouncer=true
//
// That is exactly right and needs no change. Recording it here because it is
// the first thing anyone suspects when loads are slow, and re-investigating it
// costs a day. prisma/schema.prisma keeps the 5432 direct connection in
// DIRECT_URL for migrations, which must not run through the pooler.
//
// THE REMAINING COST IS DISTANCE, NOT CONFIGURATION.
//
// A measured connect of ~1950ms to a correctly pooled endpoint is not a
// configuration fault — it is roughly ten network round trips (TCP handshake,
// TLS negotiation, SCRAM authentication, pooler setup). Ten round trips at
// ~190ms is ~1.9s, which is what we see. The round trip is that long because
// the database is in Tokyo (ap-northeast-1) and the Vercel functions are not.
//
// Every cold serverless instance pays that ~2s before its first query, and
// every query afterwards pays one further round trip. No amount of query
// tuning touches either number. The fix is to co-locate the functions with the
// database by pinning the Vercel region to Tokyo — see vercel.json.
// ─────────────────────────────────────────────────────────────────────────────
