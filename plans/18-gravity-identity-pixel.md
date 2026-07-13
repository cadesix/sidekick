# Gravity identity and attribution

- Add required email/password authentication while preserving the anonymous device user's existing data.
- Normalize and hash authenticated email before sending `user.email_hash` to Gravity.
- Forward the end user's IP, user agent, OS, country, locale, timezone, and stable device ID when available.
- Replace sponsored-link browser sheets with a React Native WebView that injects the Gravity in-app pixel.
- Cover authentication, Gravity request payloads, and pixel/browser behavior with tests and verify in iOS Simulator.
