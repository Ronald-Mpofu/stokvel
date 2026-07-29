// scripts/reset-user-password.mjs
//
// Changes a user's password using THIS PROJECT'S bcryptjs at the
// configured BCRYPT_COST, so the resulting hash is identical in form to
// one produced by the app itself.
//
// WHY NOT AN ONLINE GENERATOR
// Your current SYSTEM_ADMIN hash is $2b$, which nothing in your codebase
// produces — it came from outside. If that was a web-based bcrypt tool,
// that site saw the plaintext. This script keeps the password on your
// machine and in your database, nowhere else.
//
// RUN FROM PROJECT ROOT (Node 20.6+ for --env-file):
//   node --env-file=.env.local scripts/reset-user-password.mjs admin@thecommunitydeals.com
//
// The password is typed at a prompt with echo disabled — it is never a
// command-line argument, so it stays out of your shell history.
//
// DELETE OR GITIGNORE THIS SCRIPT once you have a working
// change-password page in the app.

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { createInterface } from 'node:readline'
import { stdin, stdout, argv, exit } from 'node:process'

const prisma = new PrismaClient()

// Match the auth lib exactly: default 12, floored at 10.
const BCRYPT_COST = Math.max(10, Number(process.env.BCRYPT_COST) || 12)

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true })
    const onData = (char) => {
      const s = String(char)
      if (s === '\n' || s === '\r' || s === '\u0004') {
        stdin.removeListener('data', onData)
      } else {
        stdout.write('\x1B[2K\x1B[200D' + question + '*'.repeat(rl.line.length))
      }
    }
    stdin.on('data', onData)
    rl.question(question, (value) => {
      rl.close()
      stdout.write('\n')
      resolve(value)
    })
  })
}

function checkStrength(pw) {
  const problems = []
  if (pw.length < 12) problems.push('at least 12 characters')
  if (!/[a-z]/.test(pw)) problems.push('a lowercase letter')
  if (!/[A-Z]/.test(pw)) problems.push('an uppercase letter')
  if (!/[0-9]/.test(pw)) problems.push('a number')
  if (!/[^A-Za-z0-9]/.test(pw)) problems.push('a symbol')
  return problems
}

async function main() {
  const email = argv[2]
  if (!email) {
    console.error('Usage: node --env-file=.env.local scripts/reset-user-password.mjs <email>')
    exit(1)
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, email: true, fullName: true, role: true,
      status: true, passwordHash: true, deletedAt: true,
    },
  })

  if (!user) {
    console.error(`No user found with email: ${email}`)
    exit(1)
  }
  if (user.deletedAt) {
    console.error('That user is soft-deleted. Aborting.')
    exit(1)
  }

  console.log('')
  console.log('  User:        ' + user.fullName + '  <' + user.email + '>')
  console.log('  Role:        ' + user.role + '   Status: ' + user.status)
  console.log('  Current hash:' + user.passwordHash.slice(0, 7) + '  (prefix only)')
  console.log('  New hash will use cost ' + BCRYPT_COST)
  console.log('')

  if (user.role === 'SYSTEM_ADMIN') {
    console.log('  ⚠  This is a SYSTEM_ADMIN account.')
    console.log('')
  }

  const pw1 = await promptHidden('  New password: ')
  const problems = checkStrength(pw1)
  if (problems.length) {
    console.error('\n  Password needs: ' + problems.join(', '))
    exit(1)
  }

  const pw2 = await promptHidden('  Confirm:      ')
  if (pw1 !== pw2) {
    console.error('\n  Passwords do not match. Nothing changed.')
    exit(1)
  }

  const sameAsBefore = await bcrypt.compare(pw1, user.passwordHash)
  if (sameAsBefore) {
    console.error('\n  That is the current password. Choose a different one.')
    exit(1)
  }

  const passwordHash = await bcrypt.hash(pw1, BCRYPT_COST)

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  })

  // Any outstanding reset tokens for this user are now meaningless and
  // should not remain usable. Raw SQL because PasswordResetToken is not
  // in schema.prisma.
  try {
    const removed = await prisma.$executeRawUnsafe(
      'DELETE FROM "PasswordResetToken" WHERE "userId" = $1', user.id
    )
    if (removed > 0) console.log(`  Invalidated ${removed} outstanding reset token(s).`)
  } catch {
    // Table shape differs or does not exist — not fatal.
  }

  console.log('')
  console.log('  ✅ Password updated. New hash prefix: ' + passwordHash.slice(0, 7))
  console.log('')
  console.log('  NOTE: existing access tokens stay valid until they expire')
  console.log('  (15 minutes). Log out in the browser to clear them immediately.')
  console.log('')
}

main()
  .catch((e) => { console.error('\nFailed:', e?.message); exit(1) })
  .finally(() => prisma.$disconnect())
