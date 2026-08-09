import type { MessageStatus } from "@app/contracts";
import { z } from "zod";
import type { CanonicalDlr } from "../plugin.js";
import { MetaCloudError } from "./errors.js";

const META_STATUS: Readonly<Record<string, MessageStatus>> = {
  accepted: "accepted",
  sent: "sent",
  delivered: "delivered",
  read: "delivered",
  failed: "failed",
  deleted: "undelivered",
  warning: "sent",
};

const metaStatusSchema = z.object({
  id: z.string().trim().min(1),
  status: z.string().trim().min(1),
  timestamp: z.string().optional(),
  errors: z
    .array(
      z.object({
        code: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional(),
});

const metaDlrSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z.object({
                statuses: z.array(metaStatusSchema).optional(),
              }),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

type MetaStatus = z.infer<typeof metaStatusSchema>;

export function parseMetaDlr(payload: unknown): CanonicalDlr {
  const status = firstStatus(payload);
  const providerRef = status?.id;
  const rawStatus = status?.status.toLowerCase();
  const mapped = rawStatus ? META_STATUS[rawStatus] : undefined;
  if (!providerRef || !mapped) {
    throw new MetaCloudError(
      "whatsapp_unparseable_dlr",
      "Unparseable or unmapped Meta Cloud status callback.",
    );
  }
  const occurredAt = timestampToIso(status?.timestamp);
  const errorCode = errorCodeFor(status);
  return {
    providerRef,
    status: mapped,
    ...(errorCode ? { errorCode } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    raw: payload,
  };
}

function firstStatus(payload: unknown): MetaStatus | null {
  const parsed = metaDlrSchema.safeParse(payload);
  if (!parsed.success) return null;
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const first = change.value.statuses?.[0];
      if (first) return first;
    }
  }
  return null;
}

function errorCodeFor(status: MetaStatus | null): string | undefined {
  const code = status?.errors?.[0]?.code;
  return typeof code === "number" || typeof code === "string"
    ? String(code)
    : undefined;
}

function timestampToIso(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return undefined;
  return new Date(numeric * 1000).toISOString();
}
