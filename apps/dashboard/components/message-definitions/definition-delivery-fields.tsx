"use client";

import type { MessageClass } from "@app/contracts";
import {
  Field,
  FieldDescription,
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

export function DefinitionDeliveryFields({
  locale,
  messageClass,
  senderId,
  onLocaleChange,
  onMessageClassChange,
  onSenderIdChange,
}: {
  locale: string;
  messageClass: MessageClass;
  senderId: string;
  onLocaleChange: (locale: string) => void;
  onMessageClassChange: (messageClass: MessageClass) => void;
  onSenderIdChange: (senderId: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field>
        <FieldLabel htmlFor="def-locale">Default locale</FieldLabel>
        <Input
          id="def-locale"
          value={locale}
          onChange={(event) => onLocaleChange(event.target.value)}
          placeholder="en"
        />
        <FieldDescription>Used when no locale is requested.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="def-class">Message class</FieldLabel>
        <Select value={messageClass} onValueChange={onMessageClassChange}>
          <SelectTrigger id="def-class">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="transactional">Transactional</SelectItem>
            <SelectItem value="promotional">Promotional</SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>
          Controls consent and quiet-hour rules.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="def-sender">Sandbox sender</FieldLabel>
        <Input
          id="def-sender"
          maxLength={11}
          value={senderId}
          onChange={(event) => onSenderIdChange(event.target.value)}
          placeholder="FABRIC"
        />
        <FieldDescription>
          Reviewed with this version and bound to sandbox configuration.
        </FieldDescription>
      </Field>
    </div>
  );
}
