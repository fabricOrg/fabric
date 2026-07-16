"use client";

import { Button } from "@app/ui/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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

/**
 * Owner/admin actions on a definition (SDK-003 slice 6): publish the latest version to sandbox, or
 * archive. Rendered only when the session can manage; the BFF re-checks the role.
 */
export function DefinitionActions({
  id,
  latestVersionId,
  status,
  canPublish,
}: {
  id: string;
  latestVersionId: string | null;
  status: "draft" | "active" | "archived";
  canPublish: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await action();
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "archived") {
    return <span className="text-xs text-muted-foreground">Archived</span>;
  }

  return (
    <div className="flex items-center gap-2">
      {canPublish ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !latestVersionId}
          onClick={() =>
            run(
              () =>
                post(`/api/dashboard/message-definitions/${id}/publish`, {
                  environment: "sandbox",
                  version_id: latestVersionId,
                }),
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
            () => post(`/api/dashboard/message-definitions/${id}/archive`, {}),
            "Definition archived",
          )
        }
      >
        Archive
      </Button>
    </div>
  );
}
