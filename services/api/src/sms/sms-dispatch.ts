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
 * The only provider slugs an automated test may hand a message to.
 *
 * `plugin_instances` is platform-wide, so an armed live instance resolves inside
 * `pnpm test:integration` exactly as it does in production — on 2026-08-02 that made the send specs
 * dispatch to a real carrier and spend real money. `refusedUnderTest` in sms-runtime.service.ts is
 * what prevents it; this is the net BELOW that, at the moment of the irreversible act, so a new send
 * path that bypasses the runtime seam fails loudly instead of billing someone. Reads `VITEST` rather
 * than `NODE_ENV`, because `NODE_ENV=test` is also how a developer runs the stack.
 */
const TEST_DISPATCHABLE_SLUGS: ReadonlySet<string> = new Set([
  "fake-sms",
  "virtual-phone",
]);

/**
 * Provider dispatch for one prepared send (tx1 already ran).
 *
 * Live mode is the plain engine call. Virtual mode has no carrier to call back, so once the
 * provider accepts we synthesize the terminal DLR inline and ingest it through the same engine
 * path a real vendor webhook would take — the ledger commit, delivery events, and reporting stay
 * identical across both modes rather than forking on delivery mode.
 *
 * This is the api's single dispatch choke point: every live and virtual send reaches a provider
 * through here (`SmsRuntimeService.dispatch` is the only caller), which is why the test-vendor guard
 * lives here rather than in each send path.
 */
export async function dispatchSend(args: {
  deps: EngineDeps;
  virtualProvider: VirtualPhoneProvider;
  input: SendInput;
  prepared: PreparedSend;
  deliveryMode: DeliveryMode;
}): Promise<SendResult> {
  const { deps, virtualProvider, input, prepared, deliveryMode } = args;
  const slug = deps.provider.slug;
  if (process.env.VITEST && !TEST_DISPATCHABLE_SLUGS.has(slug)) {
    throw new Error(
      `refusing to dispatch through '${slug}' under vitest: a test must never reach a real vendor. ` +
        "Live vendors are filtered out at resolution by refusedUnderTest() in sms-runtime.service.ts — " +
        "reaching here means a send path bypassed it.",
    );
  }
  const result = await engineDispatchSend(deps, input, prepared);
  if (deliveryMode !== "virtual" || result.status !== "accepted") return result;

  // The delayed test recipient rehearses an asynchronous DLR. In production this runs in the
  // existing send worker, so the original API request has already returned `sending`.
  const delayMs = virtualDlrDelayMs(input.to);
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const dlr = virtualProvider.delivered({
    messageId: prepared.messageId,
    to: input.to,
    senderId: input.senderId,
    body: input.body,
    encoding: prepared.encoding,
    segments: prepared.segments,
  });
  await engineIngestDlr(deps, input.tenantId, dlr);
  return { ...result, status: dlr.status };
}

export function virtualDlrDelayMs(to: string): number {
  return to.endsWith("0002") ? 2_000 : 0;
}
