"use client";

import type {
  CommercialOfferVersionDto,
  CommercialOfferWithVersions,
  Currency,
} from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { OfferTermsDialog } from "@/components/forms/offer-terms-dialog";
import { ReasonPrompt } from "@/components/offer-reason-prompt";
import {
  cloneVersion,
  OfferError,
  publishVersion,
  retireVersion,
} from "@/lib/client/commercial-offers-api";
import { formatMoney } from "@/lib/money";

type PendingAction = { kind: "publish" | "retire"; version: string } | null;

/**
 * A version's whole life: draft → published → retired, newest first.
 *
 * Publish is DISABLED for the version's own author with the reason stated inline. The api enforces the
 * same rule (and so does a database CHECK), but a button that explains itself is better than one that
 * fails — separation of duties is a policy staff should be able to see, not discover.
 */
export function OfferVersionHistory({
  offer,
  canManage,
  actorStaffId,
}: {
  offer: CommercialOfferWithVersions;
  canManage: boolean;
  actorStaffId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CommercialOfferVersionDto | null>(
    null,
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);

  if (offer.versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No terms yet — add a draft to price this offer.
      </p>
    );
  }

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      setPending(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof OfferError ? error.message : "The action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {offer.versions.map((version) => {
        const ownAuthor = version.created_by === actorStaffId;
        return (
          <div
            key={version.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <div className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">v{version.version}</span>
                <StatusBadge status={version.status} />
                <span className="tabular-nums">
                  {version.total_units} {offer.unit_code}s ·{" "}
                  {formatMoney({
                    currency: version.currency as Currency,
                    minor: version.total_price_minor,
                  })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Authored by {version.created_by_email ?? version.created_by}
                {version.approved_by_email
                  ? ` · approved by ${version.approved_by_email}`
                  : null}
                {version.cost_snapshot
                  ? ` · worst-case margin ${(version.cost_snapshot.worst_case_margin_bps / 100).toFixed(2)}%`
                  : null}
              </p>
            </div>

            {canManage ? (
              <div className="flex flex-wrap gap-2">
                {version.status === "draft" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(version);
                        setEditorOpen(true);
                      }}
                    >
                      Edit terms
                    </Button>
                    <Button
                      size="sm"
                      disabled={ownAuthor || busy}
                      title={
                        ownAuthor
                          ? "You authored this version — another staff admin must publish it."
                          : undefined
                      }
                      onClick={() =>
                        setPending({ kind: "publish", version: version.id })
                      }
                    >
                      Publish
                    </Button>
                  </>
                ) : null}
                {version.status === "published" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setPending({ kind: "retire", version: version.id })
                    }
                  >
                    Retire
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => cloneVersion(version.id),
                      `Cloned v${version.version} into a new draft.`,
                    )
                  }
                >
                  Clone
                </Button>
              </div>
            ) : null}

            {ownAuthor && version.status === "draft" && canManage ? (
              <p className="w-full text-xs text-muted-foreground">
                You authored this version, so another staff admin must publish
                it.
              </p>
            ) : null}
          </div>
        );
      })}

      {editing ? (
        <OfferTermsDialog
          offer={offer}
          version={editing}
          open={editorOpen}
          onOpenChange={(open) => {
            setEditorOpen(open);
            if (!open) setEditing(null);
          }}
        />
      ) : null}

      <ReasonPrompt
        open={pending !== null}
        busy={busy}
        title={
          pending?.kind === "retire"
            ? "Retire this version"
            : "Publish this version"
        }
        description={
          pending?.kind === "retire"
            ? "Retirement withdraws the offer from sale. Every purchased term stays exactly as sold."
            : "Publishing makes these terms sellable and immutable. The reason is recorded in the audit log."
        }
        confirmLabel={pending?.kind === "retire" ? "Retire" : "Publish"}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => {
          if (!pending) return;
          const { kind, version } = pending;
          void run(
            () =>
              kind === "retire"
                ? retireVersion(version, reason)
                : publishVersion(version, reason),
            kind === "retire" ? "Version retired." : "Version published.",
          );
        }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "published") {
    return (
      <Badge className="border-transparent bg-success/12 text-success">
        Published
      </Badge>
    );
  }
  if (status === "retired") {
    return <Badge variant="outline">Retired</Badge>;
  }
  return (
    <Badge className="border-transparent bg-primary/12 text-primary">
      Draft
    </Badge>
  );
}
