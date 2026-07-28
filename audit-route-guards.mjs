#!/usr/bin/env node
// audit-route-guards.mjs
//
// Reports which API route handlers enforce authorisation and which do not.
//
// RUN FROM PROJECT ROOT:
//   node audit-route-guards.mjs
//
// Reads only. Writes nothing. Exits 1 if any mutating handler is
// unguarded, so it can be wired into CI later if you want.
//
// WHAT IT CHECKS
//   For every route.ts under src/app/api, it extracts each exported
//   handler body by brace matching and looks for a known guard call.
//   It also flags directories whose casing will break on Linux and
//   stray non-route files sitting inside app/api.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const API_DIR = join(process.cwd(), 'src', 'app', 'api')

// Any of these appearing inside a handler body counts as a guard.
const GUARDS = [
  'requireGroupManager',
  'canManageGroup',
  'requireAuth',
  'requireRole',
  'getSessionFromRequest',
  'getClaimsFromRequest',
  'getSession',
  'hasPermission',
]

// Guards that actually check "may this caller touch THIS record".
// getSessionFromRequest alone only proves the caller is logged in.
const SCOPED_GUARDS = ['requireGroupManager', 'canManageGroup']

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE']

// Middleware already gates these prefixes, so a missing in-handler
// guard is acceptable there.
const MIDDLEWARE_PROTECTED = ['/api/users']

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// Extract a handler body by matching braces from the opening one.
function handlerBody(src, startIdx) {
  const open = src.indexOf('{', startIdx)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return src.slice(open)
}

const files = walk(API_DIR)
const routeFiles = files.filter(f => /(^|[\\/])route\.tsx?$/.test(f))
const strays = files.filter(f => !/(^|[\\/])route\.tsx?$/.test(f) && /\.tsx?$/.test(f))

const rows = []
let unguarded = 0

for (const file of routeFiles) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(process.cwd(), file).split(sep).join('/')
  const urlPath = '/' + rel
    .replace(/^src\/app\//, '')
    .replace(/\/route\.tsx?$/, '')

  const re = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g
  let m
  while ((m = re.exec(src)) !== null) {
    const method = m[1]
    const body = handlerBody(src, m.index)
    const found = GUARDS.filter(g => body.includes(g + '('))
    const scoped = found.some(g => SCOPED_GUARDS.includes(g))
    const mwCovered = MIDDLEWARE_PROTECTED.some(p => urlPath.startsWith(p))

    let verdict
    if (found.length === 0 && mwCovered) verdict = 'MIDDLEWARE'
    else if (found.length === 0) verdict = MUTATING.includes(method) ? 'NONE ***' : 'NONE'
    else if (scoped) verdict = 'SCOPED'
    else verdict = 'AUTH-ONLY'

    if (verdict === 'NONE ***') unguarded++

    rows.push({
      route: urlPath,
      method,
      verdict,
      guards: found.join(', ') || '—',
      line: src.slice(0, m.index).split('\n').length,
    })
  }
}

// ── Report ───────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)
console.log('\n=== API ROUTE GUARD AUDIT ===\n')
console.log(pad('ROUTE', 42) + pad('METHOD', 8) + pad('VERDICT', 12) + 'GUARDS')
console.log('-'.repeat(110))

const order = { 'NONE ***': 0, 'NONE': 1, 'AUTH-ONLY': 2, 'MIDDLEWARE': 3, 'SCOPED': 4 }
rows.sort((a, b) =>
  (order[a.verdict] - order[b.verdict]) ||
  a.route.localeCompare(b.route) ||
  a.method.localeCompare(b.method)
)

for (const r of rows) {
  console.log(pad(r.route, 42) + pad(r.method, 8) + pad(r.verdict, 12) + r.guards)
}

// ── Casing check (Linux/Vercel will 404 on these) ────────────
const badCase = [...new Set(
  routeFiles
    .map(f => relative(API_DIR, f).split(sep)[0])
    .filter(d => d && d !== d.toLowerCase())
)]

console.log('\n=== LINUX CASING RISK ===')
if (badCase.length === 0) {
  console.log('None — all api directories are lowercase.')
} else {
  for (const d of badCase) {
    console.log(`  src/app/api/${d}  -> URL is /api/${d} (case-sensitive on Vercel)`)
  }
}

// ── Stray files inside app/api ───────────────────────────────
console.log('\n=== STRAY FILES IN app/api (not routes) ===')
if (strays.length === 0) {
  console.log('None.')
} else {
  for (const f of strays) {
    console.log('  ' + relative(process.cwd(), f).split(sep).join('/'))
  }
}

// ── Summary ──────────────────────────────────────────────────
const counts = rows.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {})
console.log('\n=== SUMMARY ===')
for (const k of ['NONE ***', 'NONE', 'AUTH-ONLY', 'MIDDLEWARE', 'SCOPED']) {
  if (counts[k]) console.log(`  ${pad(k, 12)} ${counts[k]}`)
}
console.log(`\n  Handlers audited: ${rows.length} across ${routeFiles.length} route files`)

console.log(`
LEGEND
  NONE ***    Mutating handler with NO guard. Any logged-in user can call it.
  NONE        Read handler with no guard.
  AUTH-ONLY   Proves the caller is logged in, but NOT that they may touch
              this particular record. Fine for "my own data" reads;
              insufficient for group-scoped mutations.
  MIDDLEWARE  No in-handler guard, but middleware gates the path.
  SCOPED      Uses requireGroupManager / canManageGroup. Correct.
`)

process.exit(unguarded > 0 ? 1 : 0)
