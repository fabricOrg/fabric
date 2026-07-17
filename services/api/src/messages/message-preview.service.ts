import type {
  PreviewMessageRequest,
  SmsVariantContent,
  VariableSchema,
} from "@app/contracts";
import {
  type AppDb,
  applications,
  type EnvironmentId,
  environments,
  messageDefinitionReleases,
  messageDefinitionSenderBindings,
  messageDefinitions,
  messageDefinitionVersions,
  type TenantId,
} from "@app/db";
import { previewSms, type RenderError, type SmsPreview } from "@app/domain";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { ConsentService } from "../consent/consent.service.js";
import { APP_DB } from "../db/db.module.js";
import { notFound } from "../http/api-error.js";
import { SendersService } from "../senders/senders.service.js";
import { assessSendCompliance } from "../sms/sms-compliance.js";

export interface PreviewOutput {
  readonly definition_id: string;
  readonly version_id: string;
  readonly environment: "sandbox" | "live";
  readonly resolved_locale: string;
  readonly blockers: readonly RenderError[];
  readonly warnings: readonly RenderError[];
  readonly eligible: boolean;
  readonly sender: {
    readonly sender_id: string;
    readonly status:
      | "sandbox"
      | "active"
      | "pending"
      | "rejected"
      | "unregistered"
      | "not_evaluated";
  };
  readonly message_class: "transactional" | "promotional";
  readonly preview: SmsPreview | null;
}

/**
 * Public message preview (SDK-003 slice 5). Resolves the RELEASED definition for the presenting key's
 * environment and renders it through the SAME pure core a send uses (previewSms), so the result equals
 * a subsequent managed send. READ-ONLY: no wallet reserve, provider call, outbox insert, or PII write.
 * A runtime scope may inspect a published definition (ADR-0005 #6).
 */
@Injectable()
export class MessagePreviewService {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(SendersService) private readonly senders: SendersService,
    @Inject(ConsentService) private readonly consent: ConsentService,
  ) {}

  async preview(
    tenantId: string,
    request: PreviewMessageRequest,
    environmentId: string | null,
  ): Promise<PreviewOutput> {
    return this.db.withTenantDrizzle(tenantId, async (tx) => {
      // The BFF token carries no environment; fall back to the default application's sandbox env.
      const envId = environmentId ?? (await defaultSandboxEnv(tx, tenantId));
      const [released] = await tx
        .select({
          definitionId: messageDefinitions.id,
          versionId: messageDefinitionVersions.id,
          content: messageDefinitionVersions.content,
          schema: messageDefinitionVersions.variableSchema,
          locale: messageDefinitionVersions.defaultLocale,
          envType: environments.type,
          senderId: messageDefinitionSenderBindings.senderId,
        })
        .from(messageDefinitionReleases)
        .innerJoin(
          messageDefinitions,
          eq(messageDefinitions.id, messageDefinitionReleases.definitionId),
        )
        .innerJoin(
          messageDefinitionVersions,
          eq(messageDefinitionVersions.id, messageDefinitionReleases.versionId),
        )
        .innerJoin(
          messageDefinitionSenderBindings,
          and(
            eq(
              messageDefinitionSenderBindings.definitionId,
              messageDefinitionReleases.definitionId,
            ),
            eq(
              messageDefinitionSenderBindings.environmentId,
              messageDefinitionReleases.environmentId,
            ),
          ),
        )
        .innerJoin(
          environments,
          eq(environments.id, messageDefinitionReleases.environmentId),
        )
        .where(
          and(
            eq(messageDefinitionReleases.tenantId, tenantId as TenantId),
            eq(messageDefinitionReleases.environmentId, envId as EnvironmentId),
            sql`lower(${messageDefinitions.key}) = lower(${request.key})`,
          ),
        )
        .limit(1);
      if (!released) {
        throw notFound(
          "definition_not_released",
          "No released definition with that key in this environment.",
        );
      }
      const content = released.content as SmsVariantContent;
      const messageClass = content.class ?? "transactional";
      const resolvedLocale = request.locale ?? released.locale;
      const localizedBody =
        resolvedLocale === released.locale
          ? content.body
          : content.locales?.[resolvedLocale]?.body;
      const outcome = localizedBody
        ? previewSms({
            template: localizedBody,
            schema: released.schema as VariableSchema,
            data: request.data ?? {},
            currency: request.currency ?? "GHS",
          })
        : {
            blockers: [
              { path: "locale", code: "locale_not_supported" },
            ] satisfies RenderError[],
            preview: null,
          };
      const compliance = await assessSendCompliance({
        senders: this.senders,
        consent: this.consent,
        tenantId,
        ...(request.to ? { to: request.to } : {}),
        senderId: released.senderId,
        messageClass,
        virtual: released.envType === "sandbox",
      });
      const blockers = [
        ...outcome.blockers,
        ...compliance.blockers.map(({ path, code }) => ({ path, code })),
      ];
      return {
        definition_id: released.definitionId,
        version_id: released.versionId,
        environment: released.envType,
        resolved_locale: resolvedLocale,
        blockers,
        warnings: compliance.warnings.map(({ path, code }) => ({ path, code })),
        eligible: blockers.length === 0,
        sender: {
          sender_id: released.senderId,
          status: compliance.senderStatus,
        },
        message_class: messageClass,
        preview: blockers.length === 0 ? outcome.preview : null,
      };
    });
  }
}

/** The default application's sandbox environment for a tenant (BFF-token fallback). */
async function defaultSandboxEnv(
  tx: Parameters<Parameters<AppDb["withTenantDrizzle"]>[1]>[0],
  tenantId: string,
): Promise<string> {
  const [env] = await tx
    .select({ id: environments.id })
    .from(environments)
    .innerJoin(applications, eq(applications.id, environments.applicationId))
    .where(
      and(
        eq(applications.tenantId, tenantId as TenantId),
        eq(applications.slug, "default"),
        eq(environments.type, "sandbox"),
      ),
    )
    .limit(1);
  if (!env) {
    throw notFound(
      "environment_not_found",
      "No sandbox environment to preview against.",
    );
  }
  return env.id;
}
