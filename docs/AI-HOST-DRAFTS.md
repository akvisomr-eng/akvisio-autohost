# AI Host — Draft generation

This endpoint creates a reply draft only when a staff member explicitly requests it. It does not send WhatsApp messages and does not automatically process inbound webhooks.

## Configuration

- `AI_HOST_ENABLED=false` by default.
- `AI_HOST_BASE_URL` must be an HTTPS OpenAI-compatible API base URL ending at the API prefix (for example, a provider's `/v1` path).
- `AI_HOST_API_KEY` is a server-side secret; never expose it to browser code or commit it.
- `AI_HOST_MODEL` must name a model enabled for the configured account.

## Endpoint

`POST /api/conversations/:id/ai-draft`

Requires an authenticated tenant staff role and the latest conversation message to be inbound. Reads only published knowledge documents for the authenticated tenant and the selected conversation's recent messages. Draft generation is capped at 20 runs per tenant per 10 minutes. A run is recorded in `ai_runs` and an audit entry is created. The response explicitly includes `sent: false`.

## Safety boundaries

- Does not send outbound messages or change booking/payment state.
- No published knowledge means the model must not invent business facts.
- Availability, prices not in approved knowledge, and booking status must not be invented; this prompt has no live fleet-availability tool.
- Provider calls are disabled unless `AI_HOST_ENABLED=true` and all HTTPS endpoint, key, and model settings are present.
- Before enabling, use a dedicated test tenant and approved provider credentials; monitor cost and run end-to-end tests. This is not a live autonomous AI Host.


## Provider response limits and cost estimates

- Provider responses are read with a hard 128 KiB ceiling and rejected if the JSON payload is invalid or lacks a text answer.
- The provider call has a 15-second timeout; failures are recorded as failed AI runs and never trigger an outbound message.
- Token usage is saved to `ai_runs` when the provider supplies usage metadata.
- Optional `AI_HOST_INPUT_USD_PER_1K_TOKENS` and `AI_HOST_OUTPUT_USD_PER_1K_TOKENS` values define explicit per-1,000-token rates in USD. When both rates and token counts are present and valid, `ai_runs.estimated_cost` stores an estimate in USD and the audit event includes that estimate. If either rate is absent or invalid, estimated cost remains null rather than inventing a rate.
- These estimates are operational approximations, not provider invoices. Reconcile against the provider's actual usage/billing dashboard.
- `AI_HOST_ENABLED` remains `false` by default. This improvement does not enable automatic replies or WhatsApp outbound sending.
