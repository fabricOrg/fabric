import { apiKeyEnv } from "@app/contracts";
import { z } from "zod";

/**
 * Create-key validation — mirrors the original dialog's rules: a name is required and at least one
 * scope must be selected. Env is constrained to the contract enum (test/live).
 */
export const schema = z.object({
  name: z.string().trim().min(1, "Enter a name for this key."),
  env: apiKeyEnv,
  scopes: z.array(z.string()).min(1, "Select at least one scope."),
});
