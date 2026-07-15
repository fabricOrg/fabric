import type { Encoding, MessageClass, SmsTemplate } from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Card, CardContent } from "@app/ui/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Textarea } from "@app/ui/components/ui/textarea";
import Link from "next/link";
import type { RecipientReport } from "@/lib/send/preflight";
import { PersonalizeFields, TemplateBar } from "./template-tools";

interface Props {
  readonly to: string;
  readonly onToChange: (value: string) => void;
  readonly report: RecipientReport;
  readonly senderOptions: readonly string[];
  readonly senderId: string;
  readonly onSenderChange: (value: string) => void;
  readonly messageClass: MessageClass;
  readonly onMessageClassChange: (value: MessageClass) => void;
  readonly body: string;
  readonly onBodyChange: (value: string) => void;
  readonly templates: readonly SmsTemplate[];
  readonly selectedTemplateId: string | null;
  readonly onTemplateSelect: (template: SmsTemplate | null) => void;
  readonly encoding: Encoding;
  readonly characters: number;
  readonly segments: number;
  readonly tokens: readonly string[];
  readonly tokenValues: Record<string, string>;
  readonly onTokenValuesChange: (value: Record<string, string>) => void;
}

export function SendComposerFields(props: Props) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <Field
          data-invalid={
            props.report.invalid > 0 || props.report.raw > 1 || undefined
          }
        >
          <FieldLabel htmlFor="to">Recipient</FieldLabel>
          <Input
            id="to"
            inputMode="tel"
            placeholder="+233201234567"
            value={props.to}
            onChange={(event) => props.onToChange(event.target.value.trim())}
            aria-invalid={
              props.report.invalid > 0 || props.report.raw > 1 || undefined
            }
          />
          {props.report.raw > 1 ? (
            <FieldError>
              Enter one recipient. Use Campaigns for an audience send.
            </FieldError>
          ) : props.report.invalid > 0 ? (
            <FieldError>
              Enter a valid E.164 number such as +233201234567.
            </FieldError>
          ) : props.report.suppressed.length > 0 ? (
            <FieldError>This recipient has opted out.</FieldError>
          ) : (
            <FieldDescription>
              One controlled recipient. Carrier delivery may incur a real
              charge.
            </FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor="sender">From (Sender ID)</FieldLabel>
          {props.senderOptions.length > 0 ? (
            <Select value={props.senderId} onValueChange={props.onSenderChange}>
              <SelectTrigger id="sender">
                <SelectValue placeholder="Choose a sender ID" />
              </SelectTrigger>
              <SelectContent>
                {props.senderOptions.map((sender) => (
                  <SelectItem key={sender} value={sender}>
                    {sender}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Alert>
              <AlertTitle>No active sender ID</AlertTitle>
              <AlertDescription>
                Register and activate a sender for this destination before using
                live delivery.{" "}
                <Link className="underline" href="/senders">
                  Open Sender IDs
                </Link>
              </AlertDescription>
            </Alert>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor="message-class">
            Message classification
          </FieldLabel>
          <Select
            value={props.messageClass}
            onValueChange={(value) => {
              if (value === "transactional" || value === "promotional") {
                props.onMessageClassChange(value);
              }
            }}
          >
            <SelectTrigger id="message-class">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="transactional">
                Transactional — OTP, receipt, account alert
              </SelectItem>
              <SelectItem value="promotional">
                Promotional — marketing or offer
              </SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>
            Promotional messages enforce DND and local quiet hours.
          </FieldDescription>
        </Field>

        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="body">Message</FieldLabel>
            <TemplateBar
              templates={props.templates}
              selectedId={props.selectedTemplateId}
              onSelect={props.onTemplateSelect}
            />
          </div>
          <Textarea
            id="body"
            rows={6}
            placeholder="Type your message… use {{name}} for personalization."
            value={props.body}
            onChange={(event) => props.onBodyChange(event.target.value)}
          />
          {props.body.length > 0 ? (
            <FieldDescription className="tabular-nums">
              {props.encoding === "gsm7" ? "GSM-7" : "UCS-2"} ·{" "}
              {props.characters} chars · {props.segments} segment
              {props.segments === 1 ? "" : "s"}
            </FieldDescription>
          ) : null}
        </Field>
        <PersonalizeFields
          tokens={props.tokens}
          values={props.tokenValues}
          onChange={props.onTokenValuesChange}
          body={props.body}
        />
      </CardContent>
    </Card>
  );
}
