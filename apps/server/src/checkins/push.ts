/**
 * Expo push send seam (03: "push-send seam — actual Expo push behind env").
 * The check-in engine always produces a `PushIntent`; sending is a no-op unless
 * both an `EXPO_ACCESS_TOKEN` and a device token are present, so tests and
 * push-off users exercise the full pipeline without a network call.
 */
export type PushIntent = {
  token: string | null;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export async function sendPush(
  accessToken: string | undefined,
  intent: PushIntent,
): Promise<{ sent: boolean }> {
  if (!accessToken || !intent.token) {
    return { sent: false };
  }
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: intent.token,
        title: intent.title,
        body: intent.body,
        data: intent.data,
      }),
    });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}
