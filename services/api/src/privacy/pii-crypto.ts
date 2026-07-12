/**
 * Envelope encryption for the PII vault (COMPLIANCE §5).
 *
 * The implementation lives in `@app/db` (pii-envelope.ts) — deliberately, and not because it belongs
 * to the database. The one-off backfill ships inside @app/db and seals PII too, and a second
 * hand-rolled copy of the envelope would be free to drift: rows written by one implementation that
 * the other cannot decrypt, discovered only after irreplaceable personal data was corrupted, with no
 * test that would have caught it. One implementation, one set of tests, no divergence.
 *
 * Re-exported here so callers in the api keep importing from the privacy module they already use.
 */
export {
  DEK_BYTES,
  decryptPii,
  encryptPii,
  maskMsisdn,
  newDek,
  normalizeE164,
  phoneBlindIndex,
  unwrapDek,
  wrapDek,
} from "@app/db";
