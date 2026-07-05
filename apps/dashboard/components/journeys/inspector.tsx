import { Button } from "@app/ui/components/ui/button";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Textarea } from "@app/ui/components/ui/textarea";
import { Trash2 } from "lucide-react";
import {
  type JourneyConfig,
  type JourneyNode,
  NODE_META,
} from "@/lib/journeys/schema";

export interface NodePatch {
  readonly label?: string;
  readonly config?: JourneyConfig;
}

/** Config panel for the selected node. Empty state prompts selection. */
export function Inspector({
  node,
  onChange,
  onDelete,
}: {
  node: JourneyNode | null;
  onChange: (id: string, patch: NodePatch) => void;
  onDelete: (id: string) => void;
}) {
  if (!node) {
    return (
      <p className="p-1 text-sm text-muted-foreground">
        Select a step to configure it.
      </p>
    );
  }

  const meta = NODE_META[node.data.kind];
  const c = node.data.config;
  const setConfig = (patch: JourneyConfig) =>
    onChange(node.id, { config: { ...c, ...patch } });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {meta.label}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(node.id)}
          aria-label="Delete step"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <Field>
        <FieldLabel htmlFor="node-label">Name</FieldLabel>
        <Input
          id="node-label"
          value={node.data.label}
          onChange={(e) => onChange(node.id, { label: e.target.value })}
        />
      </Field>

      {node.data.kind === "trigger" ? (
        <Field>
          <FieldLabel htmlFor="trigger-event">Starts when</FieldLabel>
          <Select
            value={c.event ?? "api_event"}
            onValueChange={(v) => setConfig({ event: v })}
          >
            <SelectTrigger id="trigger-event">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="api_event">An API event fires</SelectItem>
              <SelectItem value="contact_added">A contact is added</SelectItem>
              <SelectItem value="inbound_message">
                An inbound message arrives
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {node.data.kind === "sendSms" ? (
        <>
          <Field>
            <FieldLabel htmlFor="sms-sender">Sender ID</FieldLabel>
            <Input
              id="sms-sender"
              value={c.senderId ?? ""}
              onChange={(e) => setConfig({ senderId: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sms-body">Message</FieldLabel>
            <Textarea
              id="sms-body"
              rows={4}
              value={c.body ?? ""}
              onChange={(e) => setConfig({ body: e.target.value })}
              placeholder="Use {{name}} for personalization."
            />
          </Field>
        </>
      ) : null}

      {node.data.kind === "sendWhatsApp" ? (
        <>
          <Field>
            <FieldLabel htmlFor="wa-template">Template</FieldLabel>
            <Input
              id="wa-template"
              value={c.template ?? ""}
              onChange={(e) => setConfig({ template: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="wa-body">Body</FieldLabel>
            <Textarea
              id="wa-body"
              rows={3}
              value={c.body ?? ""}
              onChange={(e) => setConfig({ body: e.target.value })}
            />
          </Field>
        </>
      ) : null}

      {node.data.kind === "sendVoice" ? (
        <Field>
          <FieldLabel htmlFor="voice-script">Call script</FieldLabel>
          <Textarea
            id="voice-script"
            rows={4}
            value={c.script ?? ""}
            onChange={(e) => setConfig({ script: e.target.value })}
            placeholder="Spoken to the recipient (text-to-speech)."
          />
        </Field>
      ) : null}

      {node.data.kind === "sendEmail" ? (
        <>
          <Field>
            <FieldLabel htmlFor="email-subject">Subject</FieldLabel>
            <Input
              id="email-subject"
              value={c.subject ?? ""}
              onChange={(e) => setConfig({ subject: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email-body">Body</FieldLabel>
            <Textarea
              id="email-body"
              rows={4}
              value={c.body ?? ""}
              onChange={(e) => setConfig({ body: e.target.value })}
              placeholder="Use {{name}} for personalization."
            />
          </Field>
        </>
      ) : null}

      {node.data.kind === "waitReply" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="reply-timeout">Timeout</FieldLabel>
            <Input
              id="reply-timeout"
              inputMode="numeric"
              value={c.timeout ?? "24"}
              onChange={(e) =>
                setConfig({ timeout: e.target.value.replace(/\D/g, "") })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="reply-unit">Unit</FieldLabel>
            <Select
              value={c.unit ?? "hours"}
              onValueChange={(v) => setConfig({ unit: v })}
            >
              <SelectTrigger id="reply-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
                <SelectItem value="days">Days</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : null}

      {node.data.kind === "condition" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="cond-attr">Attribute</FieldLabel>
            <Input
              id="cond-attr"
              value={c.attribute ?? ""}
              onChange={(e) => setConfig({ attribute: e.target.value })}
              placeholder="country"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cond-equals">Equals</FieldLabel>
            <Input
              id="cond-equals"
              value={c.equals ?? ""}
              onChange={(e) => setConfig({ equals: e.target.value })}
              placeholder="GH"
            />
          </Field>
        </div>
      ) : null}

      {node.data.kind === "loop" ? (
        <>
          <Field>
            <FieldLabel htmlFor="loop-mode">Repeat</FieldLabel>
            <Select
              value={c.mode ?? "count"}
              onValueChange={(v) => setConfig({ mode: v })}
            >
              <SelectTrigger id="loop-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">A fixed number of times</SelectItem>
                <SelectItem value="until">Until a condition is met</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {(c.mode ?? "count") === "until" ? (
            <Field>
              <FieldLabel htmlFor="loop-cond">Until</FieldLabel>
              <Input
                id="loop-cond"
                value={c.condition ?? ""}
                onChange={(e) => setConfig({ condition: e.target.value })}
                placeholder="delivered"
              />
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="loop-count">Times</FieldLabel>
              <Input
                id="loop-count"
                inputMode="numeric"
                value={c.count ?? "3"}
                onChange={(e) =>
                  setConfig({ count: e.target.value.replace(/\D/g, "") })
                }
              />
            </Field>
          )}
          <p className="text-xs text-muted-foreground">
            The <span className="font-mono">loop</span> output runs each
            iteration; <span className="font-mono">done</span> continues after.
          </p>
        </>
      ) : null}

      {node.data.kind === "goal" ? (
        <Field>
          <FieldLabel htmlFor="goal-name">Goal name</FieldLabel>
          <Input
            id="goal-name"
            value={c.name ?? ""}
            onChange={(e) => setConfig({ name: e.target.value })}
            placeholder="Converted"
          />
        </Field>
      ) : null}

      {node.data.kind === "verify" ? (
        <Field>
          <FieldLabel htmlFor="verify-channel">Channel</FieldLabel>
          <Select
            value={c.channel ?? "sms"}
            onValueChange={(v) => setConfig({ channel: v })}
          >
            <SelectTrigger id="verify-channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="voice">Voice</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {node.data.kind === "wait" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="wait-duration">Duration</FieldLabel>
            <Input
              id="wait-duration"
              inputMode="numeric"
              value={c.duration ?? "1"}
              onChange={(e) =>
                setConfig({ duration: e.target.value.replace(/\D/g, "") })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="wait-unit">Unit</FieldLabel>
            <Select
              value={c.unit ?? "days"}
              onValueChange={(v) => setConfig({ unit: v })}
            >
              <SelectTrigger id="wait-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
                <SelectItem value="days">Days</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : null}

      {node.data.kind === "branch" ? (
        <Field>
          <FieldLabel htmlFor="branch-condition">Split on</FieldLabel>
          <Select
            value={c.condition ?? "delivered"}
            onValueChange={(v) => setConfig({ condition: v })}
          >
            <SelectTrigger id="branch-condition">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="replied">Replied</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {node.data.kind === "end" ? (
        <p className="text-sm text-muted-foreground">
          Marks the end of this path. No configuration.
        </p>
      ) : null}
    </div>
  );
}
