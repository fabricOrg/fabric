"use client";

import {
  type Currency,
  type MessageClass,
  type MessagingSettings,
  parseApiError,
  type SendSmsRequest,
  type SmsTemplate,
} from "@app/contracts";
import { DEFAULT_RATES, encodeAndSegment, rateSegments } from "@app/domain";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { useEffect, useMemo, useRef, useState } from "react";
import { SendComposerFields } from "@/components/send/send-composer-fields";
import {
  DeliveryModeAlert,
  SendErrorAlert,
  SendLoadError,
  SendLoadingState,
  SendPageHeading,
  SendSuccessState,
} from "@/components/send/send-page-states";
import { SendReviewSidebar } from "@/components/send/send-review-sidebar";
import { getConsent, type OptOut } from "@/lib/client/consent-api";
import {
  getMessagingSettings,
  getWallet,
  sendSms,
} from "@/lib/client/dashboard-api";
import { listSenders, type SenderId } from "@/lib/client/senders-api";
import { listSmsTemplates } from "@/lib/client/sms-templates-api";
import {
  buildPreflight,
  buildRecipientReport,
  extractTokens,
  renderTemplate,
} from "@/lib/send/preflight";

const CURRENCY: Currency = "GHS";

interface SendContext {
  readonly balanceMinor: bigint;
  readonly senders: readonly SenderId[];
  readonly optOuts: readonly OptOut[];
  readonly settings: MessagingSettings;
  readonly templates: readonly SmsTemplate[];
}

interface Attempt {
  readonly fingerprint: string;
  readonly key: string;
}

