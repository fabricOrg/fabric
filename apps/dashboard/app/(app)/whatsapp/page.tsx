"use client";

import {
  parseApiError,
  type WhatsappMessageListResponse,
  whatsappMessageListResponse,
} from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  TableEmptyState,
  TableLoadingState,
} from "@app/ui/components/ui/states";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { WhatsappSendForm } from "@/components/forms/whatsapp-send-form";
import { WhatsappMessagesTable } from "@/components/tables/whatsapp-messages-table";

async function fetchWhatsappMessages(): Promise<WhatsappMessageListResponse> {
  const response = await fetch("/api/dashboard/whatsapp");
  const payload: unknown = await response.json();
  if (!response.ok) throw payload;
  return whatsappMessageListResponse.parse(payload);
}

export default function WhatsappPage() {
  const queryClient = useQueryClient();
  const messages = useQuery({
    queryKey: ["whatsapp-messages"],
    queryFn: fetchWhatsappMessages,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  function messageList() {
    if (messages.isError) {
      const err = parseApiError(messages.error);
      return (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t load WhatsApp messages</AlertTitle>
          <AlertDescription>
            <p>{err.message}</p>
            {err.requestId ? (
              <p>
                Contact support with{" "}
                <code className="font-mono">{err.requestId}</code>.
              </p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => messages.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    if (messages.isPending) {
      return <TableLoadingState />;
    }

    if (messages.data.messages.length === 0) {
      return (
        <TableEmptyState
          title="No WhatsApp messages yet"
          description="Send a template message from this page and its masked delivery record appears here."
        />
      );
    }

    return <WhatsappMessagesTable messages={messages.data.messages} />;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          WhatsApp
        </h1>
        <p className="text-sm text-muted-foreground">
          Send approved WhatsApp templates and monitor recent delivery outcomes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Send template</CardTitle>
          <CardDescription>
            The selected workspace environment resolves server-side before the
            send pipeline runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WhatsappSendForm
            onSent={() => {
              void queryClient.invalidateQueries({
                queryKey: ["whatsapp-messages"],
              });
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Message log</CardTitle>
          <CardDescription>
            Status, template, masked recipient, cost, and creation time.
          </CardDescription>
        </CardHeader>
        <CardContent>{messageList()}</CardContent>
      </Card>
    </div>
  );
}
