# Production Readiness Checklist

This checklist is a release gate, not a claim that the application is live. Complete each item in a controlled environment before accepting real customers or payments.

## 1. Hosting and secrets

- [ ] Select and provision a supported Node.js hosting target for the Next.js app.
- [ ] Configure a public HTTPS application URL and set `APP_BASE_URL` to that exact origin.
- [ ] Configure `DATABASE_URL` using the intended Neon branch. Verify the runtime points to the intended environment before deployment.
- [ ] Set a strong, unique `SESSION_SECRET`, `BOOTSTRAP_SECRET`, and `WHATSAPP_PROCESSOR_SECRET`.
- [ ] Keep all secrets server-side. Never use a `NEXT_PUBLIC_` prefix for credentials.
- [ ] Configure secrets in the hosting platform / GitHub Actions secret store, not in Git, screenshots, logs, or issue comments.
- [ ] Confirm production database backups and a recovery procedure before onboarding customers.

## 2. Neon database and tenant isolation

- [ ] Apply reviewed migrations to a non-production branch first.
- [ ] Verify the migration history, required indexes, foreign keys, and validated tenant-composite constraints.
- [ ] Test that a user from organization A cannot list, read, update, invoice, or verify organization B records by changing IDs.
- [ ] Test invoice creation twice for the same booking; the second active invoice must be rejected.
- [ ] Test concurrent payment verification so verified receipts cannot exceed the invoice amount.
- [ ] Test that a refund cannot exceed net verified receipts for its invoice / booking.
- [ ] Confirm audit records are written for invoice issuance, payment entry, verification/rejection, and expense entry.
- [ ] Do not run synthetic transactions against production. Use isolated test data on development/staging.

## 3. WhatsApp Cloud API setup

Set these server-side values only after the Meta app and WhatsApp Business phone are configured:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_PROCESSOR_SECRET`
- `APP_BASE_URL`

Then:

- [ ] Configure the Meta webhook callback URL on the public HTTPS origin and the exact webhook route implemented by this repository.
- [ ] Complete Meta webhook verification using a private, random verify token.
- [ ] Subscribe the WhatsApp Business account to the message and status webhook fields required by the app.
- [ ] Set `organizations.whatsapp_phone_number_id` for the correct tenant only after confirming the real Meta phone number ID.
- [ ] Send a real inbound test message and confirm the webhook event is accepted and deduplicated.
- [ ] Confirm the scheduled GitHub Actions processor can call the internal processor endpoint with `WHATSAPP_PROCESSOR_SECRET`.
- [ ] Verify the event becomes a tenant-scoped customer / conversation / message and delivery statuses update correctly.
- [ ] Test invalid signatures, duplicate events, malformed payloads, retries, and the failed-event limit.
- [ ] Verify human handoff and that the assistant does not claim an action was completed unless the authorized business operation succeeded.

**Current scope note:** webhook ingestion and event processing are not, by themselves, a complete outbound AI host. Confirm outbound message sending, approved message templates where required, AI provider wiring, consent/privacy text, rate limits, and human handoff behavior before advertising automated replies as available.

## 4. Finance controls

- [ ] Confirm authorized roles only can issue invoices, record expenses, and verify/reject payments.
- [ ] Keep new manual payments pending until an authorized person verifies receipt.
- [ ] Never mark a payment verified from a chat message or screenshot alone.
- [ ] Reconcile invoices, verified payments, refunds, and booking payment status against source records.
- [ ] Verify refund approvals and proof of the actual refund outside the chat before recording it as verified.
- [ ] Check the date range and totals on the finance report against known development fixtures.
- [ ] Document who is allowed to correct mistakes and how audit history is preserved.

## 5. Release acceptance

- [ ] GitHub Actions TypeScript, lint, and build checks pass on the exact main commit to deploy.
- [ ] Deploy the tested commit, not an unreviewed branch.
- [ ] Run smoke tests for sign-in, role restrictions, fleet/customer/booking CRUD, invoice issuance, pending payment entry, payment verification, expense entry, and WhatsApp inbox.
- [ ] Review runtime logs for missing environment variables, database errors, webhook signature failures, and repeated retries.
- [ ] Confirm no credentials or customer data appear in logs.
- [ ] Record the deployed commit SHA, migration version, test evidence, rollback method, and release approver.
- [ ] Only announce production readiness after all mandatory checks are complete.

## Known external prerequisites

A live WhatsApp test cannot be completed without a configured Meta app, a real WhatsApp Business phone number, valid credentials, a reachable HTTPS callback, and the organization-to-phone-number mapping. A real production deployment also requires a selected hosting target and environment secrets. Do not substitute placeholder credentials or report these checks as passed without evidence.
