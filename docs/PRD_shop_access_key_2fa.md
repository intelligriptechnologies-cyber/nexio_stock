# PRD: Shop Access Key 2FA

## Document Control

| Field | Value |
|---|---|
| Status | Draft |
| Last updated | 2026-07-27 |
| Source BRD | `docs/BRD_shop_access_key_2fa.md` |
| Implementation spec | `docs/implementation_spec_shop_access_key_2fa.md` |
| Product surface | Nexio Stock / Barstock web app, shop administration, Windows authenticator |

## Problem Statement

Nexio Stock currently relies on username/PIN or superadmin username/password login to enter sensitive inventory, checkout, receiving, and shop maintenance workflows. That protects against casual misuse, but it does not protect well against a shared PIN, a guessed PIN, or an unattended browser profile on a shop machine.

The product needs a second verification step that is practical for liquor-shop counter operations. Staff should not have to learn a complex authenticator product or change the first login screen. A superadmin should be able to turn the protection on per shop, provide the shop with a small Windows authenticator app, and require staff to enter the current 6-digit shop access key after their normal credentials succeed.

The superadmin account is the highest-privilege account in the system and should require its own access key by default. That requirement can be disabled only by the superadmin from their own profile settings after confirming their password.

## Goals

- Keep the existing first login screen and credential flow visually and behaviorally unchanged.
- Add a second-factor access-key verification step after successful first-stage login when policy requires it.
- Let a superadmin enable, disable, rotate, and monitor shop-level 2FA from Shop Master.
- Require owner, cashier, and receiver users to complete shop access-key verification when their shop has 2FA enabled.
- Require superadmin access-key verification by default.
- Let a superadmin disable or re-enable only their own 2FA setting from profile security settings.
- Provide a small Windows GUI authenticator that displays the shop name/code, current 6-digit key, and countdown.
- Package the Windows authenticator so customers do not manually install the .NET runtime.
- Enforce registered browser/device access for shop users when shop-level 2FA is enabled.
- Record security-relevant 2FA events in the product audit trail without storing displayed access keys.

## Success Metrics

- Existing shop login succeeds exactly as it does today when shop 2FA is disabled.
- Existing superadmin login still uses the same first-stage username/password screen.
- For a 2FA-enabled shop, 100% of owner/cashier/receiver app entry requires a valid current shop access key before the final JWT is issued.
- For a superadmin with 2FA enabled, 100% of app entry requires a valid current superadmin access key before the final JWT is issued.
- Wrong, malformed, expired, reused-challenge, or over-attempted verification requests do not issue a JWT.
- An unregistered or inactive browser/device cannot complete shop-user login when shop 2FA is enabled.
- The authenticator runs on a clean Windows 10/11 machine without requiring a separate .NET install.
- 2FA enable/disable, secret rotation, challenge verification, failure, expiry, and device activation events are audit-visible.

## Personas

| Persona | Needs |
|---|---|
| Superadmin | Configure shop-level 2FA, rotate secrets, download/provision authenticator packages, manage registered machines, and keep cross-shop access protected. |
| Shop owner | Sign in with the same first-stage login, complete access-key verification when required, and keep normal owner workflows unchanged after login. |
| Cashier | Sign in quickly at the counter, enter a 6-digit access key only when required, and recover clearly from wrong or expired keys. |
| Receiver | Sign in quickly for stock receiving, enter the shop access key only when required, and continue the receiving flow unchanged after login. |
| Support/operator | Provision or replace customer machines, recover from clock drift or reinstall issues, and review audit history. |

## Solution

Login becomes a two-stage authentication flow without changing the first screen:

1. The user submits the existing credentials.
2. The backend authenticates those credentials exactly as it does today.
3. The backend resolves whether 2FA is required for that user.
4. If 2FA is not required, the backend returns the normal JWT response.
5. If 2FA is required, the backend returns a short-lived pending authentication challenge instead of a JWT.
6. The frontend shows a simple "Enter Access Key" screen with one 6-digit input.
7. The user enters the current key from the Windows authenticator.
8. The backend verifies the submitted key against the relevant shop or superadmin secret using server time.
9. On success, the backend consumes the challenge and returns the normal JWT response.

The shop access key is not a code that embeds the shop ID. The backend already knows which shop is involved from the authenticated first-stage user and pending challenge, then independently recalculates the valid code for that shop's current secret and time window.

## User Stories

