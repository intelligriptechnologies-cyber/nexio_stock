# Implementation Spec: Shop Access Key 2FA

## Document Control

| Field | Value |
|---|---|
| Status | Draft |
| Last updated | 2026-07-27 |
| Source BRD | `docs/BRD_shop_access_key_2fa.md` |
| Product PRD | `docs/PRD_shop_access_key_2fa.md` |
| Target branch | `improved_ui_auth` |

## Implementation Summary

Add a second-factor access-key layer to the existing FastAPI/SQLAlchemy/Postgres backend and React/Vite frontend. The first-stage login screens stay unchanged. When policy requires 2FA, first-stage login creates a short-lived pending challenge and returns it instead of the normal JWT. The frontend then renders an access-key step. Successful verification consumes the challenge and returns the normal JWT response.

Add shop-level 2FA controls to Shop Master, superadmin personal 2FA controls to Settings -> Security, and a self-contained Windows GUI authenticator that generates the same 6-digit time-window codes as the backend verifier.

## Existing System Context

- Backend auth currently lives under `app/api/auth.py`.
- Shop login currently posts to `POST /auth/login` and returns `TokenResponse`.
- Superadmin login currently posts to `POST /auth/login/superadmin` and returns `TokenResponse`.
- JWT creation currently lives in `app/security/jwt.py`.
- User and role models live in `app/models/user.py`.
- Shop settings live in `app/models/shop.py`.
- Existing browser device bindings live in `app/models/device.py` and `app/api/shops.py`.
- Shop Master UI currently has `Shop Details`, `Allotted Users`, and `Quick Inventory Check` tabs.
- Current frontend auth state stores only final JWT/user state; pending auth challenges should stay outside `AuthProvider` until verified.

## Architecture

### Components

| Component | Responsibility |
|---|---|
| Backend 2FA policy resolver | Determines whether an authenticated first-stage user needs shop or superadmin 2FA. |
| Backend challenge service | Creates, hashes, expires, consumes, and audits pending auth challenges. |
| Backend access-key service | Generates and verifies 6-digit codes from encrypted secrets and server time. |
| Shop 2FA API | Superadmin shop-level settings, secret rotation, package/activation provisioning, and machine/device management. |
| User 2FA API | Logged-in superadmin personal 2FA status and enable/disable controls. |
| Frontend login challenge UI | Renders `Enter Access Key` only after first-stage credentials succeed and a challenge is returned. |
| Shop Master 2FA tab | Controls shop policy, role requirements, secret rotation, package download/provisioning, and machines/devices. |
| Windows customer authenticator | Small WinForms app that displays shop identity, current code, and countdown. |
| Windows superadmin authenticator/vault | Separate superadmin-side GUI for the superadmin factor and sensitive provisioning workflows. |

### Auth State Machine

```text
credential_form
  -> submit credentials
  -> invalid_credentials
  -> token_issued
  -> two_factor_challenge_created
      -> submit access key
      -> wrong_key_retryable
      -> expired_or_consumed_restart
      -> too_many_attempts_restart
      -> token_issued
```

Rules:

- `token_issued` is the only state that enters `AuthProvider.login(...)`.
- A pending challenge is stored only in component state/session state needed for the second step.
- Browser refresh during `two_factor_challenge_created` discards local state; the user restarts login.
- Logging out/back from the access-key screen discards the pending challenge client-side. The server challenge expires naturally.

## Backend Spec

### Configuration

Add explicit settings:

| Setting | Default | Purpose |
|---|---|---|
| `two_factor_step_seconds` | `300` | 5-minute access-key generation window. |
| `two_factor_challenge_ttl_seconds` | `600` | Pending challenge lifetime. |
| `two_factor_grace_seconds` | `30` | Previous-window grace immediately after rollover. |
| `two_factor_max_attempts` | `5` | Max wrong verification attempts per challenge. |
| `two_factor_secret_encryption_key` | required outside tests | Encrypts stored factor secrets. |

Use a production secret-management path for `two_factor_secret_encryption_key`; do not commit it to the repo.

### Database Changes

Create an Alembic migration adding the following.

#### `shops` columns

