# Platform invoice and payment workflow

This phase adds draft invoice generation and controlled payment reconciliation for platform fees. It does not alter the tenant's rental invoice/payment workflow.

## Create and issue an invoice
- `POST /api/platform/invoices` creates a draft from a tenant subscription snapshot.
- Activation invoice uses the saved activation fee and is allowed only while activation is due.
- Monthly subscription invoices use the saved monthly fee and require one full calendar month. Annual subscriptions require a full 12-month period, calculate 12 times the saved monthly fee, and apply a 10% discount shown in `discount_amount`; activation is billed separately and is not discounted.
- Commission invoice uses pending commission entries in a full calendar month.
- Idempotency keys and unique indexes prevent duplicate requests and duplicate active period invoices.
- Drafts are not sent to tenants. Issuing requires an explicit tax amount and future due date. The system does not assume a tax rate.
- Voiding is audited and disallowed when a payment claim is pending or a payment is verified.

## Record and verify payment
- `POST /api/platform/payments` records a payment claim as `pending`; it is not proof of receipt.
- `PATCH /api/platform/payments/:id` allows a platform admin to verify or reject pending claims, or mark a verified payment refunded.
- Invoice balance is recalculated under row locks. Overpayment and duplicate/idempotent claims are rejected.
- Activation fee becomes marked paid only when its activation invoice is fully paid. Subscription status is **not** automatically activated.
- The platform console reminds the operator to verify using trusted bank/provider records, not chat messages or screenshots.

## Remaining before production billing
- Implement a dedicated activation/suspension/reactivation workflow.
- Implement commission-entry generation from verified eligible tenant receipts with monthly cap allocation and reversal handling.
- Define invoice numbering, tax treatment, customer-facing delivery, reminders, reconciliation, and accounting retention.
- Add automated integration tests for invoice issue/void and payment state transitions.
- Apply migrations 009–011 to an isolated Neon development branch and verify the real schema. Do not apply them to production without explicit authorization.
