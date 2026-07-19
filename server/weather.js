const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

export function isWeatherQuery(text) {
  return /\b(weather|forecast|temperature|temp|humidity|rain|snow|wind|conditions?)\b/i.test(String(text || ""));
}

export function buildWeatherTool() {
  return {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather and the upcoming hourly and five-day forecast for a location. Use this instead of web_search for weather conditions, temperature, rain, humidity, or wind.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City, region, or place name, for example: Dubai or Paris, France." },
          units: {
            type: "string",
            enum: ["metric", "imperial"],
            default: "metric",
            description: "Use metric for Celsius and imperial for Fahrenheit."
          }
        },
        required: ["location"]
      }
    }
  };
}

async function fetchJson(url, { signal, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.message || `Weather service returned ${response.status}.`);
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function localDate(timestamp, offsetSeconds) {
  return new Date((timestamp + offsetSeconds) * 1000).toISOString().slice(0, 10);
}

function localHour(timestamp, offsetSeconds) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", timeZone: "UTC" })
    .format(new Date((timestamp + offsetSeconds) * 1000));
}

function dayLabel(date, today) {
  if (date === today) return "Today";
  return new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

function condition(entry) {
  return {
    label: entry?.weather?.[0]?.description || "Unknown",
    icon: entry?.weather?.[0]?.icon || ""
  };
}

function forecastDays(items, offsetSeconds) {
  const today = localDate(Math.floor(Date.now() / 1000), offsetSeconds);
  const grouped = new Map();
  for (const item of items) {
    const date = localDate(item.dt, offsetSeconds);
    const current = grouped.get(date) || { date, min: Infinity, max: -Infinity, pop: 0, sample: item };
    current.min = Math.min(current.min, Number(item.main?.temp_min));
    current.max = Math.max(current.max, Number(item.main?.temp_max));
    current.pop = Math.max(current.pop, Number(item.pop || 0));
    const hour = new Date((item.dt + offsetSeconds) * 1000).getUTCHours();
    const sampleHour = new Date((current.sample.dt + offsetSeconds) * 1000).getUTCHours();
    if (Math.abs(hour - 12) < Math.abs(sampleHour - 12)) current.sample = item;
    grouped.set(date, current);
  }
  return [...grouped.values()].slice(0, 5).map((day) => ({
    date: day.date,
    min: Math.round(day.min),
    max: Math.round(day.max),
    precipitation_probability: Math.round(day.pop * 100),
    ...condition(day.sample),
    label: dayLabel(day.date, today)
  }));
}

export async function lookupWeather({ config, location, units = "metric", signal }) {
  const apiKey = String(config?.apiKey || "").trim();
  if (!apiKey) throw new Error("Weather is not configured.");
  const query = String(location || "").trim();
  if (!query) throw new Error("get_weather requires a location.");
  const normalizedUnits = units === "imperial" ? "imperial" : "metric";
  const cacheKey = `${query.toLowerCase()}|${normalizedUnits}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };

  const baseUrl = String(config.baseUrl || "https://api.openweathermap.org").replace(/\/$/, "");
  const timeoutMs = Number(config.timeoutMs) || 8000;
  const geocodeUrl = new URL("/geo/1.0/direct", baseUrl);
  geocodeUrl.search = new URLSearchParams({ q: query, limit: "1", appid: apiKey });
  const places = await fetchJson(geocodeUrl, { signal, timeoutMs });
  const place = Array.isArray(places) ? places[0] : null;
  if (!place) throw new Error(`No weather location found for "${query}".`);

  const common = { lat: String(place.lat), lon: String(place.lon), appid: apiKey, units: normalizedUnits };
  const currentUrl = new URL("/data/2.5/weather", baseUrl);
  currentUrl.search = new URLSearchParams(common);
  const forecastUrl = new URL("/data/2.5/forecast", baseUrl);
  forecastUrl.search = new URLSearchParams(common);
  const [current, forecast] = await Promise.all([
    fetchJson(currentUrl, { signal, timeoutMs }),
    fetchJson(forecastUrl, { signal, timeoutMs })
  ]);

  const offsetSeconds = Number(forecast.city?.timezone ?? current.timezone ?? 0);
  const days = forecastDays(Array.isArray(forecast.list) ? forecast.list : [], offsetSeconds);
  const currentCondition = condition(current);
  const name = place.name || current.name || query;
  const country = place.country || current.sys?.country || "";
  const artifact = {
    type: "weather",
    weather_id: `weather:${Number(place.lat).toFixed(3)}:${Number(place.lon).toFixed(3)}:${normalizedUnits}`,
    provider: "openweather",
    location: { name, country },
    units: normalizedUnits,
    unit_symbol: normalizedUnits === "imperial" ? "°F" : "°C",
    observed_at: Number(current.dt) || Math.floor(Date.now() / 1000),
    current: {
      temperature: Math.round(Number(current.main?.temp)),
      feels_like: Math.round(Number(current.main?.feels_like)),
      humidity: Math.round(Number(current.main?.humidity)),
      wind_speed: Math.round(Number(current.wind?.speed)),
      high: days[0]?.max ?? Math.round(Number(current.main?.temp_max)),
      low: days[0]?.min ?? Math.round(Number(current.main?.temp_min)),
      ...currentCondition
    },
    hourly: (forecast.list || []).slice(0, 7).map((item) => ({
      timestamp: item.dt,
      temperature: Math.round(Number(item.main?.temp)),
      precipitation_probability: Math.round(Number(item.pop || 0) * 100),
      ...condition(item),
      label: localHour(item.dt, offsetSeconds)
    })),
    daily: days,
    attribution: { label: "Weather data © OpenWeather", url: "https://openweathermap.org/" }
  };
  const value = { artifact, cached: false };
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
