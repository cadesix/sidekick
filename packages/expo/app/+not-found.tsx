import { Redirect } from 'expo-router';

// Catch-all for any unmatched path (e.g. a dev-client deep link like
// `sidekickmobile://expo-development-client/...` that leaks its marker into the
// router) → send it to the root, which gates to onboarding or Home.
export default function NotFound() {
  return <Redirect href="/" />;
}
