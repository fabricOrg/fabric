import { timingSafeEqual } from "node:crypto";

export function readSingleHeader(
  value: string | string[] | undefined,
): string | null {
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === "string" && header.length > 0 ? header : null;
}

export function secretsMatch(
  candidate: string | null,
  expected: string,
): boolean {
  if (candidate === null || expected.length === 0) return false;

  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}