1. As a cashier, I want the normal login screen to stay the same, so that I do not have to relearn the first step of signing in.
2. As a receiver, I want the normal login screen to stay the same, so that stock receiving remains quick at the start of a shift.
3. As an owner, I want the normal login screen to stay the same, so that introducing 2FA does not disrupt existing shop habits.
4. As a shop user, I want to see an access-key screen only after my normal credentials are accepted, so that I know the PIN/password step succeeded.
5. As a shop user, I want to enter one 6-digit access key, so that the second step is fast enough for shop-floor use.
6. As a shop user, I want a clear wrong-key message, so that I can retry without guessing what failed.
7. As a shop user, I want a clear expired-key message, so that I know to wait for or enter the latest authenticator key.
8. As a shop user, I want a back/logout action from the access-key screen, so that I can restart login if I chose the wrong user or role.
9. As a shop user, I want my checkout, receiving, dashboard, and settings access to behave normally after 2FA succeeds, so that 2FA only affects entry into the app.
10. As a superadmin, I want my own login to require an access key by default, so that the highest-privilege account is protected even before shop policies are configured.
11. As a superadmin, I want to disable my own 2FA only after confirming my password, so that a casual click cannot weaken my account.
12. As a superadmin, I want no other user to disable my 2FA, so that the superadmin control boundary remains personal.
13. As a superadmin, I want to enable or disable shop-level 2FA from Shop Master, so that I can control rollout shop by shop.
14. As a superadmin, I want to rotate a shop's access-key secret, so that a leaked or old authenticator can be invalidated.
15. As a superadmin, I want to choose which shop roles require 2FA, so that the default can protect all shop roles while still allowing future policy flexibility.
16. As a superadmin, I want to download/provision the customer authenticator package for a shop, so that installation is repeatable for support.
17. As a superadmin, I want to see registered machines, so that I know which terminals are allowed to complete 2FA-protected login.
18. As a superadmin, I want to deactivate or reactivate a registered machine, so that lost, replaced, or suspicious machines can be controlled.
19. As a support operator, I want machine recovery to be simple, so that replacing a shop computer does not block store operations for long.
20. As a customer, I want the authenticator to be a small Windows GUI app, so that staff are not asked to use a command prompt.
21. As a customer, I want the authenticator to show the shop name and code, so that staff can tell which shop key they are reading.
22. As a customer, I want the authenticator to show a countdown, so that staff do not enter a key that is about to expire.
23. As a customer, I want the authenticator installer/package to include the runtime it needs, so that I do not manually install .NET.
24. As a support operator, I want the backend to verify keys independently, so that displayed codes are never stored as product data.
25. As a support operator, I want failed and successful 2FA events logged, so that login problems and suspicious attempts can be investigated.
26. As a security reviewer, I want access keys not to encode shop identity, so that the 6 digits are only a verifier and not a source of sensitive metadata.
27. As a security reviewer, I want browser/device registration enforced when shop 2FA is enabled, so that a shared 5-minute key alone is not enough from an arbitrary browser.
28. As a shop owner, I want shop 2FA disabled to preserve the current login behavior, so that rollout can happen when the shop is ready.
29. As a superadmin, I want existing active sessions to remain valid until their normal expiry unless a separate session-revocation policy is introduced, so that enabling 2FA does not unexpectedly interrupt live counter work.
30. As a developer, I want the login API to return either the existing token response or an explicit pending-2FA challenge, so that old behavior is preserved for shops where 2FA is off.

## Functional Requirements

### Login and Verification

- **FR-1**: The first-stage shop login screen fields, labels, role selection, credential submission behavior, and validation remain unchanged.
- **FR-2**: The first-stage superadmin login screen fields and credential submission behavior remain unchanged.
- **FR-3**: First-stage credential authentication continues to reject invalid credentials with the current invalid-login behavior.
- **FR-4**: After valid first-stage credentials, the backend determines whether 2FA is required before issuing any final app JWT.
- **FR-5**: If 2FA is not required, login returns the same token response shape currently used by the app.
- **FR-6**: If 2FA is required, login returns a pending challenge response and does not return a JWT.
- **FR-7**: A pending challenge expires after a short server-controlled TTL.
- **FR-8**: A pending challenge can be consumed only once.
- **FR-9**: A pending challenge is bound to the authenticated first-stage user and relevant shop or superadmin factor.
- **FR-10**: Access-key verification accepts only a 6-digit numeric code.
- **FR-11**: Access-key verification issues the normal JWT only after the submitted code matches the backend-calculated code for the challenge factor.
- **FR-12**: Wrong, malformed, expired, consumed, or over-attempted challenges do not issue a JWT.
- **FR-13**: Failed access-key attempts are limited per challenge.
- **FR-14**: Final JWT claims remain compatible with existing authorization behavior.

### Shop 2FA Policy

