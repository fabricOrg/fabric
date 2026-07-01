/**
 * SMS encoding + segmentation (F5.2) — PURE. Segment count DETERMINES cost, so it's computed
 * server-side and never trusted from the client. A single non-GSM character (e.g. an emoji) forces
 * the whole message to UCS-2, which halves the per-segment capacity — the classic CPaaS gotcha.
 */

export type Encoding = "gsm7" | "ucs2";

export interface Segmentation {
  encoding: Encoding;
  /** number of characters/code units counted under the chosen encoding */
  length: number;
  segments: number;
}

// The GSM 03.38 basic character set + the default extension chars (which count as TWO septets each).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENSION = "^{}\\[~]|€";

function isGsm7(body: string): boolean {
  for (const ch of body) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENSION.includes(ch)) return false;
  }
  return true;
}

/** GSM-7 length in septets — extension characters cost 2. */
function gsm7Length(body: string): number {
  let n = 0;
  for (const ch of body) n += GSM7_EXTENSION.includes(ch) ? 2 : 1;
  return n;
}

/**
 * Detect encoding and compute the billable segment count. Single-segment limits: GSM-7 160 / UCS-2
 * 70. Concatenated (multi-segment) limits are lower because each segment carries a 6-byte UDH:
 * GSM-7 153 / UCS-2 67 (F5.2). Empty body = 1 segment (you still pay to send an empty message).
 */
export function encodeAndSegment(body: string): Segmentation {
  const gsm7 = isGsm7(body);
  const encoding: Encoding = gsm7 ? "gsm7" : "ucs2";
  const length = gsm7 ? gsm7Length(body) : [...body].length; // UCS-2 counts code points
  const single = gsm7 ? 160 : 70;
  const concat = gsm7 ? 153 : 67;
  const segments = length <= single ? 1 : Math.ceil(length / concat);
  return { encoding, length, segments: Math.max(1, segments) };
}
