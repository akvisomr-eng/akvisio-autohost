# Platform Super Admin authentication

The platform operator identity is separate from tenant `users` and tenant session cookies.

## Required server secrets
- `PLATFORM_SESSION_SECRET`: random secret, at least 32 characters, used only to sign platform sessions.
- `PLATFORM_BOOTSTRAP_SECRET`: separate random secret, at least 32 characters, used once to create the first platform administrator.
- `DATABASE_URL`: use the intended development database until migrations and tests have been verified.

## Bootstrap
After applying migrations 001–010 to a dedicated development database and configuring both secrets, send a one-time request to `POST /api/platform/auth/bootstrap` with `secret`, `email`, `fullName`, and a password of at least 14 characters. The endpoint refuses to run if any platform administrator already exists and serializes concurrent bootstrap requests with a PostgreSQL advisory lock. Do not put the bootstrap secret in frontend code, URLs, logs, or source control.

After the first administrator exists, remove or rotate `PLATFORM_BOOTSTRAP_SECRET` in the deployment environment. The endpoint will still reject further bootstrap attempts because the administrator table is no longer empty.

## Login/session
- `POST /api/platform/auth/login`
- `GET /api/platform/auth/session`
- `POST /api/platform/auth/logout`
- UI: `/platform/login`

The session uses an HTTP-only, SameSite=Strict cookie and an independent signing secret. The active administrator is revalidated against PostgreSQL on every session lookup. Five failed attempts lock an existing account for 15 minutes. Successful logins are audited.

## Not yet a complete Super Admin console
This change establishes authentication only. Tenant management, plans, subscription activation, invoice generation, payment verification, commissions, usage limits, and suspension workflows must be implemented and tested separately. Do not represent the console as production-ready until those operations and recovery controls are verified.
