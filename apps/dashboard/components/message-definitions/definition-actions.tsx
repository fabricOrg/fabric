"use client";

import type { MessageDefinitionState } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@app/ui/components/ui/dropdown-menu";
import { Archive, Check, MoreHorizontal, Pencil, Upload } from "lucide-react";
import Link from "next/link";
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
 * Publish / archive / edit for one definition, in two shapes from one implementation.
 *
 * `buttons` is the detail page, where the actions are the point of the screen. `menu` is the list
 * card, where they must not compete with scanning — a row of three buttons per card turns a list into
 * a wall of verbs, and the same three operations behind one "More" trigger keep the card readable
 * while saving a round-trip through the detail page for the common ones.
 *
 * The logic is shared deliberately: two copies of "publish this version to sandbox" would be two
 * places to get the environment or the version id wrong.
 */
export function DefinitionActions({
  state,
  canPublish,
  applicationSlug,
  variant = "buttons",
}: {
  state: MessageDefinitionState;
  canPublish: boolean;
  /** Carried into the new-version page's URL so it resolves the same application as the list. */
  applicationSlug?: string;
  variant?: "buttons" | "menu";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { definition, latest_version: latestVersion } = state;
  const newVersionHref = `/message-definitions/${encodeURIComponent(definition.key)}/new-version${
    applicationSlug ? `?application=${encodeURIComponent(applicationSlug)}` : ""
  }`;
  // Is the latest version ALREADY released? A release row carries an `environment_id` uuid rather than
  // a type, but the API refuses every environment except sandbox (`live_publish_unsupported`), so a
  // release for this version can only be the sandbox one. Without this the button stayed enabled after
  // a successful publish and re-publishing was a no-op that looked like an action.
  const latestReleased =
    !!latestVersion &&
    state.releases.some((release) => release.version_id === latestVersion.id);

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

  const publish = () =>
    run(
      () =>
        post(`/api/dashboard/message-definitions/${definition.id}/publish`, {
          environment: "sandbox",
          version_id: latestVersion?.id,
        }),
      "Published to sandbox",
    );
  const archive = () =>
    run(
      () =>
        post(`/api/dashboard/message-definitions/${definition.id}/archive`, {}),
      "Definition archived",
    );

  if (definition.status === "archived") {
    return <span className="text-muted-foreground text-xs">Archived</span>;
  }

  if (variant === "menu") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={busy}
            aria-label={`Actions for ${definition.key}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {latestVersion ? (
            <DropdownMenuItem asChild>
              <Link href={newVersionHref}>
                <Pencil />
                New version
              </Link>
            </DropdownMenuItem>
          ) : null}
          {canPublish ? (
            <DropdownMenuItem
              disabled={!latestVersion || latestReleased}
              onSelect={publish}
            >
              {latestReleased ? <Check /> : <Upload />}
              {latestReleased ? "Published to sandbox" : "Publish to sandbox"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={archive}>
            <Archive />
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:flex-col lg:items-stretch">
      {latestVersion ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={newVersionHref}>
            <Pencil data-icon="inline-start" />
            New version
          </Link>
        </Button>
      ) : null}
      {canPublish ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !latestVersion || latestReleased}
          onClick={publish}
        >
          {latestReleased ? <Check data-icon="inline-start" /> : null}
          {latestReleased ? "Published to sandbox" : "Publish to sandbox"}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={busy} onClick={archive}>
        Archive
      </Button>
    </div>
  );
}
