import { View } from "react-native";
import { Redirect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "~/lib/api";
import { Funnel } from "~/features/onboarding/Funnel";

/**
 * The funnel — one route, internal step index (02 / 07). Server-authoritative:
 * a user who already finished onboarding is bounced home so the funnel can never
 * re-run over a real account.
 */
export default function Onboarding() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: Number.POSITIVE_INFINITY });

  if (me.isPending) {
    return <View className="flex-1 bg-white" />;
  }
  if (me.data?.onboardingComplete) {
    return <Redirect href="/" />;
  }
  return <Funnel />;
}
