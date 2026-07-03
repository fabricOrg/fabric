// Deterministic timestamp formatting from an ISO string (sliced, not new Date().toLocale…) — SSR/
// client-identical, timezone-stable (UTC). `null` → an em-dash.

export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const [date, time = ""] = iso.split("T");
  const hm = time.slice(0, 5);
  return hm ? `${date} ${hm} UTC` : (date ?? "—");
}
