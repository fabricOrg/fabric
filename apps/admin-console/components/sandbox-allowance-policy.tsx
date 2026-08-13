"use client";

import type {
  SandboxAllowancePolicy,
  UpdateSandboxAllowancePolicy,
} from "@app/contracts";
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
  // Every field the schema requires is gated here, INCLUDING the schema's upper bound — without it
  // the button enabled for a value the server then rejected, which is an error the operator never
  // needed to see.
  const limit = (value: string) =>
    /^[1-9]\d*$/.test(value) && Number(value) <= 1_000_000_000;
  const valid =
    limit(sms) && limit(email) && limit(whatsapp) && reason.trim().length >= 8;

  /**
   * The body is typed against the contract on purpose. It used to be a bare literal, so when the
   * schema gained `whatsapp_messages_per_day` this component kept compiling and every save 422'd at
   * runtime instead. `satisfies` makes the next added field a build error here.
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
          } satisfies UpdateSandboxAllowancePolicy),
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
    <div className="grid gap-4 sm:grid-cols-3">
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
      <div className="grid gap-2 sm:col-span-3">
        <Label htmlFor="sandbox-limit-reason">Reason for change</Label>
        <Input
          id="sandbox-limit-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="At least 8 characters"
        />
      </div>
      <div className="sm:col-span-3">
        <Button size="sm" loading={busy} disabled={!valid} onClick={save}>
          Save sandbox allowances
        </Button>
      </div>
    </div>
  );
}
