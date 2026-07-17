import {
  type AppDb,
  type ApplicationId,
  type EnvironmentId,
  environments,
  messageDefinitionSenderBindings,
  type TenantId,
} from "@app/db";
import { and, eq } from "drizzle-orm";
import { invalidRequest, notFound } from "../http/api-error.js";

type Tx = Parameters<Parameters<AppDb["withTenantDrizzle"]>[1]>[0];

export async function bindSandboxSender(
  tx: Tx,
  input: {
    tenantId: string;
    applicationId: string;
    definitionId: string;
    senderId: string;
  },
): Promise<void> {
  const [sandbox] = await tx
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.applicationId, input.applicationId as ApplicationId),
        eq(environments.type, "sandbox"),
      ),
    )
    .limit(1);
  if (!sandbox) {
    throw notFound(
      "environment_not_found",
      "The application has no sandbox environment.",
    );
  }
  await tx.insert(messageDefinitionSenderBindings).values({
    tenantId: input.tenantId as TenantId,
    applicationId: input.applicationId as ApplicationId,
    environmentId: sandbox.id,
    definitionId: input.definitionId,
    senderId: input.senderId,
  });
}

export async function requireSenderBinding(
  tx: Tx,
  definitionId: string,
  environmentId: string,
): Promise<void> {
  const [binding] = await tx
    .select({ id: messageDefinitionSenderBindings.id })
    .from(messageDefinitionSenderBindings)
    .where(
      and(
        eq(messageDefinitionSenderBindings.definitionId, definitionId),
        eq(
          messageDefinitionSenderBindings.environmentId,
          environmentId as EnvironmentId,
        ),
      ),
    )
    .limit(1);
  if (!binding) {
    throw invalidRequest(
      "sender_binding_missing",
      "Bind a sandbox sender before publishing this definition.",
      "sender_id",
    );
  }
}
