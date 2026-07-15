import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// The user's names + onboarding-done flag. Ported from the web's
// sidekick_profile_v1 (userName + name) plus a first-run gate. The 3D
// onboarding writes these as each step produces them; index.tsx gates on
// `onboarded` to show onboarding vs home on first launch.

type ProfileState = {
  userName: string;
  sidekickName: string;
  onboarded: boolean;
  hydrated: boolean;
  setUserName: (v: string) => void;
  setSidekickName: (v: string) => void;
  setOnboarded: (v: boolean) => void;
};

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      userName: '',
      sidekickName: '',
      onboarded: false,
      hydrated: false,
      setUserName: (v) => set({ userName: v }),
      setSidekickName: (v) => set({ sidekickName: v }),
      setOnboarded: (v) => set({ onboarded: v }),
    }),
    {
      name: 'sidekick_profile_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (st) => ({ userName: st.userName, sidekickName: st.sidekickName, onboarded: st.onboarded }),
      // flip `hydrated` once AsyncStorage has loaded, so the gate can wait and
      // not flash home before we know whether onboarding is done
      onRehydrateStorage: () => (state) => state && (state.hydrated = true),
    },
  ),
);
