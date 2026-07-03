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
 * UCS-2 segment count, surrogate-safe. Length is UTF-16 CODE UNITS (`str.length`), NOT code points:
 * an astral character (e.g. an emoji, U+1F600) is a surrogate PAIR = 2 units. A single segment holds
 * 70 units; once concatenated each segment holds 67 (a 6-byte UDH eats 3). A surrogate pair is never
 * split across a segment boundary — if it doesn't fit the current segment it moves whole to the next.
 *
 * WHY (money-critical, fix/e5-ucs2-utf16-units): counting code points instead of code units
 * under-counts emoji-heavy bodies → under-segments → UNDER-BILLS and the provider truncates/splits
 * into more parts than we charged. Counting UTF-16 units is what the network actually segments by.
 */
function ucs2Segments(body: string): number {
  if (body.length <= 70) return 1;
  let segments = 1;
  let used = 0;
  for (const cp of body) {
    const w = cp.length; // 2 for an astral code point (surrogate pair), else 1
    if (used + w > 67) {
      // the whole char (incl. a full surrogate pair) rolls to the next segment — never split it
      segments += 1;
      used = 0;
    }
    used += w;
  }
  return segments;
}

/**
 * Detect encoding and compute the billable segment count. Single-segment limits: GSM-7 160 / UCS-2
 * 70. Concatenated (multi-segment) limits are lower because each segment carries a 6-byte UDH:
 * GSM-7 153 / UCS-2 67 (F5.2). Empty body = 1 segment (you still pay to send an empty message).
 */
export function encodeAndSegment(body: string): Segmentation {
  if (isGsm7(body)) {
    const length = gsm7Length(body);
    const segments = length <= 160 ? 1 : Math.ceil(length / 153);
    return { encoding: "gsm7", length, segments: Math.max(1, segments) };
  }
  // UCS-2: count UTF-16 code units (str.length), segment surrogate-safe (see ucs2Segments).
  const length = body.length;
  return { encoding: "ucs2", length, segments: ucs2Segments(body) };
}
