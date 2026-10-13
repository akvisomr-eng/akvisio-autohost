# WhatsApp staff replies

This feature sends staff-authored text replies through the Meta WhatsApp Cloud API. It is not the AI Host and does not claim that Meta Business Agent Platform is connected.

## Configuration

- `WHATSAPP_ACCESS_TOKEN`: server-side token with the required WhatsApp messaging permission.
- `WHATSAPP_GRAPH_API_VERSION`: an active Graph API version supported by the Meta app (for example, copy the currently supported version from Meta's developer dashboard; do not rely on an outdated example).
- `organizations.whatsapp_phone_number_id`: verified Meta phone-number ID for this tenant, configured only after confirming the correct business account.
- Apply `database/migrations/007_whatsapp_outbound_idempotency.sql` to development/staging before deploying the endpoint.

Never expose the access token through a `NEXT_PUBLIC_` variable or commit credentials to Git.

## Guardrails

- Only authenticated owner/admin/manager/staff/dispatcher roles can send; viewer and finance-only roles cannot.
- The conversation and organization are scoped to the current session.
- Only active WhatsApp conversations can be replied to.
- Free-form text is sent only when the most recent inbound message is within the 24-hour customer-service window. This endpoint does not send templates.
- The CRM writes a queued message before calling Meta. A stable request UUID deduplicates client retries. Uncertain provider outcomes remain queued and are never automatically resent.
- Provider acceptance is recorded as `sent`; delivery/read statuses are updated by incoming Meta webhooks.
- Every queued/sent/failed staff reply creates an audit record where the database operation succeeds.
- This endpoint sends staff text only. AI-generated messages, booking changes, invoice/payment actions, and automatic replies are deliberately out of scope.

## Acceptance tests before production

1. With credentials absent, the endpoint returns 503 and sends nothing.
2. Unauthenticated and viewer requests are denied.
3. A conversation from another tenant is not accessible.
4. A resolved/archived or non-WhatsApp conversation cannot be replied to.
5. No inbound message or an inbound message older than 24 hours blocks free-form replies.
6. Duplicate request IDs never trigger a second Meta send.
7. Meta rejection records failure; timeout/ambiguous response remains queued and does not auto-retry.
8. A real test message confirms provider message ID, webhook delivery status, and audit trail.
9. Validate behavior using development/staging data first; do not generate synthetic messages against production.

## Relationship to Meta Business Agent

The existing webhook inbox and this guarded manual-reply path provide a controlled messaging foundation. Meta Business Agent / Agent Platform access and API compatibility must be verified separately before choosing it as the AI runtime. Any future agent should call tenant-scoped CRM tools, never write database records directly, and require server-side authorization for booking or finance actions.

## Meta Business Agent decision

Treat Meta Business Agent and Meta Business Agent Platform as separate products:

- The in-app Business Agent is enabled from the WhatsApp Business app's Tools area when the account is eligible.
- The Agent Platform is intended for deeper integration with existing business systems. Do not assume API access, programmatic tool invocation, or Indonesian-language support until the exact account and developer access have been verified.
- Meta's WhatsApp Help Center currently says availability is limited to selected businesses/countries and that not all languages are supported. Availability must therefore be checked in the actual Sans Rent Cars business account rather than inferred from the global announcement.
- Preferred strategy: keep the CRM as the source of truth, use official WhatsApp Cloud API for controlled messaging, and evaluate Agent Platform as an optional adapter after access/contract/API capabilities are confirmed. Do not run two independent bots on the same customer thread without a clear handoff policy.

Official references:
- Meta announcement: https://about.fb.com/news/2026/06/meta-business-agent/
- WhatsApp Help Center availability note: https://faq.whatsapp.com/1153795669452207/
- Official WhatsApp Cloud API collection: https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api
