import {
  type Currency,
  type MessageClass,
  type MessagingSettings,
  toMoney,
} from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Separator } from "@app/ui/components/ui/separator";
import type React from "react";
import { formatMoney } from "@/lib/money";
import type { PreflightCheck } from "@/lib/send/preflight";
import { PreflightChecks } from "./preflight-checks";
import { ViewAsApiDialog } from "./view-as-api-dialog";

const CURRENCY: Currency = "GHS";

interface Props {
  readonly checks: readonly PreflightCheck[];
  readonly settings: MessagingSettings;
  readonly senderId: string;
  readonly messageClass: MessageClass;
  readonly segments: number;
  readonly estimateMinor: bigint;
  readonly balanceAfterMinor: bigint;
  readonly insufficient: boolean;
  readonly hasBlock: boolean;
  readonly canSend: boolean;
  readonly sending: boolean;
  readonly recipient: string | null;
  readonly body: string;
  readonly onSubmit: () => void;
}

export function SendReviewSidebar(props: Props) {
  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
      {props.checks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preflight</CardTitle>
            <CardDescription>
              Advisory checks before the API applies authoritative compliance
              and billing gates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PreflightChecks checks={props.checks} />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review & send</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          <ConfirmRow label="From" value={props.senderId || "—"} />
          <ConfirmRow
            label="Delivery"
            value={
              props.settings.delivery_mode === "virtual"
                ? "Virtual phone"
                : "Live carrier"
            }
          />
          <ConfirmRow
            label="Classification"
            value={
              props.messageClass === "transactional"
                ? "Transactional"
                : "Promotional"
            }
          />
          <ConfirmRow
            label="Segments"
            value={<span className="tabular-nums">{props.segments}</span>}
          />
          <Separator className="my-1" />
          {props.settings.delivery_mode === "virtual" ? (
            <ConfirmRow
              label="Sandbox usage"
              value={
                <span className="font-mono font-semibold tabular-nums">
                  {props.segments} segment{props.segments === 1 ? "" : "s"}
                </span>
              }
            />
          ) : (
            <>
              <ConfirmRow
                label="Estimated cost"
                value={
                  <span className="font-mono font-semibold tabular-nums">
                    {formatMoney(toMoney(props.estimateMinor, CURRENCY))}
                  </span>
                }
              />
              <ConfirmRow
                label="Estimated balance after"
                value={
                  <span
                    className={
                      "font-mono tabular-nums " +
                      (props.insufficient ? "text-destructive" : "")
                    }
                  >
                    {formatMoney(toMoney(props.balanceAfterMinor, CURRENCY))}
                  </span>
                }
              />
            </>
          )}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-2">
          <Button
            onClick={props.onSubmit}
            loading={props.sending}
            disabled={!props.canSend}
          >
            Send message
          </Button>
          {!props.canSend && !props.sending ? (
            <p className="text-center text-xs text-muted-foreground">
              {disabledReason(props)}
            </p>
          ) : null}
          <ViewAsApiDialog
            to={props.recipient ? [props.recipient] : []}
            from={props.senderId}
            body={props.body}
            messageClass={props.messageClass}
          />
        </CardFooter>
      </Card>
    </div>
  );
}

function disabledReason(input: {
  recipient: string | null;
  senderId: string;
  body: string;
  insufficient: boolean;
  hasBlock: boolean;
}): string {
  if (!input.recipient) return "Enter one valid, sendable recipient.";
  if (!input.senderId) return "Choose an active sender ID.";
  if (!input.body.trim()) return "Enter a message.";
  if (input.insufficient) return "Top up your wallet before sending.";
  if (input.hasBlock) return "Resolve the blocking preflight check.";
  return "Review the message before sending.";
}

function ConfirmRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}