| Column | Type | Default | Notes |
|---|---|---|---|
| `two_factor_enabled` | boolean | false | Existing shops start disabled. |
| `two_factor_secret_version` | integer nullable | null | Current active shop factor version. |
| `two_factor_rotated_at` | timestamptz nullable | null | Last generation/rotation time. |
| `two_factor_required_for_roles` | varchar[] | owner, cashier_user, receiver_user | Role policy for shop-scoped users. |

#### `users` columns

| Column | Type | Default | Notes |
|---|---|---|---|
| `two_factor_enabled` | boolean | false | Migration sets true for existing superadmin rows; shop users are controlled by shop policy. |
| `two_factor_secret_version` | integer nullable | null | Current active user factor version for superadmin. |
| `two_factor_rotated_at` | timestamptz nullable | null | Last superadmin factor rotation time. |
| `two_factor_disabled_at` | timestamptz nullable | null | Audit-friendly timestamp for personal disable action. |

#### `two_factor_secrets` table

Stores encrypted factor seeds. This table lets shop and user factors share one secret service without putting ciphertext directly on primary domain rows.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `subject_type` | varchar(16) | `shop` or `user`. |
| `shop_id` | FK nullable | Set for shop subject. |
| `user_id` | FK nullable | Set for user subject. |
| `version` | integer | Monotonic per subject. |
| `secret_ciphertext` | text | Encrypted random secret. |
| `is_active` | boolean | Only one active secret per subject. |
| `created_by_user_id` | FK nullable | Actor that generated/rotated. |
| `created_at` | timestamptz | |
| `retired_at` | timestamptz nullable | Set on rotation. |

Constraints:

- Exactly one of `shop_id` or `user_id` is set according to `subject_type`.
- Unique `(subject_type, shop_id, version)` for shop factors.
- Unique `(subject_type, user_id, version)` for user factors.
- Partial unique active-secret index per subject if the database supports it.

#### `pending_auth_challenges` table

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Internal challenge ID. |
| `challenge_token_hash` | varchar(128), unique | Hash of the random token returned to the client. |
| `user_id` | FK | First-stage authenticated user. |
| `shop_id` | FK nullable | Present for shop users. |
| `factor_subject_type` | varchar(16) | `shop` or `user`. |
| `factor_shop_id` | FK nullable | Shop factor target. |
| `factor_user_id` | FK nullable | User factor target. |
| `factor_secret_version` | integer | Version expected at creation time. |
| `device_key_hash` | varchar(128) nullable | Required for shop-user challenges. |
| `expires_at` | timestamptz | Short TTL. |
| `consumed_at` | timestamptz nullable | Set on success. |
| `failed_attempts` | integer | Starts at 0. |
| `last_failed_at` | timestamptz nullable | Support/audit metadata. |
| `created_at` | timestamptz | |

Indexes:

- `challenge_token_hash`
- `(user_id, created_at)`
- `(shop_id, created_at)`
- `(expires_at, consumed_at)`

#### `authenticator_activations` table

Tracks installed customer authenticators separately from browser device bindings.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `shop_id` | FK | Shop this authenticator belongs to. |
| `secret_version` | integer | Secret version provisioned. |
| `machine_label` | varchar(120) nullable | Human support label. |
| `machine_fingerprint_hash` | varchar(128) | Hashed client fingerprint, not raw hardware data. |
| `is_active` | boolean | Support can deactivate/reactivate. |
| `activated_by_user_id` | FK nullable | Superadmin/support actor when known. |
| `activated_at` | timestamptz | |
| `last_seen_at` | timestamptz nullable | Optional if activation or heartbeat calls exist. |
| `deactivated_at` | timestamptz nullable | |

#### `authenticator_activation_tokens` table

One-time provisioning tokens for customer authenticator activation.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `token_hash` | varchar(128), unique | Hash of the one-time token. |
| `shop_id` | FK | Target shop. |
| `secret_version` | integer | Secret version token can activate. |
| `expires_at` | timestamptz | Short-lived support token. |
| `consumed_at` | timestamptz nullable | Set after successful activation. |
| `created_by_user_id` | FK | Superadmin actor. |
| `created_at` | timestamptz | |

### Secret Generation and Storage

