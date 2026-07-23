import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

// Zustand persist storage for every store in this app. expo-router statically
// renders routes in NODE, where web AsyncStorage throws (`window is not
// defined`) — and any rehydration-time setState triggers a persist WRITE whose
// rejection kills the dev server. RN always defines a window global, so
// `typeof window` only gates the node renderer: it gets inert storage; the
// real one hydrates in the browser/app.
export const ssrSafeStorage = () =>
  createJSONStorage(() =>
    typeof window === 'undefined'
      ? { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }
      : AsyncStorage,
  );
