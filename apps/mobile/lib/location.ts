import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { updateLocation } from "./api";

/**
 * The single seam onto Core Location (12-life-integrations.md). `whenInUse` only —
 * never background tracking. We take a coarse fix, reverse-geocode it to a city on
 * device, and send only city-level fields to the server; the coordinates are
 * discarded here and never leave the phone. Throttled to at most once per hour.
 */
const THROTTLE_MS = 60 * 60 * 1000;
const LAST_LOCATED_KEY = "sidekick.lastLocatedMs";

export async function locationGranted(): Promise<boolean> {
  const { granted } = await Location.getForegroundPermissionsAsync();
  return granted;
}

/** Contextual foreground permission request (12 §location). */
export async function requestLocationPermission(): Promise<boolean> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  return granted;
}

function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

async function throttled(now: number): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(LAST_LOCATED_KEY);
  if (!raw) {
    return false;
  }
  const last = Number(raw);
  return Number.isFinite(last) && now - last < THROTTLE_MS;
}

/**
 * On app foreground: if permission is granted and we're outside the throttle
 * window, resolve the current city and push it (plus timezone) to the server.
 * Silent no-op when permission is absent — permission is asked contextually via
 * the pre-permission sheet, never here.
 */
export async function maybeUpdateLocation(): Promise<void> {
  if (!(await locationGranted())) {
    return;
  }
  const now = Date.now();
  if (await throttled(now)) {
    return;
  }

  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
  const places = await Location.reverseGeocodeAsync({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  });
  const place = places[0];
  if (!place?.city) {
    return;
  }

  await updateLocation({
    city: place.city,
    region: place.region ?? undefined,
    country: place.country ?? undefined,
    timezone: deviceTimezone(),
  });
  await SecureStore.setItemAsync(LAST_LOCATED_KEY, String(now));
}
