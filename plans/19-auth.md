# 19 — Auth: Apple, Google, Email, SMS (ported from invoice + scaleshot)

## Goal

Port the auth system from `~/Code/invoice` into sidekick, minus the team/org
code, and add SMS auth from `~/Code/scaleshot` (invoice has no SMS — only dead
scaffolding). Add a dev-login equivalent. Nothing in sidekick is in prod, so we
can restructure freely — no back-compat required.

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
  - (invoice web also has an auth-code flow; we don't need it — see
    "Deviations" below.)
- **Email**: 6-digit OTP (not magic link, not password).
  `crypto.randomInt(100000, 999999)`, SHA-256 hash stored in
  `emailVerificationCodes` with 10-min expiry; prior codes invalidated on
  re-request; verify consumes atomically via conditional
  `UPDATE … RETURNING` with `attempts < 5`. Sent via Resend
  (`otp-code.tsx` react-email template). In dev without `RESEND_API_KEY`, the
  code is logged to the server console instead.
- **Account model**: `accounts` table maps `(provider, providerAccountId)` →
  `userId`. `findOrCreateUserForProvider` (in
  `packages/api/src/routes/user.ts`) is the central linking engine:
  - provider identity already exists → sign into that user, and merge the
    current anonymous user into it (`mergeAnonymousUserInto`).
  - provider identity is new → attach it to the current anonymous user
    (upgrade in place).
- **Anonymous-first**: mobile bootstraps an anonymous user + session on first
  launch; real sign-in upgrades or merges. Sidekick already works this way
  (device bootstrap), which is why this port fits cleanly.
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
  two-step), `auth-bottom-sheet.tsx` (UI), `auth-error-handler.ts` (after 3
  consecutive UNAUTHORIZED responses, clear stored auth and prompt re-auth).

### scaleshot (`~/Code/scaleshot`) — SMS only

- **Twilio Verify** does everything: generates the code, sends the SMS,
  tracks attempts, validates. **No OTP table, no code generation, no hashing
  on our side.** (`packages/backend/src/services/auth/sms.ts`, ~40 lines):
  - `sendPhoneCode(phone)` → `client.verify.v2.services(sid).verifications.create({to, channel: "sms"})`
  - `verifyPhoneCode(phone, code)` → `verificationChecks.create({to, code})`,
    throw unless `status === "approved"`.
- `users.phone` is a plain unique text column (E.164). No verified-at column.
- Client: phone input via `react-phone-number-input` (web) — we'll build the
  RN equivalent; 6-digit code input auto-submits.
