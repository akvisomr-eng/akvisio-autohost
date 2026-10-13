# AKVISIO Autohost — Product & Delivery Plan

## Product outcome
Deliver a multi-tenant SaaS whose primary value is a reliable AI Host that handles customer conversations and assists booking, with an operations CRM behind it. Sans Rent Cars is the initial tenant/pilot, not the product identity.

## Delivery gates

### Gate 1 — Product foundation
- Product branding and documentation say AKVISIO Autohost.
- Preserve tenant-level business name and WhatsApp number as tenant configuration.
- CI covers lint, typecheck, build, policy tests, finance validation, and PostgreSQL tenant isolation tests.
- Production database remains untouched during development.

### Gate 2 — AI Host core (manual draft available; automatic replies not live)
- [x] Provider adapter for staff-requested drafts with strict timeout, bounded response size, optional usage/cost tracking, and fail-closed behavior.
- [x] Retrieve tenant-scoped knowledge documents for manual drafts; continue verifying approval lifecycle and retrieval quality before automatic use.
- Use a small allowlist of typed business tools. Never permit model-generated SQL.
- Require grounded evidence for rates, availability, policies, and booking status. If no verified answer exists, ask a clarification or hand off to a person.
- Persist inbound, AI decision, tool invocation, usage, and outbound attempt as auditable events.
- Deduplicate by provider message ID and ensure retries cannot send duplicate answers.
- [x] Keep automated replies disabled until a separate, explicitly approved test configuration is verified.

### Gate 3 — Booking workflow
- Gather dates/times, rental duration, service mode, vehicle class, pickup/return locations, and relevant customer details.
- Query real tenant fleet and booking overlaps using timezone-aware timestamps.
- Quote only stored rates and explicitly configured charges; show estimates as estimates.
- Create a pending booking request through a server-side transaction. Only authorized staff/business policy can confirm it.
- Payment verification is independent from chat and AI. No screenshot or customer assertion can mark an invoice paid.

### Gate 4 — Human handoff and service operations
- Conversation states explicitly distinguish AI-active, pending-human, human-owned, resolved, and archived.
- Staff takeover atomically disables AI auto-replies for that conversation until a deliberate release.
- Expose retry-safe processing, dead-letter/error visibility, latency, token/usage cost, and audit history.
- Enforce per-tenant usage limits and rate limits.

### Gate 5 — SaaS billing and Super Admin (core implementation present; production validation pending)
- Separate platform subscription billing from each tenant's rental invoices.
- [x] Core implementation: plan catalogue, activation fee, subscription invoices, annual 10% discount, payment verification workflow, commission settlement, subscription activation/suspension/reactivation/cancellation, and audit. [ ] Finalize and test grace-period enforcement and tenant usage limits before commercial rollout.
- Commission calculation uses only eligible verified rental receipts; exclude cancelled/refunded amounts and refundable deposits according to the signed plan.
- Platform payment status changes only through a verified payment provider callback or an authorized finance/admin workflow.
- Super Admin endpoints require a distinct platform-level authorization model; tenant owner/admin roles must not grant platform-wide access.
- Every billing mutation is audited and idempotent.

### Gate 6 — Controlled release
- Unit + integration tests, migration tests on development branch, tenant-isolation tests, and webhook replay tests.
- End-to-end tests with an approved WhatsApp test number and explicit recipient allowlist.
- Verify rollback and observability before production rollout.
- No claim of live AI or live WhatsApp until an end-to-end message is observed and the result is independently verified.

## Non-negotiable constraints
- Never apply migrations to Neon production as part of autonomous development.
- Keep `WHATSAPP_OUTBOUND_ENABLED=false` unless explicit activation authorization, provider credentials, and test/production policy are all verified.
- Never use Sans Rent Cars' live number `+6281586878487` for integration or trial without a separate explicit authorization.
- Never commit API keys, access tokens, session secrets, or customer personal data.
- If a provider credential or external approval is missing, implement and test the safe code path without pretending the external integration is live.


## Current commercial catalogue (development)

- Starter: Rp475.000/month
- Business: Rp895.000/month
- Pro: Rp1.595.000/month
- Activation: Rp3.500.000 once per tenant
- Annual subscription discount: 10% of 12 months' subscription fees; activation fee is not discounted.

These values were observed in the development catalogue. They are not proof that production billing has been migrated or enabled.
