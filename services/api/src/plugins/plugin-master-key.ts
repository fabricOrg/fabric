import { createHash } from "node:crypto";
import type { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

/**
 * The platform master key that wraps every per-credential DEK (ADR-0011 §1).
 *
 * ONE definition, deliberately. This derivation must be byte-identical wherever it is used: the
 * writer seals a credential under it and the send path opens it again, so any divergence produces
 * credentials that store successfully and can never be decrypted — a failure that only surfaces at
 * dispatch, long after the mistake. It previously existed twice, once in the resolver and once in
 * the credentials service.
 *
 * Derived, not truncated. A configured secret is usually ASCII, so slicing 32 bytes off it keeps
 * roughly a byte of entropy per character; SHA-256 spreads whatever entropy exists across the full
 * key. The `plugin-master:` purpose label keeps this independent of the PII master key even if an
 * operator ever configures both from the same secret — one leak must not become two.
 */
export function derivePluginMasterKey(
  config: ConfigService,
  logger: Logger,
): Buffer {
  const secret = config.get<string>("PLUGIN_MASTER_KEY")?.trim();
  if (!secret || secret.length < 32) {
    if (config.get<string>("NODE_ENV") === "production") {
      // Never fall back to a derived development key in production: it would make every stored
      // vendor credential readable by anyone holding this source.
      throw new Error(
        "PLUGIN_MASTER_KEY must be set to at least 32 characters in production.",
      );
    }
    logger.warn(
      "PLUGIN_MASTER_KEY unset — using the local development key; credentials are NOT protected",
    );
    return createHash("sha256")
      .update("fabric-local-plugin-development-key")
      .digest();
  }
  return createHash("sha256").update(`plugin-master:${secret}`).digest();
}