- **FR-15**: Each shop has a 2FA enabled/disabled setting.
- **FR-16**: Shop 2FA defaults to disabled for existing shops during migration.
- **FR-17**: When shop 2FA is disabled, owner/cashier/receiver login follows the current flow.
- **FR-18**: When shop 2FA is enabled, owner/cashier/receiver users require access-key verification by default.
- **FR-19**: Shop 2FA policy stores which shop roles require the second factor.
- **FR-20**: Only superadmin can enable, disable, or rotate shop 2FA secrets.
- **FR-21**: Rotating a shop secret invalidates newly generated codes from old shop authenticators.
- **FR-22**: Rotating a shop secret invalidates outstanding pending challenges for that shop.

### Superadmin 2FA Policy

- **FR-23**: Superadmin 2FA is enabled by default for superadmin users.
- **FR-24**: Superadmin 2FA uses a superadmin-specific secret, not a shop secret.
- **FR-25**: A superadmin can disable only their own 2FA setting.
- **FR-26**: Disabling superadmin 2FA requires current password confirmation.
- **FR-27**: A superadmin can re-enable their own 2FA setting.
- **FR-28**: Superadmin 2FA preference changes are audited.

### Device and Machine Control

- **FR-29**: When shop 2FA is enabled for a shop role, the browser/device used for shop login must be actively registered to that shop.
- **FR-30**: Unregistered or inactive browser/device login is blocked before final JWT issuance.
- **FR-31**: Superadmin can list registered machines/devices for a shop.
- **FR-32**: Superadmin can deactivate and reactivate registered machines/devices for a shop.
- **FR-33**: Device registration changes are audited.

### Shop Master UX

- **FR-34**: Shop Master includes a new `Two Factor Authentication` tab.
- **FR-35**: The tab shows current shop 2FA status and required roles.
- **FR-36**: The tab allows superadmin to enable or disable shop 2FA.
- **FR-37**: The tab allows superadmin to generate or rotate the shop secret.
- **FR-38**: The tab allows superadmin to download or provision the customer authenticator package.
- **FR-39**: The tab shows registered machine/device status and actions.

### Superadmin Profile UX

- **FR-40**: The Settings security/profile area shows superadmin 2FA status for the logged-in superadmin.
- **FR-41**: The superadmin can disable 2FA from their own profile only after entering their current password.
- **FR-42**: The superadmin can re-enable 2FA from their own profile.
- **FR-43**: Shop owner/cashier/receiver users do not get controls to disable shop-level 2FA for themselves.

### Windows Authenticator

- **FR-44**: The customer authenticator is a Windows GUI application.
- **FR-45**: The customer authenticator displays shop name, shop code, current 6-digit access key, and countdown.
- **FR-46**: The authenticator uses the same secret, time window, and HMAC algorithm as the backend verifier.
- **FR-47**: The authenticator protects local activation/secret material using Windows DPAPI.
- **FR-48**: The authenticator is packaged as a self-contained Windows executable or installer that does not require a separate .NET runtime installation.
- **FR-49**: The authenticator supports Windows 10 and Windows 11.

### Audit and Support

- **FR-50**: The system logs 2FA enabled, disabled, generated, rotated, challenge created, challenge verified, challenge failed, challenge expired, device activated, device deactivated, and superadmin 2FA preference events.
- **FR-51**: Audit logs never include raw access keys or raw secrets.
- **FR-52**: Error messages distinguish wrong/expired key, expired challenge, and unregistered device well enough for support without leaking sensitive secret details.

## Non-Functional Requirements

- **Security**: Secrets are generated with cryptographically secure randomness and stored encrypted at rest. Challenge tokens are stored only as hashes. Access-key comparison uses constant-time comparison.
- **Usability**: The second-factor step must be short, keyboard-friendly, and readable on shop terminal screens.
- **Reliability**: Login and verification should remain available as long as the backend and database are available. The authenticator should continue generating keys locally after activation.
- **Performance**: 2FA policy checks and code verification must add negligible latency to login; target p95 additional backend processing below 100 ms excluding database/network time.
- **Compatibility**: Authenticator packaging supports Windows 10/11 x64. The web app continues to support current supported browsers.
- **Privacy**: Audit payloads store operational metadata only, not raw PINs, passwords, access keys, or secrets.
- **Maintainability**: The TOTP-style algorithm lives in one backend service module with deterministic tests, and the .NET app uses equivalent well-documented logic.

## UX Requirements

### First-Stage Login

- No visible first-screen field changes.
- No extra text is added to the existing first screen.
- Existing invalid-credential messaging remains stable.

### Access-Key Step

- Title: `Enter Access Key`.
- One input for a 6-digit numeric access key.
- Supports paste of a 6-digit code.
- Auto-focuses the access-key input.
- Submits when 6 digits are entered or when the user presses the primary action.
- Shows clear errors for wrong key, expired key/challenge, too many attempts, and unregistered device.
- Provides retry without restarting credential login when the challenge remains valid.
- Provides back/logout to discard the pending challenge and return to the first login screen.

