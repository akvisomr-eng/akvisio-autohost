# Scheduled WhatsApp webhook processor

The GitHub Actions workflow `.github/workflows/whatsapp-processor.yml` calls the internal processor every five minutes. This is a low-cost starter scheduler; it requires no separate queue vendor.

Configure these repository Actions secrets after the application is deployed at a public HTTPS URL:
- `APP_BASE_URL`: base URL only, for example `https://your-app.example` (no trailing path).
- `WHATSAPP_PROCESSOR_SECRET`: same high-entropy server secret configured in the application's runtime.

If either secret is absent, the scheduled workflow safely skips. Manual runs are available through Actions → WhatsApp Event Processor → Run workflow.

The processor is idempotent for repeated provider message IDs and uses database row locks to avoid two workers claiming the same pending event. Failed events are not retried automatically by this workflow; after fixing a cause, run the processor manually with `{"limit":10,"retryFailed":true}` using a trusted caller. The normal scheduled workflow only sends `{"limit":10}`.

This scheduler does not deploy the application and does not configure Meta. A working public HTTPS runtime, database migration 006, Meta secrets, the real WhatsApp `phone_number_id` mapped to the correct organization, and end-to-end webhook tests remain prerequisites. Do not put the processor secret in client-side variables or repository files.
