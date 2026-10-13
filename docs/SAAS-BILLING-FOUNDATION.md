# SaaS billing foundation

Migration `009_platform_billing_foundation.sql` introduces database structures only. Migration `012_seed_commercial_subscription_plans.sql` seeds the currently approved monthly prices and activation fee; it does not create an administrator, issue invoices, verify payments, or activate subscriptions.

## Tables
- `platform_admins`: separate platform operator identities; distinct from tenant users.
- `subscription_plans`: configurable activation/monthly fees, commission rate/cap, and usage limits. Migration 012 seeds the approved list prices; usage entitlements remain intentionally unset until they are agreed.
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


## Commercial price catalogue (migration 012)

| Plan | Activation (one-time) | Monthly subscription |
|---|---:|---:|
| Starter | Rp3.500.000 | Rp475.000 |
| Business | Rp3.500.000 | Rp895.000 |
| Pro | Rp3.500.000 | Rp1.595.000 |

The migration updates only the plan catalogue's names, descriptions, activation fees, and monthly list prices for these plan codes. Existing tenant subscriptions retain their fee snapshots. Commission remains zero and no unapproved vehicle/user/conversation limits or AI-token allowances are invented. AI quotas, external WhatsApp/provider fees, taxes, and final support commitments must be agreed before selling those entitlements as available. Migration 013 and the billing API implement the 10% annual subscription discount; activation is not discounted.


## Billing cycles

Migration `013_annual_subscription_discount.sql` adds an explicit `discount_amount` line. Monthly invoices cover one full calendar month without a discount. Annual invoices cover exactly 12 calendar months, calculate 12 times the saved monthly fee, and apply a 10% discount to subscription fees only. Activation fees remain separate and undiscounted. Tax is entered by an authorized Super Admin after review; the system does not infer tax treatment.
