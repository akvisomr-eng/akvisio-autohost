# SaaS billing foundation

Migration `009_platform_billing_foundation.sql` introduces database structures only. It does not seed commercial prices, create an administrator, issue invoices, verify payments, or activate subscriptions.

## Tables
- `platform_admins`: separate platform operator identities; distinct from tenant users.
- `subscription_plans`: configurable activation/monthly fees, commission rate/cap, and usage limits. No price is presumed or seeded.
- `tenant_subscriptions`: tenant subscription lifecycle and a snapshot of the selected plan's commercial terms.
- `platform_invoices` / `platform_payments`: platform-level billing, separate from each tenant's rental invoices and receipts.
- `commission_entries`: one entry per eligible source payment, with the rate and commissionable amount snapshotted. Only rental/extra-charge source types are allowed; deposits/refunds cannot be directly represented as commission entries.
- `tenant_usage_monthly`: monthly counters for message/AI use, cost estimates, bookings, and commissionable revenue.
- `platform_audit_logs`: distinct audit trail for platform-wide administration.

## Required follow-up before billing is live
1. Implement a separate platform-admin login/session and server-side authorization. Tenant roles must never imply platform access.
2. Build idempotent subscription/activation/renewal invoice generation and a clear invoice-number policy.
3. Implement trusted payment callbacks or an authorized manual verification workflow; chat text and screenshots are not proof of payment.
4. Calculate commission only from verified eligible rental receipts; exclude refundable deposits, cancelled bookings, refunds, and reversed receipts per the signed plan. Apply monthly caps deterministically.
5. Add transaction locks, tenant-integrity tests, idempotency tests, audit events, reconciliation reports, and subscription suspension/grace-period policies.
6. Apply the migration to a dedicated Neon development branch and verify it before any production decision. No production database is modified by this repository change.
