import {
  type EngineDeps,
  failPreparedSend,
  type PreparedSend,
  type SendInput,
  type SendResult,
} from "@app/sms-engine";
import type { ConsentService } from "../consent/consent.service.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import type { SendersService } from "../senders/senders.service.js";
import { destinationCountry } from "./sms-compliance.js";

type DeliveryMode = "virtual" | "live";

interface RecheckRuntime {
  readonly provider: { readonly slug: string };
  deps(mode: DeliveryMode): EngineDeps;
  dispatch(
    input: SendInput,
    prepared: PreparedSend,
    mode: DeliveryMode,
  ): Promise<SendResult>;
}

export interface RecheckDeps {
  killSwitch: KillSwitchService;
  consent: ConsentService;
  senders: SendersService;
  runtime: RecheckRuntime;
}

/**
 * The queued-worker dispatch closure (AC06): the world may have changed since acceptance —
 * recheck kill-switch, consent, and sender registration, then dispatch; a block fails the
 * prepared send with the reason (refund + terminal event), never a silent drop.
 */
export function recheckedDispatch(deps: RecheckDeps) {
  return async (
    input: SendInput,
    prepared: PreparedSend,
    mode: DeliveryMode,
  ): Promise<SendResult> => {
    const blocked = await dispatchBlockReason({
      killSwitch: deps.killSwitch,
      consent: deps.consent,
      senders: deps.senders,
      providerSlug: deps.runtime.provider.slug,
      input,
      mode,
    });
    if (blocked) {
      return failPreparedSend(
        deps.runtime.deps(mode),
        input,
        prepared,
        blocked,
      );
    }
    return deps.runtime.dispatch(input, prepared, mode);
  };
}

/**
 * Attempt-time recheck (SDK-005 AC06): the pre-accept gates ran when the request was ACCEPTED,
 * but a queued job may execute much later — a kill-switch flip, a STOP, or a sender revocation
 * in between must block the provider contact. Returns the stable error code to fail the
 * prepared send with (refund + terminal event via failPreparedSend), or null to proceed.
 *
 * Availability posture: these are control-plane reads on the data-plane hot path — on a store
 * failure each check FAILS OPEN (the send proceeds) so a Redis/Postgres blip on the check
 * cannot strand funded, accepted traffic. The wallet path stays fail-closed elsewhere.
 * The quiet-hours window is deliberately NOT re-evaluated here: the message class is not part
 * of the durable dispatch material, and re-classifying at attempt time would guess.
 */
export async function dispatchBlockReason(deps: {
  killSwitch: KillSwitchService;
  consent: ConsentService;
  senders: SendersService;
  providerSlug: string;
  input: SendInput;
  mode: "virtual" | "live";
}): Promise<string | null> {
  const { killSwitch, consent, senders, providerSlug, input, mode } = deps;
  try {
    if (await killSwitch.isPaused("platform.sms_sending")) {
      return "sms_sending_paused";
    }
    if (
      mode === "live" &&
      (await killSwitch.isPaused(`provider.${providerSlug}`))
    ) {
      return "provider_unavailable";
    }
  } catch {
    // Fail open: a kill-switch store outage must not fail every queued send.
  }
  try {
    if (await consent.isSuppressed(input.tenantId, input.to, "transactional")) {
      return "recipient_opted_out";
    }
  } catch {
    // Fail open — same posture.
  }
  if (mode === "live") {
    try {
      const status = await senders.senderStatus(
        input.tenantId,
        input.senderId,
        destinationCountry(input.to),
      );
      if (status !== "active") return "sender_not_registered";
    } catch {
      // Fail open — same posture.
    }
  }
  return null;
}
