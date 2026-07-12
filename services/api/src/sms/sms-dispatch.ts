import type { DeliveryMode } from "@app/contracts";
import type { VirtualPhoneProvider } from "@app/integrations";
import {
  type EngineDeps,
  dispatchSend as engineDispatchSend,
  ingestDlr as engineIngestDlr,
  type PreparedSend,
  type SendInput,
  type SendResult,
} from "@app/sms-engine";

/**
 * Provider dispatch for one prepared send (tx1 already ran).
 *
 * Live mode is the plain engine call. Virtual mode has no carrier to call back, so once the
 * provider accepts we synthesize the terminal DLR inline and ingest it through the same engine
 * path a real vendor webhook would take — the ledger commit, delivery events, and reporting stay
 * identical across both modes rather than forking on delivery mode.
 */
export async function dispatchSend(args: {
  deps: EngineDeps;
  virtualProvider: VirtualPhoneProvider;
  input: SendInput;
  prepared: PreparedSend;
  deliveryMode: DeliveryMode;
}): Promise<SendResult> {
  const { deps, virtualProvider, input, prepared, deliveryMode } = args;
  const result = await engineDispatchSend(deps, input, prepared);
  if (deliveryMode !== "virtual" || result.status !== "accepted") return result;

  await engineIngestDlr(
    deps,
    input.tenantId,
    virtualProvider.delivered({
      messageId: prepared.messageId,
      to: input.to,
      senderId: input.senderId,
      body: input.body,
      encoding: prepared.encoding,
      segments: prepared.segments,
    }),
  );
  return { ...result, status: "delivered" };
}
