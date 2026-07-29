/**
 * Secrets whose absence does not break the API until the exact moment someone depends on them.
 *
 * Both wrap other keys, and both are read LAZILY — the derivation runs on first use, not at boot. In
 * production that combination is a trap: the service starts, `/healthz` reports healthy, and the
 * failure only appears when an operator installs a provider credential or a customer sends their
 * first message. The error that surfaces there is an uncaught `Error`, so it reaches the UI as an
 * unstructured 500 with no cause attached.
 *
 * That is not hypothetical — a PLUGIN_MASTER_KEY set to fewer than 32 characters presented exactly
 * this way, and cost a debugging session to find, because "the variable is set" looks like proof and
 * is not.
 */
const REQUIRED_IN_PRODUCTION = ["PLUGIN_MASTER_KEY", "PII_MASTER_KEY"] as const;

/** Matches the derivation helpers, which reject anything shorter as too weak to spread. */
const MIN_LENGTH = 32;

/**
 * Refuse to start on a secret that would fail later.
 *
 * Failing the boot is deliberately the loud option. On a rolling deploy it means the release does
 * not go live and the previous, working revision keeps serving — strictly better than a green deploy
 * that has quietly lost a capability. Non-production is left alone so local and test runs keep
 * working on the development fallbacks.
 */
export function assertRequiredSecrets(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== "production") return;
  const problems = REQUIRED_IN_PRODUCTION.flatMap((name) => {
    const value = env[name]?.trim();
    if (!value) return [`${name} is not set`];
    // Never log the value or its prefix — the LENGTH is the whole diagnosis here, and it gives an
    // attacker nothing they could not already guess about a key we require to be long.
    if (value.length < MIN_LENGTH) {
      return [
        `${name} is ${value.length} characters, needs at least ${MIN_LENGTH}`,
      ];
    }
    return [];
  });
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start — required secrets are invalid: ${problems.join("; ")}.`,
    );
  }
}
