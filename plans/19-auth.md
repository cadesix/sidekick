# 19 — Auth: Apple, Google, Email, SMS (ported from invoice + scaleshot)

## Goal

Port the auth system from `~/Code/invoice` into sidekick, minus the team/org
code, and add SMS auth from `~/Code/scaleshot` (invoice has no SMS — only dead
scaffolding). Add a dev-login equivalent. Nothing in sidekick is in prod, so we
can restructure freely — no back-compat required.

**No anonymous accounts and no account merging.** Sidekick's current
anonymous-device model is removed: the app is gated behind a real sign-in
screen at launch. A provider identity either matches an existing user (sign
them in) or creates a new one (send them through the existing onboarding
funnel). This deletes invoice's merge engine entirely.

Both source repos use the exact same stack as sidekick (tRPC v11 + Drizzle +
Postgres + Expo), and both are hand-rolled (no better-auth/clerk/lucia), so
this is a faithful port, not a rewrite.

## Source systems (what we're porting)

### invoice (`~/Code/invoice`) — the primary source

- **Sessions**: opaque tokens `co_au_<128 random base64url bytes>` (ambiguous
  chars substituted), only the SHA-256 hash stored in `authSessions`. 30-day
  sliding expiry (every authed request "touches" `expiresAt`). Logout
  soft-deletes the session row. No JWT, no signing secret needed.
  - `packages/api/src/services/auth/index.ts` — `createAuthToken`,
    `createSession`, `hashSha256`, `getSessionFromAuthHeader`.
- **Apple**: client sends an identity token; server verifies via
  `apple-signin-auth` `verifyIdToken` with platform-specific audience
  (bundle id on iOS, Services ID on web).
  - `packages/api/src/services/auth/apple.ts`
- **Google**: client sends an `id_token`; server verifies via
  `https://oauth2.googleapis.com/tokeninfo`, checking `iss` + `aud` against a
  list of accepted client IDs.
  - `packages/api/src/services/auth/google.ts`
- **Email**: 6-digit OTP (not magic link, not password).
  `crypto.randomInt(100000, 999999)`, SHA-256 hash stored in
  `emailVerificationCodes` with 10-min expiry; prior codes invalidated on
  re-request; verify consumes atomically via conditional
  `UPDATE … RETURNING` with `attempts < 5`. Sent via Resend
  (`otp-code.tsx` react-email template). In dev without `RESEND_API_KEY`, the
  code is logged to the server console instead.
- **Account model**: `accounts` table maps `(provider, providerAccountId)` →
  `userId`. (Invoice wraps this in an anonymous-merge engine — we port only
  the find-or-create core; see "Key decisions".)
- **Rate limits**: email code request 3/email/15min + 10/IP/hr; verify
  20/IP/hr. In-memory.
- **Dev login**: `devAuth.login` public mutation, throws unless
  `NODE_ENV === "development"`; finds/creates `dev@test.local` with seeded
  data and returns a session. Client button rendered only in dev builds.
  Double-gated (client build flag + server env check).
- **Expo client**: `packages/expo/src/hooks/auth.tsx` (SecureStore
  persistence, bootstrap), `auth-providers.tsx` (`useAppleAuth` via
  `expo-apple-authentication`, `useGoogleAuth` via
  `expo-auth-session/providers/google` id-token flow, `useEmailAuth`
  two-step), `auth-bottom-sheet.tsx` (UI reference), `auth-error-handler.ts`
  (after 3 consecutive UNAUTHORIZED responses, clear stored auth and prompt
  re-auth).

### scaleshot (`~/Code/scaleshot`) — SMS only

- **Twilio Verify** does everything: generates the code, sends the SMS,
  tracks attempts, validates. **No OTP table, no code generation, no hashing
  on our side.** (`packages/backend/src/services/auth/sms.ts`, ~40 lines):
  - `sendPhoneCode(phone)` → `client.verify.v2.services(sid).verifications.create({to, channel: "sms"})`
  - `verifyPhoneCode(phone, code)` → `verificationChecks.create({to, code})`,
    throw unless `status === "approved"`.
