import type { ConfigService } from "@nestjs/config";
import { WorkOS } from "@workos-inc/node";

export const WORKOS_CLIENT = Symbol("WORKOS_CLIENT");
export type WorkosClientProvider = () => WorkOS;

export function createWorkosClient(
  config: ConfigService,
): WorkosClientProvider {
  const apiKey = config.get<string>("WORKOS_API_KEY");
  return () => {
    if (!apiKey) throw new Error("WORKOS_API_KEY is required.");
    return new WorkOS(apiKey);
  };
}
