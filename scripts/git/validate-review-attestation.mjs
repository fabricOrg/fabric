// Independent-review gate (CLAUDE.md §5), enforced rather than requested.
//
// The rule and the pull-request template checkbox both existed already and were still skipped —
// because `gh pr create --body-file` REPLACES the template, so the checklist silently never appears,
// and nothing ever read it. A rule that lives only in prose is advice, and advice loses to a
// deadline.
//
// Deliberately NOT a proof of review — nothing here can be. It is a forcing function: the pull
// request must state who reviewed it, in writing, before it merges. Skipping becomes a thing someone
// chose on the record, not a step that quietly did not happen.

const body = process.env.PR_BODY ?? "";
const author = (process.env.PR_AUTHOR ?? "").trim().toLowerCase();
const base = process.env.GITHUB_BASE_REF?.trim();
const head = process.env.GITHUB_HEAD_REF?.trim();

// Promotions carry no new code — they move already-reviewed commits between environments. Requiring
// a fresh reviewer there would train everyone to type something meaningless four times a release.
// The head/base pairs are hard-restricted by validate-pr-flow.mjs, an earlier step in this same job.
const PROMOTION_HEADS = new Set(["dev", "testing", "staging"]);
if (head && PROMOTION_HEADS.has(head) && base !== "dev") {
  console.log(`Promotion ${head} -> ${base}: review attestation not required.`);
  process.exit(0);
}

if (!author) {
  // Fail CLOSED. Everything else here does, and this was the one asymmetry: with PR_AUTHOR unset the
  // author check silently passed, so `Reviewed-by: <the author>` sailed through a gate whose entire
  // purpose is to refuse exactly that.
  console.error(
    "PR_AUTHOR is not set, so the author check cannot run. Refusing rather than passing blind.",
  );
  process.exit(1);
}

// Anchored at column 0 and read outside code fences. This script's OWN failure message contains
// indented `Reviewed-by:` examples, so a leading-whitespace match meant pasting the CI error into
// the description turned the check green — a gate that accepts its own complaint as compliance.
const REVIEWER = /^(?:-\s*)?reviewed[ -]by\s*:\s*(.+)$/i;
const reviewer = firstOutsideFences(body, REVIEWER);

if (!reviewer) {
  console.error(
    [
      "Missing independent review (CLAUDE.md §5).",
      "",
      "Add a line to the pull-request body, at the start of a line, naming who reviewed this:",
      "",
      "Reviewed-by: codex gpt-5.6-sol - 3 findings, 2 fixed, 1 rejected (reason)",
      "Reviewed-by: subagent (api-security lens) - 1 blocker fixed",
      "Reviewed-by: @teammate - clean, nothing found",
      "",
      "Self-review does not satisfy this gate: it inherits the framing that produced the bug.",
      "A green pipeline does not either - gates catch mechanical defects, never semantics.",
      "",
      "If codex is unavailable (quota, outage), a SUBAGENT review is the required fallback.",
      "An outage is not a waiver. See CLAUDE.md section 5.",
    ].join("\n"),
  );
  process.exit(1);
}

// Anchored to the WHOLE value, not searched within it. A word-boundary search rejected
// "Reviewed-by: codex - clean, none found" — the exact phrasing the template asks for, since a clean
// review is a finding too. A gate that refuses its own instructions gets worked around, not obeyed.
const SELF = /^(self|me|myself|the author|n\/?a|none|nobody)$/i;

// Token-boundary, not substring: `includes("@" + author)` rejected "thanks @author for pairing" and
// would also have matched an unrelated handle merely prefixed by the author's login.
const authorHandle = new RegExp(
  `(^|[^\\w-])@?${escapeRegExp(author)}([^\\w-]|$)`,
  "i",
);

if (authorHandle.test(reviewer) || SELF.test(reviewer.trim())) {
  console.error(
    [
      `"Reviewed-by: ${reviewer}" names the author (or nobody).`,
      "",
      "Independent means NOT the author. Use codex, a subagent, or another person.",
      "See CLAUDE.md section 5.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Independent review attested: ${reviewer}`);

/** The first match on a line that is not inside a fenced code block. */
function firstOutsideFences(text, pattern) {
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = line.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