- Rate limits: 3 code requests/hour per phone (plus Twilio's own limits).
- Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`.
- No dev bypass for SMS exists — dev login covers local dev instead.

## Sidekick today (what changes)

- Identity = anonymous device bearer token: `devices.token` unique column,
  minted once by `auth.register`, looked up by `resolveUserId` in
  `packages/server/src/context.ts`. No sessions, no login UI.
- `users` already has nullable `email` + `passwordHash` columns (unused).
- Client: `packages/expo/src/lib/auth.tsx` `AuthGate` silently registers the
  device and stores `sidekick.deviceId` / `sidekick.token` in
  SecureStore/localStorage; `packages/expo/src/lib/api.ts` sends
  `Authorization: Bearer <token>` + `x-sidekick-device-id`.

## Key decisions

1. **Sessions replace device tokens as the credential.** `devices.token` goes
   away. `auth.register` (device bootstrap) now creates the anon user +
   device row **and a session**, returning the session token. The `devices`
   table stays for device metadata + push-token FKs, minus the `token`
   column. `context.ts` resolves `userId` from `authSessions` instead. One
   credential path for anon and signed-in users — exactly invoice's model.
2. **Bearer-only, no cookies.** Invoice's web client uses an HttpOnly cookie;
   sidekick's Expo Web client already uses bearer + localStorage through the
   single shared `api.ts`, and the server is CORS-permissive with no cookie
   handling. Keeping bearer everywhere means zero platform forking in the
   client and we skip invoice's cookie helpers entirely.
3. **No passwords.** Email = OTP. Drop the unused `users.passwordHash` column.
4. **No teams.** Skip `teams`, `teamMemberships`, `teamInvites`, `apiKeys`,
   `teamProcedure`, `x-team-id` parsing, and the one
   `tx.update(teamMemberships)` line inside `mergeAnonymousUserInto`.
   Also skip invoice's `entitledProcedure`/`isWeb` billing coupling.
5. **SMS via Twilio Verify** (scaleshot's approach), wired into invoice's
   `findOrCreateUserForProvider` as `provider: "phone"`,
   `providerAccountId: <E.164 phone>`. No `smsCodes` table (invoice's is dead
   scaffolding; scaleshot proves Twilio Verify needs none).
6. **Google id-token flow on all platforms.** `expo-auth-session`'s Google
   provider produces an `id_token` on both iOS and web (with per-platform
   client IDs). The server accepts a list of audiences. This drops invoice's
   separate web auth-code flow + `GOOGLE_CLIENT_SECRET` exchange — one client
   code path, one server mutation.
7. **Apple: iOS first, web later.** `expo-apple-authentication` is iOS-only.
   On web the Apple button is hidden in v1 (App Store's "must offer Sign in
   with Apple" rule applies to iOS, which we cover). The server verifier
   already accepts a Services-ID audience, so adding Apple JS on web later is
   client-only work.
8. **Merge semantics.** Faithful port of invoice's engine:
   - New provider identity → attach `accounts` row to the current anon user
     (all their sidekick data — conversations, memories, goals, sparks —
     is preserved; the user "becomes" signed in).
   - Existing provider identity → create a session for that existing user and
     merge the anon user into it: repoint `devices` and `devicePushTokens`
     rows to the target user, soft-delete the anon user. We do **not**
     attempt to merge conversations/memories/goals — a device that signs into
     an existing account adopts that account's data. (Invoice moves
     "businesses"; devices/push tokens are sidekick's equivalent.)
9. **Token prefix** `sk_au_` instead of `co_au_`. Same generation code.

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
- add `deletedAt timestamp` (nullable) — needed for anon-merge soft delete
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
- **`link.ts`** — port of invoice's `findOrCreateUserForProvider` +
  `mergeAnonymousUserInto` (teams line removed; repoints `devices` +
  `devicePushTokens`, soft-deletes the anon user). Sets `users.email`/
  `users.phone`/`emailVerified` from the provider identity when attaching.
- **`register.ts`** — today's `registerDevice`, updated: create anon user +
  device row (idempotent on `deviceId`) + session; return
  `{ userId, token }` where token is now a session token. On repeat
  registration of a known device, mint a fresh session for its user.
- **`dev-login.ts`** — see "Dev login" below.
- **`rate-limit.ts`** — port invoice's limiter setup (in-memory; fine for
  now, single-instance dev and low-traffic Vercel — note: per-instance on
  serverless, and Twilio Verify enforces its own limits for SMS regardless).

Router (`packages/server/src/routers/auth.ts`) grows to:

```
auth.register                  (public)  — device bootstrap → anon user + session
auth.authenticateWithApple     (public)  — { identityToken, platform } → session
auth.authenticateWithGoogle    (public)  — { idToken } → session
auth.requestEmailCode          (public)  — { email }
auth.verifyEmailCode           (public)  — { email, code } → session
auth.requestPhoneCode          (public)  — { phone }
auth.verifyPhoneCode           (public)  — { phone, code } → session
auth.logout                    (protected) — revoke current session
auth.devLogin                  (public, dev-only)
```

All `authenticateWith*` / `verify*Code` mutations accept the caller's current
bearer token implicitly via ctx (the anon session) so `link.ts` knows which
anon user to upgrade/merge, and return
`{ token, userId, isNewUser }`.

`context.ts`: replace `resolveUserId` (devices lookup) with
`getSessionFromAuthHeader`. Everything downstream (`protectedProcedure`, the
manual 401 checks in `/chat/stream`, `/chat/continue`, `/blob/*`,
`/music/developer-token`) keeps working untouched since they only read
`ctx.userId`.

Input schemas go in `packages/shared/app/src/schemas.ts` next to
`registerInput` (email as `z.string().email()`, phone as E.164 regex, code as
6-digit string).

New server deps: `apple-signin-auth`, `resend`, `twilio`. (`jose` already
present but not needed — apple-signin-auth handles JWKS itself.)

## Expo client changes (`packages/expo`)

New deps: `expo-apple-authentication` (+ its config plugin in
`app.config.js`), `expo-auth-session`.

- **`src/lib/auth.tsx`** — keep `AuthGate` bootstrap as-is (it already does
  invoice's `BootstrapUserProvider` job). Add:
  - `signOut()`: call `auth.logout`, clear `sidekick.token`, re-run the
    bootstrap (device re-registers → fresh anon user + session).
  - `applyAuthResult({ token, userId })`: persist the new token, call
    `setAuthToken`, invalidate all react-query caches + reset zustand-backed
    server-derived state so the app reloads as the signed-in user.
- **`src/lib/auth-providers.tsx`** — port of invoice's
  `auth-providers.tsx`:
  - `useAppleAuth()` — `expo-apple-authentication` `signInAsync` →
    `auth.authenticateWithApple` (`platform: "ios"`). Not rendered on web
    (v1).
  - `useGoogleAuth()` — `expo-auth-session/providers/google`
    `useIdTokenAuthRequest` with `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` /
    `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` → `auth.authenticateWithGoogle`.
  - `useEmailAuth()` — two-step request/verify.
  - `usePhoneAuth()` — two-step request/verify (new, mirrors email).
- **`src/components/AuthSheet.tsx`** — sign-in UI as a TrueSheet (repo
  idiom), modeled on invoice's `auth-bottom-sheet.tsx` + scaleshot's two-step
  `AuthForm`: provider buttons (Apple — native only, Google) up top,
  email/phone entry with a method toggle below, then a 6-digit code step that
  auto-submits on the 6th digit. Native `Icon`/Glass primitives per the
  imessage components. Phone input: RN `TextInput` with
  `keyboardType="phone-pad"` + a minimal E.164 formatter (skip
  react-phone-number-input; it's DOM-only).
  - Entry point: an account row in `app/settings.tsx` — "Sign in" when anon,
    email/phone + "Sign out" when authed (`users.me` gains
    `email`/`phone`/`isAnonymous` fields).
- **`src/lib/api.ts`** — add an `onUnauthorized` hook to the tRPC link chain,
  port of invoice's `auth-error-handler.ts`: 3 consecutive UNAUTHORIZED →
  clear stored token → re-bootstrap. (Covers revoked/expired sessions.)

## Dev login

Port of invoice's `devAuth.login`, adapted:

- **Server** (`packages/server/src/auth/dev-login.ts`): public mutation
  `auth.devLogin`, first line throws unless
  `process.env.NODE_ENV === "development"`. Finds/creates the
  `dev@test.local` user via the email `accounts` row; on first creation seeds
  a usable profile — name, sidekick name/color, timezone,
  `onboardingCompletedAt`, some sparks, notification preferences — so the app
  skips the onboarding funnel and lands on the home screen. Returns a session
  like every other auth mutation.
- **Client**: a "Dev login" button inside the AuthSheet, rendered only when
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

1. **Sessions core** — schema (all tables + users/devices changes),
   migration, `sessions.ts`, `register.ts`, `context.ts` swap,
   `auth.register` returning session tokens, `auth.logout`. App behaves
   exactly as today (silent anon bootstrap) but on the new credential.
2. **Providers, server side** — `link.ts`, `apple.ts`, `google.ts`,
   `email.ts`, `sms.ts`, rate limits, all router mutations, dev login,
   `users.me` gains `email`/`phone`/`isAnonymous`.
3. **Client** — `auth-providers.tsx`, `AuthSheet`, settings entry point,
   `signOut`/`applyAuthResult`, 401 handler, dev login button.
4. **Provisioning + verification** — real Apple/Google/Resend/Twilio config,
   end-to-end pass in the iOS simulator against the local server.

## Testing

- **Vitest + PGlite (existing harness)** — the high-value, mock-free tests:
  session lifecycle (create → resolve → sliding touch → logout → 401),
  register idempotency (same deviceId → same user, fresh session),
  email-OTP semantics (expiry, prior-code invalidation, atomic consume,
  attempt cap), and `link.ts` (new identity upgrades anon in place; existing
  identity merges — devices/push tokens repointed, anon soft-deleted).
  Email sending and Twilio go through the existing `createServices` seam so
  tests inject a capturing sender rather than mocking modules.
- **Apple/Google verifiers** — thin wrappers around external services; not
  unit-tested (nothing of ours to test without mocking the provider).
- **Manual pass** (per repo practice: iOS sim + real backend): dev login,
  email OTP (code from server console), SMS OTP (real Twilio), Google, Apple,
  sign-out → fresh anon, sign-in-again → merge back.
