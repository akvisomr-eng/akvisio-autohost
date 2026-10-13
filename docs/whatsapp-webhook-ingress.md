# WhatsApp Cloud API webhook ingress

Endpoint: `GET/POST /api/webhooks/whatsapp`

## Required server secrets
- `WHATSAPP_VERIFY_TOKEN`: private random token configured both in the Meta webhook subscription and backend environment.
- `WHATSAPP_APP_SECRET`: Meta app secret used to validate `X-Hub-Signature-256`.

Never place these values in client-side `NEXT_PUBLIC_*` variables or commit them to Git.

## Current behavior
- GET validates Meta's `hub.mode=subscribe`, verify token, and challenge.
- POST verifies the HMAC-SHA256 signature against the raw request body before parsing.
- Payloads larger than 1 MB are rejected.
- Valid webhook payloads are persisted into `webhook_events` as `pending`, deduplicated by provider and SHA-256 body hash.
- A database failure returns HTTP 503 so Meta can retry delivery.
- The endpoint does **not** send replies, run an AI model, or mark bookings/payments as confirmed. Processing is a separate worker/task to be implemented and tested later.

## Before production
1. Deploy behind a public HTTPS URL.
2. Set both secrets in the backend runtime and configure the callback URL/token in Meta.
3. Subscribe only the required WhatsApp Business Account webhook fields.
4. Test valid signature, invalid signature, duplicate delivery, malformed payload, and database outage.
5. Add a monitored processor with retry limits, dead-letter handling, tenant resolution by verified `phone_number_id`, inbound message idempotency, and staff handoff before enabling AI responses.