- Generate factor secrets with `secrets.token_bytes(32)`.
- Store secrets encrypted at rest using an authenticated encryption scheme from `cryptography`.
- Base32-encode the raw secret only when handing it to the authenticator activation response or package builder.
- Never log raw secrets, ciphertext, or displayed 6-digit codes.
- Challenge tokens and activation tokens are random high-entropy values returned once and stored only as hashes.
- Rotating a secret retires the old secret, creates a new active version, updates the owning shop/user version columns, and expires unconsumed challenges for the old version.

### Access-Key Algorithm

Use one deterministic implementation in the backend and an equivalent implementation in the Windows app.

```text
time_step = 300
counter = floor(unix_time_seconds / time_step)
digest = HMAC-SHA256(secret_bytes, counter_as_8_byte_big_endian)
offset = low_4_bits(digest[last_byte])
binary = dynamic_truncate(digest, offset) & 0x7fffffff
code = binary mod 1_000_000
display = code left-padded to 6 digits
```

Verification:

- Validate submitted code shape before HMAC work.
- Calculate the current server counter.
- Accept the current counter.
- Accept the previous counter only when the server is within `two_factor_grace_seconds` after a window rollover.
- Do not accept future counters by default.
- Compare candidate codes with constant-time comparison.
- Record matched counter offset internally for diagnostics; never return it to the client.

### Policy Resolution

Shop user policy:

1. Authenticate username/PIN/role exactly as today.
2. Load the user's shop.
3. If `shop.two_factor_enabled` is false, issue the normal JWT.
4. If enabled and the user's role is not in `two_factor_required_for_roles`, issue the normal JWT.
5. If enabled and role is required, require the submitted `device_key` to map to an active `DeviceBinding` for the same shop.
6. If the device is valid, create a shop-factor pending challenge.
7. If the device is missing/inactive, return a structured 403 error and audit the blocked attempt.

Superadmin policy:

1. Authenticate username/password exactly as today.
2. If `user.two_factor_enabled` is false, issue the normal JWT.
3. If enabled, create a user-factor pending challenge.
4. If the user has no active 2FA secret yet, return a provisioning-required error for setup/admin flow rather than issuing a JWT.

### API Contracts

#### First-stage shop login

Endpoint: `POST /auth/login`

Existing request stays unchanged:

```json
{
  "role": "cashier_user",
  "username": "counter1",
  "password": "1234",
  "device_key": "browser-device-key"
}
```

When 2FA is not required, response stays the existing `TokenResponse`.

When 2FA is required, return `202 Accepted`:

```json
{
  "auth_status": "two_factor_required",
  "challenge_token": "opaque-random-token",
  "expires_in": 600,
  "factor_type": "shop_access_key",
  "user": {
    "id": 12,
    "role": "cashier_user",
    "full_name": "Counter 1"
  },
  "shop": {
    "id": 1,
    "name": "Main Shop",
    "code": "MAIN"
  }
}
```

#### First-stage superadmin login

Endpoint: `POST /auth/login/superadmin`

Existing request stays unchanged:

```json
{
  "username": "admin",
  "password": "correct-password"
}
```

When 2FA is not required, response stays the existing `TokenResponse`.

When 2FA is required, return `202 Accepted` with:

```json
{
  "auth_status": "two_factor_required",
  "challenge_token": "opaque-random-token",
  "expires_in": 600,
  "factor_type": "superadmin_access_key",
  "user": {
    "id": 1,
    "role": "superadmin",
    "full_name": "Superadmin"
  }
}
```

#### Verify 2FA

Endpoint: `POST /auth/verify-2fa`

Request:

```json
{
  "challenge_token": "opaque-random-token",
  "access_key": "123456",
  "device_key": "browser-device-key"
}
```

Response:

- `200 OK` with the existing `TokenResponse` on success.
- `400 Bad Request` for malformed access key.
- `401 Unauthorized` for wrong key.
- `403 Forbidden` for device mismatch/inactive device.
- `409 Conflict` for consumed challenge.
- `410 Gone` for expired challenge.
- `429 Too Many Requests` for over-attempted challenge.

#### Shop 2FA management

Superadmin-only endpoints:

- `GET /shops/{shop_id}/two-factor`
- `PATCH /shops/{shop_id}/two-factor`
- `POST /shops/{shop_id}/two-factor/secret`
- `POST /shops/{shop_id}/two-factor/secret/rotate`
- `POST /shops/{shop_id}/two-factor/activation-tokens`
- `GET /shops/{shop_id}/two-factor/authenticator-package`
- `GET /shops/{shop_id}/two-factor/authenticator-activations`
- `PATCH /shops/{shop_id}/two-factor/authenticator-activations/{activation_id}`

