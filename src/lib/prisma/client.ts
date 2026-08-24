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
// 3. A one-time warning if DATABASE_URL looks like a DIRECT Postgres
//    connection rather than a pooler endpoint. See the note at the bottom.
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
    return `host=${u.hostname} port=${port} pooled=${pooled} connection_limit=${limit} pgbouncer=${pgb}`
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
// SUPABASE CONNECTION SETUP (read this before changing env vars)
//
// prisma/schema.prisma already declares both `url` and `directUrl`, which is
// the arrangement Prisma expects for a pooled deployment:
//
//   DATABASE_URL  -> transaction pooler, port 6543, used by the app at runtime
//                    postgresql://USER:PASS@HOST.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
//
//   DIRECT_URL    -> direct connection, port 5432, used by `prisma migrate`
//                    postgresql://USER:PASS@HOST.supabase.com:5432/postgres
//
// connection_limit=1 looks wrong and is not. Each serverless instance handles
// one request at a time, so one connection per instance is all it can use; the
// pooler multiplexes them on the server side. Raising it makes each instance
// hold connections it cannot use while starving the others.
//
// pgbouncer=true tells Prisma to skip prepared statements, which a transaction
// pooler cannot support. Omitting it produces intermittent
// "prepared statement already exists" errors under load — the kind that look
// random and are miserable to chase.
//
// Migrations must NOT run through the pooler, which is what DIRECT_URL is for.
// ─────────────────────────────────────────────────────────────────────────────
