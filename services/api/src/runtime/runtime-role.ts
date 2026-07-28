import type { ConfigService } from "@nestjs/config";

export type RuntimeRole = "api" | "worker" | "scheduler";

/**
 * `all` preserves local single-process development. Deployments set one role per independently
 * scaled task so HTTP replicas never multiply workers or cron ownership.
 */
export function runtimeRoleEnabled(
  config: ConfigService,
  role: RuntimeRole,
): boolean {
  const configured = config.get<string>("RUNTIME_ROLE") ?? "all";
  return configured === "all" || configured === role;
}
