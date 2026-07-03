"use client";

import type { ApiKey, ApiKeyEnv } from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/ui/dialog";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Check, Copy, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toastApiError } from "@/lib/error-toast";
import { AVAILABLE_SCOPES } from "@/lib/fixtures";
import { createApiKey } from "@/lib/mock-api";

/**
 * Create-key flow. Two phases in one dialog: (1) form (name · env · scopes) → (2) ONCE-ONLY reveal of
 * the full secret with an unmistakable "you won't see this again" warning, copy, then masked forever.
 */
export function CreateKeyDialog({
  onCreated,
}: {
  onCreated: (key: ApiKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [env, setEnv] = useState<ApiKeyEnv>("test");
  const [scopes, setScopes] = useState<string[]>(["sms:send"]);
  const [submitting, setSubmitting] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setName("");
    setEnv("test");
    setScopes(["sms:send"]);
    setSecret(null);
    setCopied(false);
    setSubmitting(false);
  }

  function toggleScope(s: string) {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  async function submit() {
    setSubmitting(true);
    try {
      const result = await createApiKey({ name: name.trim(), env, scopes });
      setSecret(result.secret);
      onCreated(result.key);
    } catch (envelope) {
      toastApiError(envelope);
    } finally {
      setSubmitting(false);
    }
  }

  const canCreate = name.trim().length > 0 && scopes.length > 0 && !submitting;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          Create key
        </Button>
      </DialogTrigger>
      <DialogContent>
        {secret === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Name it, pick an environment and scopes. The secret is shown
                once after creation.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="key-name">Name</FieldLabel>
                <Input
                  id="key-name"
                  placeholder="e.g. Production API"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="key-env">Environment</FieldLabel>
                <Select
                  value={env}
                  onValueChange={(v) => setEnv(v as ApiKeyEnv)}
                >
                  <SelectTrigger id="key-env">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">
                      Test — sandbox, never charges or sends
                    </SelectItem>
                    <SelectItem value="live">
                      Live — real money and delivery
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Scopes</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_SCOPES.map((s) => {
                    const on = scopes.includes(s);
                    return (
                      <Button
                        key={s}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        className="font-mono"
                        onClick={() => toggleScope(s)}
                      >
                        {on ? <Check data-icon="inline-start" /> : null}
                        {s}
                      </Button>
                    );
                  })}
                </div>
              </Field>
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={!canCreate}>
                {submitting ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy your secret key now</DialogTitle>
              <DialogDescription>
                This is the only time you'll see the full key. Store it
                somewhere safe.
              </DialogDescription>
            </DialogHeader>
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>You won't be able to see this again</AlertTitle>
              <AlertDescription>
                After you close this dialog only the key's prefix is shown. If
                you lose it, revoke and create a new one.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={secret}
                className="font-mono text-sm"
                aria-label="Secret API key"
              />
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(secret);
                  setCopied(true);
                }}
                aria-label="Copy secret key"
              >
                {copied ? (
                  <Check data-icon="inline-start" />
                ) : (
                  <Copy data-icon="inline-start" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
