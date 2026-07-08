import { Auth, AuthStatus } from "@lomray/react-native-apple-music";

/**
 * Native Apple Music auth seam (12-life-integrations.md). Two modules by
 * necessity: `@lomray/react-native-apple-music` for `authorize()` +
 * `checkSubscription()`, and `@superfan-app/apple-music-auth` for the Music User
 * Token (minted on-device only — re-exported here so the connect UI can use its
 * hook). The developer token is fetched from our server; the `.p8` key never ships.
 */
export {
  AppleMusicAuthProvider,
  useAppleMusicAuth,
  type AppleMusicAuthHook,
} from "@superfan-app/apple-music-auth";

export async function authorizeAppleMusic(): Promise<boolean> {
  const status = await Auth.authorize();
  return status === AuthStatus.AUTHORIZED;
}

/**
 * Whether the user can play catalog content — i.e. has an active subscription
 * (12 §music). Library writes require this; without it the connect flow stops
 * with "you'd need Apple Music for this one 🥲".
 */
export async function hasAppleMusicSubscription(): Promise<boolean> {
  const subscription = await Auth.checkSubscription();
  return subscription.canPlayCatalogContent;
}
