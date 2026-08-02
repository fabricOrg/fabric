"use client";

import type { MessageClass } from "@app/contracts";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { LocaleSelect } from "@app/ui/components/ui/locale-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { useEffect, useState } from "react";
import { AUTHORING_LOCALES } from "@/lib/locales";

interface SenderOption {
  senderId: string;
  country: string;
  status: string;
}

/**
 * The delivery triple: locale, message class, sender.
 *
 * All three are SELECTS. Locale and sender were free text, which asked the author to recall a BCP-47
 * tag and an exact registered sender string from memory — and then failed the submit when they
 * misremembered, with the error rendered at the far end of a long form. The sender list is the
 * workspace's own registered senders, so an unregistered value is no longer expressible.
 */
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
  const [senders, setSenders] = useState<readonly SenderOption[] | null>(null);
  const [sendersFailed, setSendersFailed] = useState(false);

  useEffect(() => {
    let current = true;
    fetch("/api/dashboard/senders")
      .then(async (response) => {
        if (!response.ok) throw new Error("senders unavailable");
        return (await response.json()) as { senders?: SenderOption[] };
      })
      .then((payload) => {
        if (current) setSenders(payload.senders ?? []);
      })
      .catch(() => {
        if (current) setSendersFailed(true);
      });
    return () => {
      current = false;
    };
  }, []);

  // DEDUPED BY SENDER ID, countries merged into the label. One sender string can be registered in
  // several countries (AKWAAH is live in both GH and NG), and the form's value IS that string — so
  // emitting one option per registration produced two options with an identical `value`, which made
  // Radix tick both rows at once and React warn about duplicate keys.
  const loading = senders === null && !sendersFailed;
  const byId = new Map<string, string[]>();
  for (const sender of senders ?? []) {
    if (sender.status !== "active") continue;
    const countries = byId.get(sender.senderId) ?? [];
    if (sender.country && !countries.includes(sender.country)) {
      countries.push(sender.country);
    }
    byId.set(sender.senderId, countries);
  }
  // Keep a value the definition already carries selectable even if that sender is gone.
  if (senderId && !byId.has(senderId)) byId.set(senderId, []);
  const senderOptions = [...byId.entries()].map(([id, countries]) => ({
    senderId: id,
    countries,
  }));

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field>
        <FieldLabel htmlFor="def-locale">Default locale</FieldLabel>
        <LocaleSelect
          id="def-locale"
          value={locale}
          onChange={onLocaleChange}
          locales={AUTHORING_LOCALES}
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
        <Select
          value={senderId}
          onValueChange={onSenderIdChange}
          disabled={loading || senderOptions.length === 0}
        >
          <SelectTrigger id="def-sender">
            <SelectValue
              placeholder={
                // "Loading" and "none" are different states: claiming there are no sender IDs before
                // the request has answered is the empty-vs-error conflation, and it tells the author
                // to go register one they already have.
                loading
                  ? "Loading sender IDs…"
                  : sendersFailed
                    ? "Sender IDs unavailable"
                    : senderOptions.length === 0
                      ? "No active sender IDs"
                      : "Select a sender ID"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {senderOptions.map((sender) => (
              <SelectItem key={sender.senderId} value={sender.senderId}>
                {sender.senderId}
                {sender.countries.length > 0
                  ? ` · ${sender.countries.join(", ")}`
                  : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          {loading
            ? "Reading your registered sender IDs…"
            : sendersFailed
              ? "Couldn't load your sender IDs — refresh to try again."
              : senderOptions.length === 0
                ? "Register and activate a sender ID before authoring a definition."
                : "Reviewed with this version and bound to sandbox configuration."}
        </FieldDescription>
      </Field>
    </div>
  );
}
