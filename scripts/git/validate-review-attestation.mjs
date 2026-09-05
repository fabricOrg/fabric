// Independent-review gate (CLAUDE.md §5), enforced rather than requested.
//
// The rule and the PR template checkbox both existed already and were still skipped — because
// `gh pr create --body-file` REPLACES the template, so the checklist silently never appears, and
// nothing ever read it. A rule that only lives in prose is advice; this makes the pull request state
// who reviewed it, and fails when it does not.
//
// Deliberately NOT a proof of review — nothing here can be. It is a forcing function: you must name
// a reviewer that is not yourself, in writing, on the record, before this merges. Lying to it is a
// choice someone made explicitly, not a step they forgot.

const body = process.env.PR_BODY ?? "";
const author = (process.env.PR_AUTHOR ?? "").trim().toLowerCase();
const base = process.env.GITHUB_BASE_REF?.trim();
const head = process.env.GITHUB_HEAD_REF?.trim();

// Promotions carry no new code — they move already-reviewed commits between environments. Requiring
// a fresh reviewer there would train everyone to type something meaningless four times a release.
const PROMOTION_HEADS = new Set(["dev", "testing", "staging"]);
if (head && PROMOTION_HEADS.has(head) && base !== "dev") {
  console.log(`Promotion ${head} -> ${base}: review attestation not required.`);
  process.exit(0);
}

const REVIEWER = /^\s*(?:-\s*)?reviewed[ -]by\s*:\s*(.+)$/im;
const match = body.match(REVIEWER);
const reviewer = match?.[1]?.trim() ?? "";

if (!reviewer) {
  console.error(
    [
      "Missing independent review (CLAUDE.md §5).",
      "",
      "Add a line to the pull-request body naming who reviewed this:",
      "",
      "    Reviewed-by: codex gpt-5.6-sol — 3 findings, 2 fixed, 1 rejected (reason)",
      "    Reviewed-by: subagent (api-security lens) — 1 blocker fixed",
      "    Reviewed-by: @teammate",
      "",
      "Self-review does not satisfy this gate: it inherits the framing that produced the bug.",
      "A green pipeline does not either — gates catch mechanical defects, never semantics.",
      "",
      "If codex is unavailable (quota, outage), a SUBAGENT review is the required fallback.",
      "An outage is not a waiver. See CLAUDE.md §5.",
    ].join("\n"),
  );
  process.exit(1);
}

const normalised = reviewer.toLowerCase();
const namesAuthor =
  author.length > 0 &&
  (normalised === author ||
    normalised === `@${author}` ||
    normalised.includes(`@${author}`));
const SELF = /\b(self|me|myself|author|n\/?a|none|nobody)\b/i;

if (namesAuthor || SELF.test(reviewer)) {
  console.error(
    [
      `"Reviewed-by: ${reviewer}" names the author (or nobody).`,
      "",
      "Independent means NOT the author. Use codex, a subagent, or another person.",
      "See CLAUDE.md §5.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Independent review attested: ${reviewer}`);
