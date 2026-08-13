import type { MessagingSettings } from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { WorkflowHeader } from "@app/ui/components/ui/workflow-header";
import { CheckCircle2, Radio, Smartphone } from "lucide-react";
import Link from "next/link";
import type { sendSms } from "@/lib/client/dashboard-api";
import { formatMoney } from "@/lib/money";

export function SendPageHeading() {
  return (
    <WorkflowHeader
      title="Send SMS"
      description="Compose a controlled SMS and review cost before sending."
    />
  );
}

export function DeliveryModeAlert({
  settings,
}: {
  settings: MessagingSettings;
}) {
  const virtual = settings.delivery_mode === "virtual";
  const Icon = virtual ? Smartphone : Radio;
  return (
    <Alert className={virtual ? undefined : "border-warning/50"}>
      <Icon aria-hidden />
      <AlertTitle>
        {virtual ? "Virtual phone" : "Controlled live delivery"}
      </AlertTitle>
      <AlertDescription>
        {virtual
          ? "No carrier send. Delivery appears in your virtual phone."
          : "Live carrier delivery charges your wallet."}
        {settings.reason ? ` ${settings.reason}` : ""}
      </AlertDescription>
    </Alert>
  );
}

export function SendLoadingState() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[1fr_22rem]"
      role="status"
      aria-label="Loading send context"
    >
      <Skeleton className="h-[34rem] w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

export function SendLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>Send context unavailable</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>We could not load the required send context.</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function SendErrorAlert({
  error,
}: {
  error: { message: string; requestId?: string };
}) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>Message not sent</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{error.message}</span>
        {error.requestId ? (
          <span className="text-xs">
            Support reference:{" "}
            <code className="font-mono">{error.requestId}</code>
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function SendSuccessState({
  result,
  deliveryMode,
  onReset,
}: {
  result: Awaited<ReturnType<typeof sendSms>>;
  deliveryMode: MessagingSettings["delivery_mode"];
  onReset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
        <CheckCircle2 className="size-7" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Message accepted
        </h2>
        <p className="text-muted-foreground text-sm">
          The API charged{" "}
          <span className="font-mono tabular-nums">
            {formatMoney(result.cost)}
          </span>
          .{" "}
          {deliveryMode === "virtual"
            ? "Open the virtual phone to inspect delivery."
            : "Track the carrier result in Messages."}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onReset}>Send another</Button>
        <Button variant="outline" asChild>
          <Link
            href={
              deliveryMode === "virtual"
                ? "/virtual-phone"
                : `/messages?messageId=${encodeURIComponent(result.id)}`
            }
          >
            {deliveryMode === "virtual"
              ? "Open virtual phone"
              : "View delivery record"}
          </Link>
        </Button>
      </div>
    </div>
  );
}