`PATCH /shops/{shop_id}/two-factor` request:

```json
{
  "two_factor_enabled": true,
  "two_factor_required_for_roles": ["owner", "cashier_user", "receiver_user"]
}
```

Response:

```json
{
  "shop_id": 1,
  "two_factor_enabled": true,
  "two_factor_secret_version": 3,
  "two_factor_rotated_at": "2026-07-27T08:00:00Z",
  "two_factor_required_for_roles": ["owner", "cashier_user", "receiver_user"],
  "has_active_secret": true
}
```

#### Superadmin personal 2FA

Authenticated current-user endpoints:

- `GET /users/me/two-factor`
- `PATCH /users/me/two-factor`
- `POST /users/me/two-factor/secret/rotate`

Disable request:

```json
{
  "two_factor_enabled": false,
  "current_password": "correct-password"
}
```

Rules:

- Only `superadmin` may use these endpoints in v1.
- Disabling requires `current_password`.
- Enabling may generate a new secret if none exists.
- Rotating requires the logged-in superadmin to be authenticated and active.

#### Customer authenticator activation

Unauthenticated endpoint used by the Windows app with a one-time activation token:

- `POST /authenticator/activate`

Request:

```json
{
  "activation_token": "one-time-token",
  "machine_label": "Front Counter PC",
  "machine_fingerprint": "client-derived-fingerprint",
  "app_version": "1.0.0"
}
```

Response:

```json
{
  "shop_name": "Main Shop",
  "shop_code": "MAIN",
  "secret_base32": "BASE32SECRET",
  "secret_version": 3,
  "step_seconds": 300
}
```

The app immediately protects `secret_base32` with Windows DPAPI before persisting it.

### Audit Events

Use `AdminLog` for security and administration events unless a dedicated auth log table is introduced later.

Event types:

- `auth.2fa.shop.enabled`
- `auth.2fa.shop.disabled`
- `auth.2fa.shop.secret_generated`
- `auth.2fa.shop.secret_rotated`
- `auth.2fa.superadmin.enabled`
- `auth.2fa.superadmin.disabled`
- `auth.2fa.superadmin.secret_rotated`
- `auth.2fa.challenge_created`
- `auth.2fa.challenge_verified`
- `auth.2fa.challenge_failed`
- `auth.2fa.challenge_expired`
- `auth.2fa.challenge_blocked_device`
- `auth.2fa.device.activated`
- `auth.2fa.device.deactivated`
- `auth.2fa.authenticator.activated`
- `auth.2fa.authenticator.deactivated`

Payload rules:

- Include actor user ID, target user ID, shop ID, role, factor type, secret version, challenge ID, failure reason, and device/activation IDs when relevant.
- Do not include passwords, PINs, raw access keys, raw challenge tokens, raw activation tokens, raw machine fingerprints, raw secrets, or secret ciphertext.

## Frontend Spec

### API Layer

Update frontend API wrappers to support union login responses:

- `TokenResponse`
- `TwoFactorChallengeResponse`

Add:

- `Api.verifyTwoFactor(...)`
- Shop 2FA management functions in the shop API module.
- Superadmin 2FA profile functions in the user API module.
- Authenticator package download helper using `responseType: "blob"`.

### Login Page

Keep the first-stage screen unchanged.

Implementation:

- Continue submitting the existing `role`, `username`, `password`, and `device_key`.
- If the response has `access_token`, call `login(...)` and navigate exactly as today.
- If the response has `auth_status: "two_factor_required"`, store the challenge in local component state and render `AccessKeyStep`.
- `AccessKeyStep` uses the same `AuthShell` visual family but replaces the form body with:
  - title text `Enter Access Key`
  - one 6-digit input
  - primary submit button
  - retry/back/logout action
  - error area
- Submit `challenge_token`, `access_key`, and the same browser `device_key`.
- On success, call `login(...)` and navigate to `homePathFor(user.role)`.
- On expired/consumed/too-many-attempts, clear the challenge and return to first-stage login.

### Superadmin Login Page

