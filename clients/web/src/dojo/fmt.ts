export function clock(seconds: number) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function minutes(seconds: number) {
  const value = Math.round((Number(seconds) || 0) / 60);
  return value ? `${value} min` : "";
}

export function day(iso: string) {
  const at = Date.parse(iso || "");
  if (!Number.isFinite(at)) return "";
  const date = new Date(at);
  const today = new Date();
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).replace(/,/g, "");
}

export function thisWeek(iso: string) {
  const at = Date.parse(iso || "");
  return Number.isFinite(at) && Date.now() - at < 7 * 86400000;
}

export function joinMeta(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" · ");
}
