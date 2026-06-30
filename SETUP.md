# Stokvel Platform — Setup Guide
## From zero to running in under 30 minutes

---

## Prerequisites
- Node.js 18+ installed (check: `node --version`)
- Git installed
- A Supabase account (free): https://supabase.com
- A Vercel account (free): https://vercel.com

---

## Step 1 — Create Supabase Project

1. Go to https://supabase.com and create a new project
2. Choose a region close to Zimbabwe (London or Frankfurt)
3. Set a strong database password and save it
4. Wait for the project to provision (~2 minutes)
5. Go to **Settings → Database** and copy:
   - `Connection string (URI)` → this is your `DATABASE_URL`
6. Go to **Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon/public key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role key` → `SUPABASE_SERVICE_ROLE_KEY`

---

## Step 2 — Clone and Install

```bash
# Clone the project
git clone https://github.com/yourusername/stokvel-platform.git
cd stokvel-platform

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local
```

---

## Step 3 — Configure Environment Variables

Open `.env.local` and fill in:

```env
# Required — from Supabase
DATABASE_URL="postgresql://postgres:[YOUR_PASSWORD]@db.[YOUR_REF].supabase.co:5432/postgres"
NEXT_PUBLIC_SUPABASE_URL="https://[YOUR_REF].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="[YOUR_ANON_KEY]"
SUPABASE_SERVICE_ROLE_KEY="[YOUR_SERVICE_ROLE_KEY]"

# Generate these yourself
NEXTAUTH_SECRET=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 64)
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

For now, you can leave EcoCash, SMS, and email credentials empty
— the app will run without them in development mode.

---

## Step 4 — Set Up the Database

```bash
# Generate Prisma client
npm run db:generate

# Push schema to Supabase (creates all tables)
npm run db:push

# Seed with sample data
npm run db:seed
```

This creates all 24 tables and loads sample data including:
- System Admin: admin@stokvel.com / Admin@12345
- Group Admin: groupadmin@stokvel.com / Admin@12345
- 10 sample members with an active group and cycle

---

## Step 5 — Run Locally

```bash
npm run dev
```

Open http://localhost:3000

Log in with: `admin@stokvel.com` / `Admin@12345`

---

## Step 6 — Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Follow prompts — link to your Vercel account
# When asked about environment variables, add them from your .env.local
```

Or deploy via Vercel dashboard:
1. Push code to GitHub
2. Go to vercel.com → New Project → Import from GitHub
3. Add all environment variables from .env.local
4. Deploy

---

## EcoCash Integration (Production)

To enable EcoCash payments:

1. Register at https://www.paynow.co.zw as a merchant
2. Get your Integration ID and Key from the Paynow dashboard
3. Add to environment:
   ```env
   PAYNOW_INTEGRATION_ID="your_id"
   PAYNOW_INTEGRATION_KEY="your_key"
   PAYNOW_RESULT_URL="https://yourdomain.com/api/payments/paynow/callback"
   ```
4. Set your domain's webhook URL in Paynow dashboard

---

## SMS Integration (Africa's Talking)

1. Register at https://africastalking.com
2. Create an application and get API key
3. Add to environment:
   ```env
   AFRICASTALKING_USERNAME="your_username"
   AFRICASTALKING_API_KEY="your_api_key"
   ```

---

## Database Migrations (Production Updates)

When schema changes are made:
```bash
# Create a named migration
npm run db:migrate -- --name "add_new_feature"

# This creates a migration file in prisma/migrations/
# Commit this file to git — it tracks your schema history
```

---

## File Structure

```
stokvel-platform/
├── prisma/
│   ├── schema.prisma      ← All 24 database tables
│   └── seed.ts            ← Sample data
├── src/
│   ├── app/
│   │   ├── api/           ← All API endpoints
│   │   ├── auth/          ← Login & register pages
│   │   └── dashboard/     ← All dashboard pages
│   ├── components/        ← Reusable UI components
│   ├── lib/
│   │   ├── auth/          ← JWT, sessions, role guards
│   │   ├── algorithms/    ← Payout engine, reputation scoring
│   │   ├── payments/      ← EcoCash, Paynow integration
│   │   └── notifications/ ← SMS, email, WhatsApp
│   └── types/             ← Shared TypeScript types
├── .env.example           ← Copy to .env.local
├── next.config.js
├── package.json
└── tsconfig.json
```

---

## What's Built (Layer 1 — Foundation)

✅ Complete database schema (24 tables, all relationships)
✅ Authentication system (JWT, sessions, role-based access)
✅ Member registration and login API
✅ Group creation and listing API
✅ Contribution tracking and payment initiation API
✅ EcoCash payment integration (Paynow)
✅ Africa's Talking SMS notifications
✅ Payout algorithm (position assignment, 4-gate release)
✅ Reputation scoring system
✅ Double-entry ledger with default chart of accounts
✅ Audit logging on all sensitive operations
✅ Multi-currency type system
✅ Database seed with sample Harare group

## What's Next (Layer 2 — Core Stokvel UI)

🔲 Login / Register pages (Next.js)
🔲 Admin dashboard with live stats
🔲 Member portal
🔲 Group management UI
🔲 Contribution tracker UI
🔲 Payout schedule and release UI

Say "build the dashboard" to continue!
```