Keep the first-stage screen unchanged.

Implementation:

- Continue submitting `username` and `password`.
- If a challenge is returned, render the same `AccessKeyStep` configured for the superadmin factor.
- On success, call `login(...)` and navigate to `/admin`.

### Auth Provider

- Do not store pending challenges in `AuthProvider`.
- Store only final JWT and final user identity as today.
- No route should treat pending challenge state as authenticated.

### Shop Master

Add `Two Factor Authentication` to the Shop Master tab set.

The new panel loads:

- Shop 2FA status.
- Required roles.
- Secret version and rotation timestamp.
- Registered browser/device bindings.
- Authenticator activations.

Panel actions:

- Enable/disable shop 2FA.
- Save role requirement changes.
- Generate secret if none exists.
- Rotate secret with confirmation.
- Create/download authenticator package or activation token.
- Deactivate/reactivate browser devices.
- Deactivate/reactivate authenticator activations.

### Settings -> Security

Add a superadmin-only section:

- Current 2FA status.
- Current secret version/rotation timestamp.
- Enable button when disabled.
- Disable button when enabled.
- Current password confirmation field before disable.
- Optional rotate secret action.

Hide this section for shop-scoped users because shop 2FA is controlled from Shop Master.

## Windows Authenticator Spec

### Customer Authenticator

Create a .NET 8 WinForms project under a dedicated Windows tooling folder.

Functional behavior:

- First run activates with a one-time activation token or packaged activation payload.
- Activation fetches shop name, shop code, secret, secret version, and time-step length over HTTPS.
- Secret is immediately protected using Windows DPAPI and stored under the current Windows user profile.
- Normal run loads the protected secret and renders:
  - Shop name
  - Shop code
  - Current 6-digit access key
  - Countdown until next key
  - Secret version or support info in a non-prominent area
- Timer updates at least once per second.
- Copy-to-clipboard can be included, but the displayed code must remain visible.
- App should not require administrator rights after installation.

Local storage:

- `%LocalAppData%\NexioStock\Authenticator\activation.json`
- Protect secret material with `ProtectedData.Protect(..., DataProtectionScope.CurrentUser)`.
- Do not store raw activation token after activation.

Packaging:

- Initial acceptable package: self-contained single-file Windows publish.
- Preferred formal installer: WiX/MSI after the self-contained publish path is verified.
- Publish target: `win-x64`.
- Runtime: self-contained .NET 8.

Example publish command:

