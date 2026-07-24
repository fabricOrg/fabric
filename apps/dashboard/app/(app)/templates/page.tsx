"use client";

import type { MessageClass, SmsTemplate } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { Textarea } from "@app/ui/components/ui/textarea";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CreateDefinitionDialog } from "@/components/message-definitions/create-definition-dialog";
import { useDefinitionPermissions } from "@/components/message-definitions/definition-permissions";
import {
  createSmsTemplate,
  deleteSmsTemplate,
  listSmsTemplates,
  updateSmsTemplate,
} from "@/lib/client/sms-templates-api";
import { toastApiError } from "@/lib/error-toast";

interface Draft {
  name: string;
  body: string;
  class: MessageClass;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  body: "",
  class: "transactional",
};

export default function SmsTemplatesPage() {
  const { canWrite: canWriteDefinitions } = useDefinitionPermissions();
  const [templates, setTemplates] = useState<SmsTemplate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    listSmsTemplates()
      .then((items) => {
        if (current) setTemplates(items);
      })
      .catch((error) => {
        if (!current) return;
        setFailed(true);
        setTemplates([]);
        toastApiError(error);
      });
    return () => {
      current = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      const saved = editingId
        ? await updateSmsTemplate(editingId, draft)
        : await createSmsTemplate(draft);
      setTemplates((current) => {
        const withoutSaved = (current ?? []).filter(
          (template) => template.id !== saved.id,
        );
        return [saved, ...withoutSaved];
      });
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
      toast.success(editingId ? "Template updated" : "Template created");
    } catch (error) {
      toastApiError(error);
    } finally {
      setSaving(false);
    }
  }

  async function remove(template: SmsTemplate) {
    if (!window.confirm(`Delete the “${template.name}” template?`)) return;
    try {
      await deleteSmsTemplate(template.id);
      setTemplates((current) =>
        (current ?? []).filter((item) => item.id !== template.id),
      );
      if (editingId === template.id) {
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
      }
      toast.success("Template deleted");
    } catch (error) {
      toastApiError(error);
    }
  }

  function edit(template: SmsTemplate) {
    setEditingId(template.id);
    setDraft({
      name: template.name,
      body: template.body,
      class: template.class,
    });
  }

  const canSave = Boolean(draft.name.trim() && draft.body.trim() && !saving);

  return (
    <PageContainer>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            SMS Templates
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Store reusable message content and apply it from the Send SMS
            composer.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/send">Open Send SMS</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit template" : "New template"}</CardTitle>
          <CardDescription>
            Classification travels with the template and can still be changed
            before sending.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="template-name">Name</FieldLabel>
            <Input
              id="template-name"
              maxLength={80}
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="Payment receipt"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="template-class">Classification</FieldLabel>
            <Select
              value={draft.class}
              onValueChange={(value) => {
                if (value === "transactional" || value === "promotional") {
                  setDraft({ ...draft, class: value });
                }
              }}
            >
              <SelectTrigger id="template-class">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="transactional">Transactional</SelectItem>
                <SelectItem value="promotional">Promotional</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="template-body">Message</FieldLabel>
            <Textarea
              id="template-body"
              rows={5}
              maxLength={1600}
              value={draft.body}
              onChange={(event) =>
                setDraft({ ...draft, body: event.target.value })
              }
              placeholder="Hi {{name}}, we received your payment of {{amount}}."
            />
          </Field>
        </CardContent>
        <CardFooter className="gap-2">
          <Button onClick={save} loading={saving} disabled={!canSave}>
            {editingId ? <Pencil /> : <Plus />}
            {editingId ? "Save changes" : "Create template"}
          </Button>
          {editingId ? (
            <Button
              variant="ghost"
              onClick={() => {
                setEditingId(null);
                setDraft(EMPTY_DRAFT);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </CardFooter>
      </Card>

      {templates === null ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : templates.length === 0 ? (
        <Empty className="min-h-56 rounded-lg border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>
              {failed ? "Couldn’t load templates" : "No SMS templates yet"}
            </EmptyTitle>
            <EmptyDescription>
              {failed
                ? "Try refreshing this page."
                : "Create your first reusable message above."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <Badge variant="secondary">{template.class}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{template.body}</p>
              </CardContent>
              <CardFooter className="gap-2">
                {canWriteDefinitions ? (
                  <CreateDefinitionDialog
                    initialTemplate={template}
                    triggerLabel="Create definition"
                    triggerVariant="outline"
                  />
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => edit(template)}
                >
                  <Pencil />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(template)}
                  aria-label={`Delete ${template.name}`}
                >
                  <Trash2 />
                  Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
