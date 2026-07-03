"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { ArrowRight, CheckCheck, ShieldQuestion, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PROPOSALS } from "@/lib/mock-admin";

const KIND_LABEL: Record<string, string> = {
  wallet_adjustment: "Wallet adjustment",
  plan_change: "Plan change",
  refund: "Refund",
};

export default function MakerCheckerPage() {
  const [resolved, setResolved] = useState<
    Record<string, "approved" | "rejected">
  >({});
  const pending = PROPOSALS.filter((p) => !resolved[p.id]);

  function decide(
    id: string,
    decision: "approved" | "rejected",
    tenant: string,
  ) {
    // Mock — TODO(BFF): the second operator's decision + reason is recorded to the audit log.
    setResolved((r) => ({ ...r, [id]: decision }));
    toast[decision === "approved" ? "success" : "message"](
      `${KIND_LABEL[PROPOSALS.find((p) => p.id === id)?.kind ?? ""]} ${decision} for ${tenant}`,
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Maker-checker
        </h1>
        <p className="text-sm text-muted-foreground">
          Sensitive changes need a second operator to approve.
        </p>
      </div>

      <Alert>
        <Users />
        <AlertTitle>Two-person rule</AlertTitle>
        <AlertDescription>
          You can only approve changes proposed by <em>another</em> operator —
          never your own. Every decision is logged with your reason.
        </AlertDescription>
      </Alert>

      {pending.length === 0 ? (
        <Empty className="mx-auto max-w-2xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCheck />
            </EmptyMedia>
            <EmptyTitle>Queue clear</EmptyTitle>
            <EmptyDescription>No proposals awaiting review.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {pending.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldQuestion className="size-4 text-muted-foreground" />
                  {KIND_LABEL[p.kind]} · {p.tenant}
                </CardTitle>
                <CardDescription>
                  Proposed by <span className="font-mono">{p.proposedBy}</span>{" "}
                  · {p.at}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <Badge
                    variant="outline"
                    className="border-transparent bg-muted text-muted-foreground line-through"
                  >
                    {p.before}
                  </Badge>
                  <ArrowRight className="size-4 text-muted-foreground" />
                  <Badge
                    variant="outline"
                    className="border-transparent bg-success/12 text-success"
                  >
                    {p.after}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Reason:</span>{" "}
                  {p.reason}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => decide(p.id, "approved", p.tenant)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => decide(p.id, "rejected", p.tenant)}
                  >
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
