import type {
  ApplicationDto,
  CreateApplicationRequest,
  EnvironmentDto,
  ListApplicationsResponse,
} from "@app/contracts";
import {
  type AppDb,
  apiKeys,
  applications,
  type Environment,
  environments,
  type TenantId,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { asc, count } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest } from "../http/api-error.js";

/**
 * Application management (ADR-0004). A workspace (tenant) owns applications; each application has a
 * sandbox and a live environment. Tenant-scoped via withTenantDrizzle (RLS is the boundary — a
 * caller only ever sees its own workspace's applications). Environment CREATION is not exposed: an
 * application is born with exactly its sandbox + live envs, and go-live (not this API) unlocks live.
 */
@Injectable()
export class ApplicationsService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  async list(tenantId: string): Promise<ListApplicationsResponse> {
    const { apps, envs, keyCounts } = await this.db.withTenantDrizzle(
      tenantId,
      async (tx) => {
        const apps = await tx
          .select()
          .from(applications)
          .orderBy(asc(applications.createdAt));
        const envs = await tx.select().from(environments);
        // Key count per application, one grouped query (RLS scopes to this tenant). Counts ALL keys
        // (incl. revoked) so the card matches the keys table, which lists revoked keys too.
        const keyCounts = await tx
          .select({ applicationId: apiKeys.applicationId, n: count() })
          .from(apiKeys)
          .groupBy(apiKeys.applicationId);
        return { apps, envs, keyCounts };
      },
    );
    const countByApp = new Map(
      keyCounts.map((r) => [r.applicationId, Number(r.n)]),
    );
    return {
      applications: apps.map((app) =>
        toApplicationDto(
          app,
          envs.filter((e) => e.applicationId === app.id),
          countByApp.get(app.id) ?? 0,
        ),
      ),
    };
  }

  async create(
    tenantId: string,
    request: CreateApplicationRequest,
  ): Promise<ApplicationDto> {
    return this.db.withTenantDrizzle(tenantId, async (tx) => {
      const [app] = await tx
        .insert(applications)
        .values({
          tenantId: tenantId as TenantId,
          name: request.name,
          slug: request.slug,
        })
        .onConflictDoNothing({
          target: [applications.tenantId, applications.slug],
        })
        .returning();
      // onConflictDoNothing returns no row when the slug is already taken in this workspace.
      if (!app) {
        throw invalidRequest(
          "application_slug_taken",
          "An application with that slug already exists in this workspace.",
          "slug",
        );
      }
      // A new application is born in sandbox: its sandbox env is active, its live env is locked until
      // go-live unlocks it (go-live is workspace-wide today; per-application go-live is future work).
      const envs = await tx
        .insert(environments)
        .values([
          {
            tenantId: tenantId as TenantId,
            applicationId: app.id,
            type: "sandbox",
            status: "active",
          },
          {
            tenantId: tenantId as TenantId,
            applicationId: app.id,
            type: "live",
            status: "locked",
          },
        ])
        .returning();
      return toApplicationDto(app, envs, 0); // a brand-new application has no keys yet
    });
  }
}

function toEnvironmentDto(env: Environment): EnvironmentDto {
  return {
    id: env.id,
    application_id: env.applicationId,
    type: env.type,
    status: env.status,
    created_at: env.createdAt.toISOString(),
  };
}

function toApplicationDto(
  app: typeof applications.$inferSelect,
  envs: Environment[],
  apiKeyCount: number,
): ApplicationDto {
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    created_at: app.createdAt.toISOString(),
    environments: envs.map(toEnvironmentDto),
    api_key_count: apiKeyCount,
  };
}
