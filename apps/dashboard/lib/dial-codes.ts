// Recipient masks arrive as E.164 ("+233 24● ●●● ●●12"); the leading dial code is enough to derive
// the destination country for filtering. West-Africa-first (PI-3 region) plus a few common corridors.
const DIAL_CODES: Record<string, string> = {
  "+233": "Ghana",
  "+234": "Nigeria",
  "+225": "Côte d'Ivoire",
  "+221": "Senegal",
  "+228": "Togo",
  "+229": "Benin",
  "+226": "Burkina Faso",
  "+254": "Kenya",
  "+27": "South Africa",
  "+44": "United Kingdom",
  "+1": "United States",
};

/** Country name derived from the recipient mask's leading dial code, or "Other". */
export function countryOf(to: string): string {
  const code = to.trim().split(/\s+/)[0] ?? "";
  return DIAL_CODES[code] ?? "Other";
}
