import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * SecureStore with a web fallback: the native module is an empty stub on web,
 * so the dev-web preview keeps its device id + token in localStorage instead.
 */
export async function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
