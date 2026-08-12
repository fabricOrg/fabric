import { type ProvisioningDb, payments } from "@app/db";
import { eq } from "drizzle-orm";

/**
 * Record what the provider said about an auto-charge attempt.
 *
 * The webhook remains the source of truth for credit. A provider reference marks successful
 * submission; `failed` is terminal and releases the per-tenant uniqueness guard so the next tick can
 * try again.
 */
export async function recordProviderResult(
  provisioning: ProvisioningDb,
  reference: string,
  result: { status: "success" | "failed" | "pending"; providerRef?: string },
): Promise<void> {
  const update: {
    updatedAt: Date;
    status?: "failed";
    providerRef?: string;
  } = { updatedAt: new Date() };
  if (result.status === "failed") {
    update.status = "failed";
  } else {
    update.providerRef = result.providerRef ?? reference;
  }
  await provisioning.db
    .update(payments)
    .set(update)
    .where(eq(payments.reference, reference));
}
