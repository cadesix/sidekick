/**
 * Tiny weather lookup behind an env flag (03: "one cheap API call" enabling
 * "it's soo hot today, did you get your run in?"). Absent `WEATHER_API_KEY` or
 * city → returns null and the opener simply skips the signal. Tests never need
 * this — it short-circuits without a key.
 */
export async function getWeather(
  apiKey: string | undefined,
  city: string | null,
): Promise<string | null> {
  if (!apiKey || !city) {
    return null;
  }
  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("q", city);
  url.searchParams.set("units", "imperial");
  url.searchParams.set("appid", apiKey);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      weather?: { description?: string }[];
      main?: { temp?: number };
    };
    const description = body.weather?.[0]?.description;
    const temp = body.main?.temp;
    if (!description || temp === undefined) {
      return null;
    }
    return `${description}, ${Math.round(temp)}°F`;
  } catch {
    return null;
  }
}
