# Sans Rent Cars CRM

WhatsApp-first rental-car CRM and AI Host platform for Sans Rent Cars.

## Technology
- Next.js + TypeScript dashboard
- Neon PostgreSQL
- GitHub Actions CI
- Official WhatsApp Business Platform Cloud API (integration remains disabled until credentials are configured)
- Pluggable AI provider (no provider secrets committed)

## Current status
Initial foundation. This repository does not yet connect to a live WhatsApp number and must not be treated as production-ready.

## Local development
1. Use Node.js 22 or newer.
2. Copy `.env.example` to `.env.local` and configure the required variables.
3. Install dependencies with `npm install`.
4. Run `npm run dev`.

## Database
SQL migrations are in `database/migrations`. Apply to a development Neon branch first. Never commit credentials or customer identity documents.

## Safety principles
- Booking availability and reservation creation must be enforced transactionally in PostgreSQL.
- Payment status requires a verified provider callback or authorized staff confirmation.
- AI actions are restricted to explicit business tools and policies.
- Human handoff is always available.
