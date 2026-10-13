# WhatsApp inbox ingestion and human handoff

## Implemented path
1. `POST /api/webhooks/whatsapp` validates Meta's HMAC signature and stores the webhook as `pending`.
2. `POST /api/internal/process-whatsapp` claims a batch using row locks and `SKIP LOCKED`, resolves `metadata.phone_number_id` to an organization, and stores inbound messages/status updates.
3. `GET /api/conversations` lists only conversations in the signed-in user's organization. Add `?conversationId=<uuid>` for a thread.
4. `PATCH /api/conversations/:id` applies audited status changes including handoff to `pending_human`.

## Server secrets
- `WHATSAPP_VERIFY_TOKEN`: webhook challenge verification token.
- `WHATSAPP_APP_SECRET`: Meta app secret for webhook signature validation.
- `WHATSAPP_PROCESSOR_SECRET`: high-entropy secret for the internal event processor's `Authorization: Bearer <secret>` header.
- `DATABASE_URL`: Neon development or production connection string, appropriate to the environment.

Never use `NEXT_PUBLIC_*` for secrets and never commit real values.

## Tenant mapping and migration
Apply `database/migrations/006_whatsapp_inbox_tenant_routing.sql` to the target database before running the processor. It adds `organizations.whatsapp_phone_number_id` and validated composite foreign keys for conversation/customer and message/conversation organization consistency.
Set `organizations.whatsapp_phone_number_id` to the actual Meta WhatsApp Business phone-number ID for that organization. This is a Meta ID, not the displayed telephone number. If it is missing or not mapped, the event fails closed and is not assigned to a tenant.

## Running the processor
A trusted scheduler or backend worker should POST to `/api/internal/process-whatsapp` with the bearer secret. Optional JSON: `{"limit": 10}` (maximum 20). To retry failed events after correcting a mapping or transient issue, explicitly send `{"limit": 10, "retryFailed": true}`; retry eligibility is capped by the stored attempts count.

## Safety and current limitations
- No automated AI response and no outbound WhatsApp send endpoint is enabled yet.
- The inbox supports reading the stored thread, human handoff, reopen, resolve, and archive status changes.
- Media is represented by a placeholder; media download/storage is not implemented.
- Unknown phone-number IDs are not routed to any organization.
- Event processor failures are recorded; configure monitoring and an operational retry schedule.
- Do not use this as proof of production connectivity. Real Meta app secrets, phone-number ID, callback configuration, public HTTPS hosting, and end-to-end tests remain required.