```powershell
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

### Superadmin Authenticator / Vault

Build as a separate Windows GUI app or operator mode, not bundled with the customer shop authenticator.

Requirements:

- Stores superadmin factor secrets in an encrypted local vault.
- Uses DPAPI or a password-derived key plus DPAPI-protected vault metadata.
- Displays the superadmin current key and countdown.
- Does not expose all customer shop secrets by default.
- If it supports customer package generation, require vault unlock and write audit-visible package/provisioning events through the backend.

## Security Considerations

- Do not issue an app JWT until 2FA succeeds when policy requires 2FA.
- Do not encode shop ID or user ID in the displayed 6-digit access key.
- Do not store displayed access keys.
- Do not store raw challenge tokens or activation tokens.
- Use constant-time comparison for candidate codes.
- Keep challenge TTL short.
- Rate-limit attempts per challenge.
- Bind shop-user challenges to the browser `device_key`.
- Audit all administrative policy and secret changes.
- Return support-useful errors without disclosing whether a guessed access key was close or which time window matched.
- Treat authenticator activation payloads as secrets.

## Implementation Order

1. Add backend config, models, migration, and deterministic access-key service tests.
2. Add secret generation/encryption service and challenge service.
3. Update shop and superadmin login endpoints to return token or pending-challenge responses.
4. Add `POST /auth/verify-2fa`.
5. Add shop 2FA management endpoints and audit events.
6. Add superadmin personal 2FA endpoints.
7. Update frontend API types and login pages with the access-key step.
8. Add Shop Master `Two Factor Authentication` tab.
9. Add Settings -> Security superadmin 2FA controls.
10. Add customer authenticator activation endpoints and activation-token flow.
11. Build the .NET 8 WinForms customer authenticator.
12. Add self-contained Windows publish/package script.
13. Add superadmin authenticator/vault tooling or defer it behind the agreed operational rollout plan.
14. Run backend, frontend, and Windows packaging verification.

## Testing Spec

### Backend Tests

Add focused pytest coverage:

- Access-key generation is deterministic for a fixed secret and timestamp.
- Access-key verification accepts current window.
- Previous-window grace works only inside the configured grace seconds.
- Malformed access keys fail before verification.
- Existing shop login returns normal `TokenResponse` when shop 2FA is disabled.
- Enabled shop 2FA returns pending challenge after valid credentials.
- Enabled shop 2FA blocks unregistered/inactive device.
- Valid challenge plus valid access key returns `TokenResponse`.
- Wrong key increments attempts and returns 401.
- Too many attempts returns 429.
- Expired challenge returns 410.
- Consumed challenge returns 409.
- Rotated secret invalidates outstanding challenge.
- Superadmin 2FA is required by default after provisioning.
- Superadmin can disable own 2FA with current password.
- Superadmin cannot disable 2FA without current password.
- Shop users cannot access superadmin personal 2FA endpoints.
- Audit rows are created for policy, secret, challenge, device, and activation events.

Suggested new test file:

- `tests/test_auth_2fa.py`

Existing prior-art tests:

- `tests/test_auth.py`
- `tests/test_auth_shop_staff.py`
- `tests/test_superadmin_shop_maintenance.py`

### Frontend Tests

Add Playwright coverage:

- Disabled shop 2FA follows current login smoke path.
- Enabled shop 2FA shows `Enter Access Key` after valid first-stage credentials.
- Valid access key completes login and lands on the role home page.
- Wrong key shows retryable error.
- Expired challenge returns to first-stage login.
- Superadmin 2FA challenge appears by default when provisioned.
- Shop Master includes `Two Factor Authentication` tab for superadmin.
- Shop Master can toggle 2FA controls and renders machine/device list.
- Settings security tab shows superadmin 2FA controls only to superadmin.

Suggested new e2e file:

- `frontend/e2e/auth-2fa.spec.ts`

Existing prior-art tests:

- `frontend/e2e/login.smoke.spec.ts`
- `frontend/e2e/shop-maintenance.spec.ts`
- `frontend/e2e/shop-config.spec.ts`

### Windows App Tests

- Unit-test the .NET access-key generator against backend fixed-time test vectors.
- Manual smoke-test activation on Windows 10 and Windows 11.
- Verify a clean Windows machine runs the published package without manual .NET runtime installation.
- Verify DPAPI-protected local storage cannot be copied to another Windows user profile and used directly.

### Verification Commands

Backend:

```powershell
uv run pytest tests/test_auth.py tests/test_auth_shop_staff.py tests/test_superadmin_shop_maintenance.py tests/test_auth_2fa.py
```

Frontend:

```powershell
cd frontend
npm run build
npm run e2e -- auth-2fa.spec.ts
```

Windows authenticator:

```powershell
dotnet test
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

## Deployment and Rollout

- Apply database migration with shop 2FA disabled for existing shops.
- Configure production secret-encryption key before enabling 2FA in production.
- Provision a superadmin factor before enforcing superadmin 2FA.
- Pilot on one shop and one registered browser/device.
- Confirm authenticator time sync behavior on the customer machine.
- Enable shop 2FA after the authenticator package is installed and at least one support recovery path is confirmed.
- Monitor audit logs for failed challenge spikes and clock drift symptoms.

## Backward Compatibility

- First-stage request payloads remain unchanged.
- Token response shape remains unchanged when 2FA is not required.
- Existing protected routes continue to accept the same JWT claims.
- Existing browser sessions are not invalidated by this implementation unless a separate session revocation feature is added.
- Existing device-binding data is reused for browser/device enforcement.

## Open Implementation Questions

- Confirm final product naming across web app, installer, executable, and local storage folder.
- Decide whether v1 ships as self-contained EXE only or formal MSI as well.
- Decide whether customer activation must work without internet after installation.
- Decide whether role-specific shop 2FA policy is exposed in v1 or hardcoded to all shop roles while storing the field for future use.
- Define the recovery procedure for a lost superadmin authenticator before production enforcement.
- Decide whether authenticator activation should include optional heartbeat/last-seen updates or remain activation-only.