export default function SendPage() {
  const [to, setTo] = useState("");
  const [senderId, setSenderId] = useState("");
  const [messageClass, setMessageClass] =
    useState<MessageClass>("transactional");
  const [body, setBody] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});
  const [context, setContext] = useState<SendContext | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<{
    message: string;
    requestId?: string;
  } | null>(null);
  const [sent, setSent] = useState<Awaited<ReturnType<typeof sendSms>> | null>(
    null,
  );
  const attempt = useRef<Attempt | null>(null);

  useEffect(() => {
    // Incrementing loadVersion is the explicit retry trigger for this required context bundle.
    void loadVersion;
    let current = true;
    setContext(null);
    setLoadFailed(false);
    Promise.all([
      listSenders(),
      getConsent(),
      getMessagingSettings(),
      listSmsTemplates(),
    ])
      .then(async ([senders, consent, settings, templates]) => {
        const balances =
          settings.delivery_mode === "live" ? await getWallet() : [];
        return { balances, senders, consent, settings, templates };
      })
      .then(({ balances, senders, consent, settings, templates }) => {
        if (!current) return;
        const ghs = balances.find(
          (balance) => balance.balance.currency === CURRENCY,
        );
        setContext({
          balanceMinor: ghs ? BigInt(ghs.balance.minor) : 0n,
          senders,
          optOuts: consent.optOuts,
          settings,
          templates,
        });
      })
      .catch(() => {
        if (current) setLoadFailed(true);
      });
    return () => {
      current = false;
    };
  }, [loadVersion]);

  const tokens = useMemo(() => extractTokens(body), [body]);
  const previewBody = useMemo(
    () => (tokens.length > 0 ? renderTemplate(body, tokenValues) : body),
    [body, tokens, tokenValues],
  );
  const report = useMemo(
    () => buildRecipientReport(to, context?.optOuts ?? []),
    [to, context?.optOuts],
  );
  const oneValidRecipient =
    report.raw === 1 && report.valid.length === 1 && report.invalid === 0;
  const recipient = oneValidRecipient ? (report.sendable[0] ?? null) : null;
  const deliveryMode = context?.settings.delivery_mode ?? null;
  const senderOptions = useMemo(() => {
    if (!context || !deliveryMode) return [];
    if (deliveryMode === "virtual") {
      return [
        ...new Set(["Fabric", ...context.senders.map((s) => s.senderId)]),
      ];
    }
    const country = to.trim().startsWith("+234") ? "NG" : "GH";
    return [
      ...new Set(
        context.senders
          .filter((s) => s.status === "active" && s.country === country)
          .map((s) => s.senderId),
      ),
    ];
  }, [context, deliveryMode, to]);

  useEffect(() => {
    if (senderOptions.includes(senderId)) return;
    setSenderId(senderOptions[0] ?? "");
  }, [senderId, senderOptions]);

  const segmentation = useMemo(
    () => encodeAndSegment(previewBody),
    [previewBody],
  );
  const checks = useMemo(() => {
    if (!context || !deliveryMode) return [];
    return buildPreflight({
      report,
      body: previewBody,
      encoding: segmentation.encoding,
      segments: segmentation.segments,
      senderId,
      senders: context.senders,
      messageClass,
      deliveryMode,
    });
  }, [
    context,
    deliveryMode,
    messageClass,
    previewBody,
    report,
    segmentation,
    senderId,
  ]);
  const hasBlock = checks.some((check) => check.level === "block");
  const estimateMinor =
    recipient && previewBody.trim()
      ? rateSegments(segmentation.segments, CURRENCY, DEFAULT_RATES)
      : 0n;
  const balanceAfterMinor = context ? context.balanceMinor - estimateMinor : 0n;
  const insufficient = deliveryMode === "live" && balanceAfterMinor < 0n;
  const canSend = Boolean(
    context &&
      recipient &&
      senderId &&
      previewBody.trim() &&
      !hasBlock &&
      !insufficient &&
      !sending,
  );

  async function submit() {
    if (!recipient || !senderId || !context) return;
    const input: SendSmsRequest = {
      to: recipient,
      sender_id: senderId,
      body: previewBody,
      currency: CURRENCY,
      class: messageClass,
    };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    setSending(true);
    setSendError(null);
    try {
      setSent(await sendSms(input, attempt.current.key));
    } catch (error) {
      const parsed = parseApiError(error);
      setSendError({
        message: parsed.message,
        ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
      });
    } finally {
      setSending(false);
    }
  }

  if (sent && context) {
    return (
      <SendSuccessState
        result={sent}
        deliveryMode={context.settings.delivery_mode}
        onReset={() => {
          setSent(null);
          setTo("");
          setBody("");
          setSelectedTemplateId(null);
          setTokenValues({});
          attempt.current = null;
        }}
      />
    );
  }

  return (
    <PageContainer>
      <SendPageHeading />
      {loadFailed ? (
        <SendLoadError onRetry={() => setLoadVersion((value) => value + 1)} />
      ) : null}
      {!context && !loadFailed ? <SendLoadingState /> : null}
      {context ? (
        <>
          <DeliveryModeAlert settings={context.settings} />
          {sendError ? <SendErrorAlert error={sendError} /> : null}
          <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
            <SendComposerFields
              to={to}
              onToChange={setTo}
              report={report}
              senderOptions={senderOptions}
              senderId={senderId}
              onSenderChange={setSenderId}
              messageClass={messageClass}
              onMessageClassChange={setMessageClass}
              body={body}
              onBodyChange={(value) => {
                setBody(value);
                setSelectedTemplateId(null);
              }}
              templates={context.templates}
              selectedTemplateId={selectedTemplateId}
              onTemplateSelect={(template) => {
                setSelectedTemplateId(template?.id ?? null);
                if (!template) return;
                setBody(template.body);
                setMessageClass(template.class);
                setTokenValues({});
              }}
              encoding={segmentation.encoding}
              characters={segmentation.length}
              segments={segmentation.segments}
              tokens={tokens}
              tokenValues={tokenValues}
              onTokenValuesChange={setTokenValues}
            />
            <SendReviewSidebar
              checks={checks}
              settings={context.settings}
              senderId={senderId}
              messageClass={messageClass}
              segments={segmentation.segments}
              estimateMinor={estimateMinor}
              balanceAfterMinor={balanceAfterMinor}
              insufficient={insufficient}
              hasBlock={hasBlock}
              canSend={canSend}
              sending={sending}
              recipient={recipient}
              body={previewBody}
              onSubmit={submit}
            />
          </div>
        </>
      ) : null}
    </PageContainer>
  );
}
