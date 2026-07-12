import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  Check,
  Circle,
  type LucideIcon,
  MessageSquare,
  Send,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { OverviewSummary } from "@/lib/client/overview-api";
import type { SenderId } from "@/lib/client/senders-api";

interface Step {
  title: string;
  description: string;
  href: string;
  action: string;
  complete: boolean;
  icon: LucideIcon;
}

export function ActivationChecklist({
  summary,
  senders,
}: {
  summary: OverviewSummary;
  senders?: readonly SenderId[];
}) {
  const funded = BigInt(summary.walletBalance.minor) > 0n;
  const activeSender =
    senders?.some((sender) => sender.status === "active") ?? false;
  const sent = summary.messagesSent > 0;
  const steps: Step[] = [
    {
      title: "Register a sender ID",
      description: activeSender
        ? "An approved identity is ready for sending."
        : "Carrier approval is required before live branded sends.",
      href: "/senders",
      action: activeSender ? "View sender IDs" : "Request sender ID",
      complete: activeSender,
      icon: Circle,
    },
    {
      title: "Fund your wallet",
      description: funded
        ? "Your wallet can cover message charges."
        : "Add funds so a send can reserve its estimated cost.",
      href: "/wallet",
      action: funded ? "View billing" : "Top up wallet",
      complete: funded,
      icon: Wallet,
    },
    {
      title: "Send your first SMS",
      description: sent
        ? "Your first message has entered the delivery pipeline."
        : "Run a sandbox send and review its preflight checks.",
      href: "/send",
      action: sent ? "Send another" : "Send SMS",
      complete: sent,
      icon: Send,
    },
    {
      title: "Confirm delivery",
      description: sent
        ? "Inspect provider status, delivery timeline, and cost."
        : "Delivery records appear after your first send.",
      href: "/messages",
      action: "Open message log",
      complete: sent && summary.deliveryRate > 0,
      icon: MessageSquare,
    },
  ];
  const complete = steps.filter((step) => step.complete).length;
  const remaining = steps.filter((step) => !step.complete);

  if (complete === steps.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {complete > 0 ? "Next setup step" : "Set up your workspace"}
        </CardTitle>
        <CardDescription>
          {complete} of {steps.length} steps complete. Follow this path to a
          verified first delivery.
        </CardDescription>
      </CardHeader>
      <CardContent
        className={
          remaining.length > 1 ? "grid gap-3 md:grid-cols-2" : undefined
        }
      >
        {remaining.map((step) => {
          const Icon = step.icon;
          return (
            <div
              key={step.title}
              className="flex min-w-0 gap-3 rounded-lg border p-3"
            >
              <span
                className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md ${step.complete ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
              >
                {step.complete ? (
                  <Check className="size-4" />
                ) : (
                  <Icon className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {step.description}
                </p>
                <Button
                  asChild
                  variant="link"
                  size="sm"
                  className="mt-1 h-auto p-0"
                >
                  <Link href={step.href}>{step.action}</Link>
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
