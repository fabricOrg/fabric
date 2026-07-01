// @app/domain — PURE, framework-free business policy that's reused across services and is worth
// unit-testing in isolation. WHY separate from services: the riskiest logic (segment counting,
// money rating math, the reserve→commit/refund decision, billable-status rules) should be pure
// functions with no DB/HTTP/Nest dependency — trivial to test exhaustively (matches our money
// correctness DoD). Services orchestrate; domain decides.
//
// Examples that will live here: encodeAndSegment(body), rateSegments(...), resolveBilling(status, provider).
// No I/O, no NestJS, no Drizzle — just types (from @app/contracts) in, decisions out.

export {};
