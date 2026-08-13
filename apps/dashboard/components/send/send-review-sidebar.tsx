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
  /**
   * Prepaid credits cover this send in full, so the wallet is untouched. The engine claims tokens
   * before cash, and the claim is all-or-nothing — partial credit cover still charges the wallet.
   */
  readonly tokenBacked: boolean;
  /** SMS credits left once this send claims its segments; null when credits are unknown. */
  readonly creditsAfter: bigint | null;
  /** Segments left in today's sandbox allowance; null on live delivery, where it does not apply. */
  readonly allowanceRemaining: bigint | null;
  readonly allowanceExceeded: boolean;
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
          <ConfirmRow label="From" value={props.senderId || "-"} />
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
            <>
              <ConfirmRow
                label="Sandbox usage"
                value={
                  <span className="font-mono font-semibold tabular-nums">
                    {props.segments} segment{props.segments === 1 ? "" : "s"}
                  </span>
                }
              />
              {props.allowanceRemaining === null ? null : (
                <ConfirmRow
                  label="Allowance left today"
                  value={
                    <span
                      className={
                        "font-mono tabular-nums " +
                        (props.allowanceExceeded ? "text-destructive" : "")
                      }
                    >
                      {props.allowanceRemaining.toString()} segment
                      {props.allowanceRemaining === 1n ? "" : "s"}
                    </span>
                  }
                />
              )}
            </>
          ) : (
            <>
              <ConfirmRow
                label={props.tokenBacked ? "Charged to" : "Estimated cost"}
                value={
                  props.tokenBacked ? (
                    <span className="font-medium">Prepaid credits</span>
                  ) : (
                    <span className="font-mono font-semibold tabular-nums">
                      {formatMoney(toMoney(props.estimateMinor, CURRENCY))}
                    </span>
                  )
                }
              />
              <ConfirmRow
                label={
                  props.tokenBacked
                    ? "Credits after"
                    : "Estimated balance after"
                }
                value={
                  <span
                    className={
                      "font-mono tabular-nums " +
                      (props.insufficient ? "text-destructive" : "")
                    }
                  >
                    {/* Credits are a COUNT, not money — rendering them through formatMoney would
                        print "GHS 159" for 159 SMS segments. */}
                    {props.tokenBacked && props.creditsAfter !== null
                      ? `${props.creditsAfter.toLocaleString("en")} SMS`
                      : formatMoney(toMoney(props.balanceAfterMinor, CURRENCY))}
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
  allowanceExceeded: boolean;
  hasBlock: boolean;
}): string {
  if (!input.recipient) return "Enter one valid, sendable recipient.";
  if (!input.senderId) return "Choose an active sender ID.";
  if (!input.body.trim()) return "Enter a message.";
  if (input.insufficient) return "Top up your wallet before sending.";
  // Never "top up your wallet" here — a sandbox workspace has no wallet to top up, and the
  // allowance refills on its own.
  if (input.allowanceExceeded) {
    return "Not enough sandbox allowance left today.";
  }
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