### Shop Master Two Factor Authentication Tab

- Shows shop name/code and current 2FA status.
- Shows whether a secret exists, its version, and rotation timestamp.
- Provides enable/disable control.
- Provides role requirement controls, defaulting to owner, cashier, and receiver.
- Provides generate/rotate secret action with a confirmation prompt.
- Provides customer authenticator package download/provision action.
- Provides registered machine/device list with status, label, creation date, last update, deactivate, and reactivate actions.

### Superadmin Security Settings

- Shows current superadmin 2FA status.
- Shows enable action when disabled.
- Shows disable action when enabled.
- Requires current password before disabling.
- Warns that disabling superadmin 2FA weakens highest-privilege access.

## Rollout and Migration

- Existing shops migrate with shop 2FA disabled.
- Existing shop users continue to log in normally until a superadmin enables shop 2FA.
- Existing superadmin users migrate with superadmin 2FA enabled by default, but rollout may require a one-time bootstrap/provisioning step before enforcement can be activated in production.
- Existing JWT validation and protected routes remain unchanged.
- Existing live sessions are not force-revoked by enabling shop 2FA unless a later session-revocation feature is explicitly added.
- Rollout should start with one pilot shop and one test superadmin before broad activation.

## Acceptance Criteria

- Existing disabled-shop login tests pass without modification to first-stage behavior.
- Enabling shop 2FA causes valid credentials to return a pending challenge instead of a JWT.
- Submitting the correct current access key for that challenge returns the normal JWT response.
- Submitting an incorrect, malformed, expired, consumed, or over-attempted challenge fails.
- Disabling shop 2FA restores current shop login behavior.
- Rotating a shop secret makes old authenticator keys fail for new challenges.
- Superadmin login requires access-key verification by default once the superadmin factor is provisioned.
- Superadmin can disable their own 2FA only with current password confirmation.
- Shop users cannot disable shop-level 2FA for themselves.
- A shop user on an unregistered or inactive browser/device cannot complete login when shop 2FA is enabled.
- Shop Master shows and controls shop 2FA state, secret rotation, authenticator package provisioning, and machines/devices.
- The Windows authenticator displays shop identity, a 6-digit key, and a live countdown.
- The Windows authenticator runs on a clean Windows 10/11 machine without a manual .NET install.
- Security audit logs are written without raw secrets or raw access keys.

## Out of Scope

- Changing the first-stage login screen design, fields, or primary credential type.
- Replacing PIN/password login with passkeys, SMS OTP, email OTP, biometrics, or a third-party authenticator app.
- Building payment, receiving, checkout, dashboard, or product-flow changes beyond preserving post-login access.
- Encoding shop IDs or user IDs inside the displayed 6-digit access key.
- Storing displayed access keys in the backend.
- Building a mobile authenticator app.
- Full enterprise identity management, SSO, or tenant-wide policy administration.
- Automatic revocation of already-issued JWTs after policy changes.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| A 5-minute shop code can be verbally shared. | Enforce registered browser/device checks when shop 2FA is enabled; keep audit logs for failures and device changes. |
| Customer authenticator package leaks. | Prefer one-time activation and DPAPI-protected local storage over raw secrets embedded directly in a reusable installer. Rotate shop secret if compromise is suspected. |
| Clock drift causes valid-looking keys to fail. | Require Windows automatic time sync, show countdown in the app, include support guidance in error handling, and audit matched/failed time-window offsets without logging codes. |
| Superadmin disables 2FA casually. | Restrict disable action to the logged-in superadmin and require current password confirmation. |
| Secret rotation locks out a shop unexpectedly. | Confirm rotation, show active secret version, invalidate outstanding challenges, and provide support recovery flow. |
| Reinstalled/replaced machines block operations. | Provide machine registration/reactivation and authenticator reactivation from Shop Master. |
| Implementation changes the login contract too broadly. | Preserve the exact token response when 2FA is not required; add a typed pending-challenge response only when required. |

## Open Questions

- Should the customer-facing product name be standardized as `Nexio Stock`, `Barstock`, or a migration-safe hybrid across the web app and authenticator?
- Should the first supported package be a self-contained EXE, an MSI, or both?
- Should customer authenticator activation be online one-time activation, preconfigured per-shop packages, or both for low-connectivity support cases?
- Should shop role requirements remain configurable in v1, or should v1 hard-require all shop roles whenever shop 2FA is enabled?
- What is the operational recovery process if the only superadmin authenticator is lost?

## Further Notes

This PRD intentionally defines behavior, scope, and acceptance criteria. The implementation details, API shapes, database schema, and test seams are specified separately in `docs/implementation_spec_shop_access_key_2fa.md`.
