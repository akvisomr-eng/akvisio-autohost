# AKVISIO AutoHost — Release Readiness and Cost Boundaries

**Review date:** 14 October 2026  
**Status:** implementation and migration rehearsal progressing; production launch is not yet approved or verified.

## Verified in repository and database

- Main branch CI passed after annual subscription billing was merged.
- Migrations 001–013 were applied sequentially and verified on a separate Neon rehearsal branch created from the production branch.
- Migrations 009–013 were applied to the Neon development branch. A metadata-only check confirmed all required core and platform tables exist there.
- The development subscription catalogue contains the current approved prices:
  - Starter: Rp475,000/month
  - Business: Rp895,000/month
  - Pro: Rp1,595,000/month
  - Activation: Rp3,500,000 one-time for each plan
- Annual subscription billing is implemented as 12 months of the saved monthly fee less a 10% subscription discount. Activation is separate and undiscounted.
- The production Neon branch was observed without application tables during the readiness audit. No production migration was run.
- A hosting project/domain for production has not been verified as provisioned.

## Release gates

### Database

- [x] Rehearse migrations 001–013 on a non-production branch.
- [x] Apply platform migrations 009–013 on the development branch.
- [x] Confirm required schema metadata on development.
- [ ] Approve a production migration window and backup/restore plan.
- [ ] Apply migrations to production only after explicit approval; verify schema and health endpoint immediately afterward.
- [ ] Verify scheduled backups/restore procedure before onboarding paying tenants.

### Hosting and domain

- [ ] Select a server runtime that supports the Next.js application and is permitted for commercial SaaS use.
- [ ] Configure production build, health check, HTTPS origin, log retention, and rollback.
- [ ] Set APP_BASE_URL to the real HTTPS production origin.
- [ ] A custom domain is optional for a controlled pilot if the host supplies a stable HTTPS URL, but is recommended before public launch. WhatsApp webhooks require a reachable HTTPS endpoint.
- [ ] Do not treat a personal/hobby hosting tier as the commercial production environment without verifying its terms. No paid hosting/domain purchase has been made by this work.

### Secrets and external services

- [ ] Configure unique random secrets of at least 32 characters for SESSION_SECRET, BOOTSTRAP_SECRET, PLATFORM_SESSION_SECRET, and PLATFORM_BOOTSTRAP_SECRET.
- [ ] Configure the AI provider credential, model, timeout, and explicit per-1,000-token rates if cost estimates are required.
- [ ] Configure WhatsApp provider credentials, verify token, phone-number-to-tenant mapping, and webhook verification.
- [ ] Keep WHATSAPP_OUTBOUND_ENABLED=false until provider configuration, opt-in/consent handling, recipient testing, and an explicit activation decision are complete.
- [ ] Keep automatic AI replies disabled until end-to-end tests, human handoff, and message-safety rules have been approved.

### Commercial and operational policy

- [x] Seed the current monthly list prices and one-time activation fee in the development catalogue.
- [x] Implement the 10% annual subscription discount in billing calculations and invoice records.
- [ ] Approve exact AI usage quotas, user/vehicle/conversation limits, provider pass-through charges, tax handling, support hours/SLA, and cancellation/refund terms.
- [ ] Confirm whether WhatsApp channel/provider fees are paid directly by the tenant or passed through AKVISIO.
- [ ] Run acceptance tests with a non-production tenant and written test results before declaring the product live.

## Cost ownership checklist

These are cost categories, not commitments to purchase a particular vendor or plan.

| Cost category | Likely payer | Release rule |
|---|---|---|
| Domain registration/renewal | AKVISIO, unless contractually passed through | Buy only after the chosen hostname is approved; a custom domain is not required for the first controlled test if HTTPS hosting URL is available |
| Application hosting/runtime | AKVISIO | Choose a plan whose commercial-use terms, uptime, and resource limits fit the service |
| Neon Postgres compute/storage/backup | AKVISIO | Monitor usage and set limits/alerts where available |
| AI model/API usage | AKVISIO or passed through under the customer contract | Configure explicit quotas and usage visibility; do not promise unlimited AI |
| WhatsApp provider/platform fees | AKVISIO or passed through under the customer contract | Confirm provider pricing and who pays before activation |
| Email/SMS/payment provider | Only if selected | Keep optional until a real integration is needed |
| Development/testing | Prefer free-tier resources | Avoid paid upgrades until measured requirements justify them |

## Current safety defaults

- AI Host creates staff-reviewed drafts; it does not automatically send a WhatsApp reply.
- Payment claims are not treated as verified payments without authorized verification.
- Production schema changes are not performed by CI or this checklist.
- A green build is not proof of production hosting, live WhatsApp connectivity, or real-device acceptance.

## Go-live definition

AutoHost should be called **live** only after production hosting and HTTPS are verified, migrations are applied and schema readiness is green, required secrets are present, a tenant can complete the agreed onboarding flow, backup/restore is checked, and the approved end-to-end acceptance test is recorded.
