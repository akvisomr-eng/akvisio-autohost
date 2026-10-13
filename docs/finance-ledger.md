# Finance ledger and payment verification

## Scope
- Organization-scoped finance summary, payment ledger, and expense ledger.
- Record customer payments in `pending` status only.
- Only owner, admin, manager, and finance roles may verify/reject a pending payment.
- Only owner, admin, manager, and finance roles may record expenses or refunds.
- Every record/decision is written to `audit_logs`.
- Verified payments update the linked booking's `payment_status` or invoice's paid/partially-paid state.
- Tenant integrity is enforced by composite foreign keys in migration 005.

## Safety rules
1. Chat messages, screenshots, and customer claims never mark a payment as paid. A staff member must record the transaction and an authorized finance/manager role must verify it.
2. A payment can be decided only once from `pending`; verified/rejected records cannot be overwritten by this endpoint.
3. A payment must be associated with a booking or invoice within the current organization.
4. An expense may reference only a vehicle or booking within the current organization.
5. Amounts are stored as positive values; refunds use `payment_type = 'refund'` and reduce net received totals only when verified.
6. This is an operational cashbook, not a full double-entry accounting ledger. Tax invoices, statutory bookkeeping, bank-feed reconciliation, and payment gateway callbacks are not included.

## API
- `GET /api/finance`: summary, latest payments, latest expenses. Optional `from=YYYY-MM-DD&to=YYYY-MM-DD`.
- `POST /api/finance`: `kind: "payment"` records pending payment; `kind: "expense"` records an expense.
- `PATCH /api/finance/payments/:id`: finance roles set `status: "verified"` or `"rejected"`.

## Development migration
Apply `database/migrations/005_finance_tenant_integrity.sql` to the Neon development branch first. Confirm all five composite foreign-key constraints are validated and that no production branch was changed. Production rollout requires a separate backup, deployment, and migration review.
