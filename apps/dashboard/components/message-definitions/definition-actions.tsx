"use client";

import type { MessageDefinitionState } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CreateDefinitionDialog } from "./create-definition-dialog";

interface BffErrorPayload {
  error?: { message?: string };
}

async function post(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as BffErrorPayload | null;
    throw new Error(payload?.error?.message ?? "Request failed.");
  }
}

export function DefinitionActions({
  state,
  canPublish,
}: {
  state: MessageDefinitionState;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { definition, latest_version: latestVersion } = state;

  async function run(action: () => Promise<void>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      toast.success(successMessage);
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (definition.status === "archived") {
    return <span className="text-xs text-muted-foreground">Archived</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Editing is SMS-only for now — the email authoring dialog is SDK-007 slice 4e. An email
          definition is authored via the API and shown read-only until then. */}
      {latestVersion && latestVersion.channel === "sms" ? (
        <CreateDefinitionDialog
          initialDefinition={state}
          triggerLabel="Edit"
          triggerVariant="outline"
        />
      ) : null}
      {canPublish ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !latestVersion}
          onClick={() =>
            run(
              () =>
                post(
                  `/api/dashboard/message-definitions/${definition.id}/publish`,
                  {
                    environment: "sandbox",
                    version_id: latestVersion?.id,
                  },
                ),
              "Published to sandbox",
            )
          }
        >
          Publish to sandbox
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() =>
          run(
            () =>
              post(
                `/api/dashboard/message-definitions/${definition.id}/archive`,
                {},
              ),
            "Definition archived",
          )
        }
      >
        Archive
      </Button>
    </div>
  );
}
