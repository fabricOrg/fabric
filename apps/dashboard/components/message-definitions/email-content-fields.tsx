"use client";

import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import { Textarea } from "@app/ui/components/ui/textarea";

/**
 * Email content authoring fields. `from` is optional — when blank the API applies a synthetic sandbox
 * sender (a verified sending-domain binding is a later, live-gated slice). At least one of text/html
 * must be present (enforced on submit). Tokens such as {{name}} are detected across all three fields.
 */
export function EmailContentFields({
  from,
  subject,
  text,
  html,
  onFromChange,
  onSubjectChange,
  onTextChange,
  onHtmlChange,
}: {
  from: string;
  subject: string;
  text: string;
  html: string;
  onFromChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onHtmlChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel htmlFor="email-from">From (optional)</FieldLabel>
        <Input
          id="email-from"
          type="email"
          value={from}
          onChange={(event) => onFromChange(event.target.value)}
          placeholder="orders@yourdomain.com"
        />
        <FieldDescription>
          Left blank, sandbox sends from a synthetic address. Verified
          sending-domain binding arrives with the live channel.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="email-subject">Subject</FieldLabel>
        <Input
          id="email-subject"
          maxLength={998}
          value={subject}
          onChange={(event) => onSubjectChange(event.target.value)}
          placeholder="Your order {{order.id}} shipped"
        />
        <FieldDescription>
          Single line. Tokens such as {"{{name}}"} are substituted at send.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="email-text">Text body</FieldLabel>
        <Textarea
          id="email-text"
          rows={4}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Hi {{name}}, your order shipped."
        />
        <FieldDescription>
          Plain-text part. Provide this, the HTML part, or both.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="email-html">HTML body</FieldLabel>
        <Textarea
          id="email-html"
          className="font-mono text-xs"
          rows={6}
          value={html}
          onChange={(event) => onHtmlChange(event.target.value)}
          placeholder="<p>Hi {{name}}, your order shipped.</p>"
        />
        <FieldDescription>
          Variable values are HTML-escaped when rendered into this part.
        </FieldDescription>
      </Field>
    </div>
  );
}