- `users.phone` is a plain unique text column (E.164). No verified-at column.
- Rate limits: 3 code requests/hour per phone (plus Twilio's own limits).
- Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`.
- No dev bypass for SMS exists — dev login covers local dev instead.

## Sidekick today (what changes)

- Identity = anonymous device bearer token: `devices.token` unique column,
  minted once by `auth.register`, looked up by `resolveUserId` in
  `packages/server/src/context.ts`. No sessions, no login UI. **All of this
  goes away.**
- `users` already has nullable `email` + `passwordHash` columns (unused).
- Client: `packages/expo/src/lib/auth.tsx` `AuthGate` silently registers the
  device and stores `sidekick.deviceId` / `sidekick.token`;
  `packages/expo/src/lib/api.ts` sends `Authorization: Bearer <token>` +
  `x-sidekick-device-id`. The header plumbing stays; the silent registration
  becomes a sign-in screen.
- Onboarding: the server exposes `users.me.onboardingComplete`, but the Expo
  app has **no onboarding funnel gate** (the funnel only exists in the
  deprecated `packages/web`) — every signed-in user lands on Home. That was
  already true for anonymous users before this change; wiring the funnel into
  expo is a separate workstream, out of scope here. E2E confirmed: fresh
  email signups land on Home with a blank profile.

## Key decisions

1. **Signed-in only; sessions are the sole credential.** No anonymous users.
   `auth.register` (silent device bootstrap) is deleted. The app renders a
   sign-in screen until a session token exists. Sessions are minted only by
   the provider mutations (`authenticateWith*`, `verify*Code`) and dev login.
2. **No merging, ever.** `findOrCreateUserForProvider` is a plain
   find-or-create: `(provider, providerAccountId)` exists → session for that
   user; otherwise create user + account row (+ notification preferences,
   like today's registration does) and return `isNewUser: true`. Invoice's
   `mergeAnonymousUserInto`, `users.deletedAt`, and device/push-token
   repointing are all dropped.
3. **`devices` becomes post-auth metadata.** Drop `devices.token`. Keep the
   table — `notifications/register.ts` resolves push tokens through
   `(userId, deviceId)`. A new **protected** `auth.registerDevice` mutation
   upserts the row on `deviceId` and repoints `userId` to the caller (one
   physical device can sign into different accounts over time). The client
   calls it once per launch when signed in.
4. **Bearer-only, no cookies.** Invoice's web client uses an HttpOnly cookie;
   sidekick's Expo Web client already uses bearer + localStorage through the
   single shared `api.ts`, and the server is CORS-permissive with no cookie
   handling. Keeping bearer everywhere means zero platform forking in the
   client and we skip invoice's cookie helpers entirely.
5. **No passwords.** Email = OTP. Drop the unused `users.passwordHash` column.
6. **No teams.** Skip `teams`, `teamMemberships`, `teamInvites`, `apiKeys`,
   `teamProcedure`, `x-team-id` parsing, and invoice's
   `entitledProcedure`/`isWeb` billing coupling.
7. **SMS via Twilio Verify** (scaleshot's approach), wired into
   find-or-create as `provider: "phone"`, `providerAccountId: <E.164 phone>`.
   No `smsCodes` table (invoice's is dead scaffolding; scaleshot proves
   Twilio Verify needs none).
8. **Google id-token flow on all platforms.** `expo-auth-session`'s Google
   provider produces an `id_token` on both iOS and web (with per-platform
   client IDs). The server accepts a list of audiences. This drops invoice's
   separate web auth-code flow + `GOOGLE_CLIENT_SECRET` exchange — one client
   code path, one server mutation.
9. **Apple: iOS first, web later.** `expo-apple-authentication` is iOS-only.
   On web the Apple button is hidden in v1 (App Store's "must offer Sign in
   with Apple" rule applies to iOS, which we cover). The server verifier
   already accepts a Services-ID audience, so adding Apple JS on web later is
   client-only work.
10. **Token prefix** `sk_au_` instead of `co_au_`. Same generation code.

## DB schema changes (`packages/db/src/schema.ts`)

New tables (ported from invoice's schema, teams omitted):

```
authSessions
  id            uuid pk default random
  userId        uuid fk → users.id, not null
  hashedToken   text unique not null        -- sha256 of the raw token
  expiresAt     timestamp not null          -- sliding 30d
  deletedAt     timestamp                   -- soft delete on logout
  createdAt     timestamp default now

accounts
  id                 uuid pk
  userId             uuid fk → users.id, not null
  provider           text not null          -- 'apple' | 'google' | 'email' | 'phone'
  providerAccountId  text not null          -- apple sub / google sub / email / E.164 phone
  createdAt          timestamp default now
  unique(provider, providerAccountId)

emailVerificationCodes
  id          uuid pk
  email       text not null
  hashedCode  text not null                 -- sha256 of 6-digit code
  expiresAt   timestamp not null            -- 10 min
  attempts    integer not null default 0    -- consumed atomically, max 5
  consumedAt  timestamp
  invalidatedAt timestamp                   -- set on newer code request
  createdAt   timestamp default now
```

`users` changes:
- add `phone text unique` (nullable, E.164)
- add `emailVerified timestamp` (nullable) — set when email OTP verifies
- drop `passwordHash`

`devices` changes:
- drop `token` (sessions are the credential now)

Migration: `pnpm db:generate` → new `0001_*` migration on top of the fresh
baseline. Update `packages/db/src/testing.ts` if the PGlite test schema needs
anything beyond the schema import.

## Server changes (`packages/server`)

New directory `packages/server/src/auth/` (replaces the single `auth.ts`):

- **`sessions.ts`** — port of invoice `services/auth/index.ts`, minus cookie
  helpers: `createAuthToken` (`sk_au_` + 128 random base64url bytes with
  ambiguous-char substitution), `hashSha256`, `createSession(userId)`,
  `getSessionFromAuthHeader(db, authorization, {touch})` with sliding 30-day
  expiry, `revokeSession`.
- **`apple.ts`** — port of invoice `services/auth/apple.ts`:
  `verifyAppleToken(identityToken, platform)` via `apple-signin-auth`;
  audience = `APP_BUNDLE_IDENTIFIER` (ios) / `APPLE_SERVICES_ID` (web).
- **`google.ts`** — port of invoice `services/auth/google.ts`:
  `verifyGoogleIdToken(idToken)` against the tokeninfo endpoint; accepted
  audiences = `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_WEB_CLIENT_ID`.
- **`email.ts`** — port of invoice's `requestEmailCode`/`verifyEmailCode`
  service logic: generate/hash/store code, invalidate prior codes, atomic
  consume. Sends via Resend using a ported `otp-code` template (bring the
  template as a simple HTML-string renderer inside the server — sidekick has
  no emails package and one template doesn't justify creating one). Dev
  behavior preserved: no `RESEND_API_KEY` → log the code to the console.
- **`sms.ts`** — port of scaleshot `services/auth/sms.ts` verbatim:
  `sendPhoneCode`, `verifyPhoneCode` via Twilio Verify, lazily-cached client.
- **`provider-user.ts`** — `findOrCreateUserForProvider(db, identity)`:
  look up `accounts` by `(provider, providerAccountId)`; hit → return that
  user; miss → insert `users` row (email/phone/emailVerified from the
  identity) + `accounts` row + `notificationPreferences` row, return
  `isNewUser: true`. No merge, no soft delete.
- **`register-device.ts`** — protected device-metadata upsert: insert
  `(userId, deviceId, publicKey)` on conflict of `deviceId` update `userId`
  (+ `lastSeenAt`). Replaces today's `registerDevice`.
- **`dev-login.ts`** — see "Dev login" below.
- **`rate-limit.ts`** — port invoice's limiter setup (in-memory; fine for
  now, single-instance dev and low-traffic Vercel — note: per-instance on
  serverless, and Twilio Verify enforces its own limits for SMS regardless).

Router (`packages/server/src/routers/auth.ts`) becomes:

```
auth.authenticateWithApple     (public)  — { identityToken, platform } → session
auth.authenticateWithGoogle    (public)  — { idToken } → session
auth.requestEmailCode          (public)  — { email }
auth.verifyEmailCode           (public)  — { email, code } → session
auth.requestPhoneCode          (public)  — { phone }
auth.verifyPhoneCode           (public)  — { phone, code } → session
auth.registerDevice            (protected) — { deviceId, publicKey? }
auth.logout                    (protected) — revoke current session
auth.devLogin                  (public, dev-only)
```

All `authenticateWith*` / `verify*Code` mutations return
`{ token, userId, isNewUser }`.

`context.ts`: replace `resolveUserId` (devices lookup) with
`getSessionFromAuthHeader`. Everything downstream (`protectedProcedure`, the
manual 401 checks in `/chat/stream`, `/chat/continue`, `/blob/*`,
`/music/developer-token`) keeps working untouched since they only read
`ctx.userId`.

Input schemas go in `packages/shared/app/src/schemas.ts`, replacing
`registerInput` (email as `z.string().email()`, phone as E.164 regex, code as
6-digit string, registerDevice input).

New server deps: `apple-signin-auth`, `resend`, `twilio`. (`jose` already
present but not needed — apple-signin-auth handles JWKS itself.)

## Expo client changes (`packages/expo`)

New deps: `expo-apple-authentication` (+ its config plugin in
`app.config.js`), `expo-auth-session`.

- **`src/lib/auth.tsx`** — rewritten. `AuthGate` now:
  - loads `sidekick.token` + `sidekick.deviceId` from storage (deviceId still
    generated/persisted on first launch — it identifies the installation for
    push tokens);
  - token present → `setAuthToken`, call `auth.registerDevice`
    (fire-and-forget), render the app;
  - no token → render the **SignInScreen** (full screen, replaces the old
    silent bootstrap);
  - exposes `applyAuthResult({ token, userId })` — persist token,
    `setAuthToken`, register device, clear react-query cache, flip to
    signed-in (new users land in the onboarding funnel automatically via
    `users.me`);
  - exposes `signOut()` — best-effort `auth.logout`, clear stored token,
    clear caches, flip to signed-out.
  - State lives in a tiny zustand store (repo idiom) — no useEffect
    orchestration.
- **`src/lib/auth-providers.tsx`** — port of invoice's `auth-providers.tsx`:
  - `useAppleAuth()` — `expo-apple-authentication` `signInAsync` →
    `auth.authenticateWithApple` (`platform: "ios"`). Not rendered on web
    (v1).
  - `useGoogleAuth()` — `expo-auth-session/providers/google`
    `useIdTokenAuthRequest` with `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` /
    `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` → `auth.authenticateWithGoogle`.
  - `useEmailAuth()` — two-step request/verify.
  - `usePhoneAuth()` — two-step request/verify (new, mirrors email).
- **`src/components/SignInScreen.tsx`** — full-screen sign-in UI (the app's
  front door, not a sheet), modeled on invoice's `auth-bottom-sheet.tsx` +
  scaleshot's two-step `AuthForm`: provider buttons (Apple — native only,
  Google) up top, email/phone entry with a method toggle below, then a
  6-digit code step that auto-submits on the 6th digit. Matches the app's
  existing visual language (white bg, Diatype Rounded, `PrimaryButton`).
  Phone input: RN `TextInput` with `keyboardType="phone-pad"` + a minimal
  E.164 formatter (skip react-phone-number-input; it's DOM-only). "Dev
  login" button at the bottom when `__DEV__`.
- **`app/settings.tsx`** — account section: show `users.me` email/phone +
  "Sign out" (`users.me` gains `email`/`phone` fields).
- **`src/lib/api.ts`** — add an `onUnauthorized` hook to the tRPC link chain,
  port of invoice's `auth-error-handler.ts`: 3 consecutive UNAUTHORIZED →
  `signOut()` locally (clear token, back to SignInScreen). Covers
  revoked/expired sessions. Remove the exported `registerDevice` bootstrap
  helper.

## Dev login

Port of invoice's `devAuth.login`, adapted:

- **Server** (`packages/server/src/auth/dev-login.ts`): public mutation
  `auth.devLogin`, first line throws unless
  `process.env.NODE_ENV === "development"` (fail-closed: unset → rejected).
  The server `dev` script gains an explicit `NODE_ENV=development` since
  nothing sets it today. Finds/creates the
  `dev@test.local` user via the email `accounts` row; on first creation seeds
  a usable profile — name, sidekick name/color, timezone,
  `onboardingCompletedAt`, some sparks, notification preferences — so the app
  skips the onboarding funnel and lands on the home screen. Returns a session
  like every other auth mutation.
- **Client**: a "Dev login" button on the SignInScreen, rendered only when
  `__DEV__`. Double-gated like invoice (client build flag + server env
  check), so it's compiled out of release builds and rejected by prod
  servers even if called manually.

There's intentionally **no fixed SMS/email OTP bypass** (matching both source
repos): email OTP already logs the code in dev when Resend isn't configured,
and dev login covers "get me a signed-in user instantly".

## Env vars

Server (`packages/server/.env.example` additions):

```
# Apple sign-in
APP_BUNDLE_IDENTIFIER=        # iOS audience (from app.config.js bundle id)
APPLE_SERVICES_ID=            # web audience (unused until Apple-on-web)

# Google sign-in
GOOGLE_IOS_CLIENT_ID=
GOOGLE_WEB_CLIENT_ID=

# Email OTP (unset in dev → codes logged to console)
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# SMS OTP (Twilio Verify)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
```

Expo (`packages/expo/.env.example` additions):

```
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
```

External provisioning (one-time, outside the repo):
- Apple: enable Sign in with Apple on the app ID; create a Services ID
  (for web, later).
- Google Cloud: OAuth client IDs (iOS + Web).
- Resend: API key + verified sending domain.
- Twilio: account + a Verify service (its SID is the env var).

## Implementation order

All phases get implemented; order exists for a working system at each step.

1. **Sessions core + schema** — schema (all tables + users/devices changes),
   migration, `sessions.ts`, `register-device.ts`, `context.ts` swap,
   `auth.logout`, delete old `auth.ts`/`auth.register`.
2. **Providers, server side** — `provider-user.ts`, `apple.ts`, `google.ts`,
   `email.ts`, `sms.ts`, rate limits, all router mutations, dev login,
   `users.me` gains `email`/`phone`.
3. **Client** — `auth.tsx` rewrite, `auth-providers.tsx`, `SignInScreen`,
   settings account section, `signOut`/`applyAuthResult`, 401 handler, dev
   login button.
4. **Provisioning + verification** — real Apple/Google/Resend/Twilio config,
   end-to-end pass against the local server.

## Testing

- **Vitest + PGlite (existing harness)** — the high-value, mock-free tests:
  session lifecycle (create → resolve → sliding touch → logout → 401),
  email-OTP semantics (expiry, prior-code invalidation, atomic consume,
  attempt cap), find-or-create (existing identity signs in / new identity
  creates user + account + notification prefs), `registerDevice` upsert
  (same deviceId re-registered by another user repoints the row), dev-login
  env gating. Email sending and Twilio go through the existing
  `createServices` seam so tests inject a capturing sender rather than
  mocking modules.
- **Apple/Google verifiers** — thin wrappers around external services; not
  unit-tested (nothing of ours to test without mocking the provider).
- **Playwright (Expo Web + local server)** — automated e2e: app boots to
  SignInScreen, dev login lands on home, sign out returns to SignInScreen,
  email OTP flow using the code logged to the server console.
- **Manual pass** (per repo practice: iOS sim + real backend): SMS OTP (real
  Twilio), Google, Apple.
