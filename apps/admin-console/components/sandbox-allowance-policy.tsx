"use client";

import type { SandboxAllowancePolicy } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import { Input } from "@app/ui/components/ui/input";
import { Label } from "@app/ui/components/ui/label";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function SandboxAllowancePolicyEditor({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: SandboxAllowancePolicy;
}) {
  const router = useRouter();
  const [sms, setSms] = useState(String(initial.sms_segments_per_day));
  const [email, setEmail] = useState(String(initial.email_messages_per_day));
  const [whatsapp, setWhatsapp] = useState(
    String(initial.whatsapp_messages_per_day),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // Every field the schema requires is gated here. WhatsApp was missing from both this check and the
  // body below, so the request was always sent and always rejected — see the note on save().
  const valid =
    /^[1-9]\d*$/.test(sms) &&
    /^[1-9]\d*$/.test(email) &&
    /^[1-9]\d*$/.test(whatsapp) &&
    reason.trim().length >= 8;

  /**
   * The PATCH body must carry ALL THREE limits. `updateSandboxAllowancePolicySchema` requires
   * `whatsapp_messages_per_day` with no default, so omitting it meant every save 422'd — and the
   * route's message named the two limits the operator had entered correctly, pointing away from the
   * field that had no input on the form at all.
   */
  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/tenants/${encodeURIComponent(tenantId)}/sandbox-allowances`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sms_segments_per_day: Number(sms),
            email_messages_per_day: Number(email),
            whatsapp_messages_per_day: Number(whatsapp),
            reason,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Couldn't update sandbox allowances.",
        );
      }
      setReason("");
      toast.success("Sandbox allowances updated");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't update sandbox allowances.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor="sandbox-sms-limit">SMS segments per UTC day</Label>
        <Input
          id="sandbox-sms-limit"
          inputMode="numeric"
          value={sms}
          onChange={(event) => setSms(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sandbox-email-limit">Email messages per UTC day</Label>
        <Input
          id="sandbox-email-limit"
          inputMode="numeric"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sandbox-whatsapp-limit">
          WhatsApp messages per UTC day
        </Label>
        <Input
          id="sandbox-whatsapp-limit"
          inputMode="numeric"
          value={whatsapp}
          onChange={(event) => setWhatsapp(event.target.value)}
        />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="sandbox-limit-reason">Reason for change</Label>
        <Input
          id="sandbox-limit-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="At least 8 characters"
        />
      </div>
      <div className="sm:col-span-2">
        <Button size="sm" loading={busy} disabled={!valid} onClick={save}>
          Save sandbox allowances
        </Button>
      </div>
    </div>
  );
}
