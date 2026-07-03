const head = process.env.GITHUB_HEAD_REF?.trim();
const base = process.env.GITHUB_BASE_REF?.trim();

if (!head || !base) {
  console.error(
    "Pull-request flow validation requires GITHUB_HEAD_REF and GITHUB_BASE_REF.",
  );
  process.exit(1);
}

const valid =
  (head === "dev" && base === "testing") ||
  (head === "testing" && base === "staging") ||
  (head === "staging" && base === "main") ||
  (head !== "dev" &&
    head !== "testing" &&
    head !== "staging" &&
    head !== "main" &&
    base === "dev");

if (!valid) {
  console.error(
    [
      `Invalid promotion path: ${head} -> ${base}`,
      "Work branches must target dev.",
      "Promotions must follow dev -> testing -> staging -> main.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Promotion path accepted: ${head} -> ${base}`);
