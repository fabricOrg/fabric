import { createHash } from "node:crypto";

export function hashMsisdn(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function maskMsisdn(value: string): string {
  if (value.length <= 9) return `${value.slice(0, 3)}•••`;
  return `${value.slice(0, 6)}•••${value.slice(-4)}`;
}
