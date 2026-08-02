import type { DeliveryMode } from "@app/contracts";
import type { AppDb, TenantTx } from "@app/db";
import type { RateTable } from "@app/domain";
import type {
  Creds,
  SmsSenderPlugin,
  VirtualPhoneProvider,
} from "@app/integrations";
import type { FakeProvider } from "@app/integrations/testing";
import {
  type EngineDeps,
  dispatchSend as engineDispatchSend,
  type PreparedSend,
  type SendInput,
  type SendResult,
} from "@app/sms-engine";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_DB } from "../db/db.module.js";
import { PluginRegistryService } from "../plugins/plugin-registry.service.js";
import { PluginResolverService } from "../plugins/plugin-resolver.service.js";
import { SandboxAllowanceService } from "../sandbox-allowance/sandbox-allowance.service.js";
import { holdTokens } from "../tokens/token-holds.js";
import { settleTokenHolds } from "../tokens/token-settlement.js";
import { dispatchSend as dispatchProviderSend } from "./sms-dispatch.js";
import { buildSmsProviders } from "./sms-providers.js";
import { VirtualPhoneService } from "./virtual-phone.service.js";
import { maybeAutoStop } from "./virtual-phone-auto-stop.js";

/**
 * The engine's view of the token entitlement layer (ADR-0010 Phase 2). Stateless, so one shared
 * object rather than a per-call closure; the engine holds no dependency on the api service.
 */
const TOKEN_BACKEND = {
  hold: holdTokens,
  // settleTokenHolds, not resolveTokenHolds: a commit must also recognize the deferred revenue.
  resolve: settleTokenHolds,
};

/** A live provider plus the credentials it needs, whatever selected it. */
interface LiveProvider {
  readonly provider: SmsSenderPlugin;
  readonly creds: Creds | undefined;
  /** The control-plane vendor this came from; null when the env path supplied it (no instance). */
  readonly vendor: string | null;
}

/**
 * Whether a control-plane vendor must be IGNORED because this process is a test run.
 *
 * `plugin_instances` is platform-wide, so an armed live Arkesel instance resolves inside
 * `pnpm test:integration` exactly as it does in production — on 2026-08-02 that made the send specs
 * dispatch to a real carrier and spend real money. A spec cannot pin its own fake instance instead:
 * `SMS_ADAPTERS` deliberately contains no fake vendor, so no control-plane row can ever resolve to a
 * test double.
 *
 * So the refusal lives here, once, rather than as a stub each spec has to remember to apply. Falling
 * through to the env provider is not a fabricated success: `liveProviderReadiness` already returns
 * ready under `NODE_ENV=test` precisely so the suite runs on the FakeProvider, and that provider
 * reports honest per-scenario outcomes. `sms-dispatch.ts` then refuses any non-test provider outright,
 * so a mistake here fails loudly instead of billing someone.
 *
 * Keyed on `VITEST` rather than `NODE_ENV`, since `NODE_ENV=test` is also how a developer runs the
 * stack against a real vendor deliberately.
 */
function refusedUnderTest(slug: string): boolean {
  if (!process.env.VITEST) return false;
  if (slug === "fake-sms" || slug === "virtual-phone") return false;
  new Logger(SmsRuntimeService.name).warn(
    `ignoring control-plane SMS vendor '${slug}' under vitest — a test must never reach a real vendor; falling back to the test provider`,
  );
  return true;
}

@Injectable()
export class SmsRuntimeService {
  readonly virtualProvider: VirtualPhoneProvider;
  readonly legacySandboxProvider: FakeProvider;
  /**
   * The ENV-configured provider (SMS_PROVIDER / ARKESEL_*). ADR-0011 slice 5 deletes this: until
   * then it seeds the control plane and backstops environments with no plugin instance yet.
   */
  private readonly envProvider: SmsSenderPlugin;
  private readonly envCreds: Creds | undefined;
  private readonly envLiveReady: boolean;
  private readonly envLiveReason: string | null;
  private readonly sandboxAllowance: SandboxAllowanceService;

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(ConfigService) config: ConfigService,
    @Inject(VirtualPhoneService)
    private readonly virtualPhone: VirtualPhoneService,
    // Optional so the service can still be constructed directly in unit tests (and by SmsService's
    // own fallback) without a control plane. Absent resolver = env-only, i.e. today's behaviour.
    @Optional()
    @Inject(PluginResolverService)
    private readonly resolver?: PluginResolverService,
    // Also optional: status reporting is observability, and its absence must never stop a send.
    @Optional()
    @Inject(PluginRegistryService)
    private readonly registry?: PluginRegistryService,
    @Optional()
    @Inject(SandboxAllowanceService)
    sandboxAllowance?: SandboxAllowanceService,
  ) {
    const wired = buildSmsProviders(config, new Logger(SmsRuntimeService.name));
    this.envProvider = wired.provider;
    this.envCreds = wired.creds;
    this.virtualProvider = wired.virtualProvider;
    this.legacySandboxProvider = wired.legacySandboxProvider;
    this.envLiveReady = wired.liveReady;
    this.envLiveReason = wired.liveReadinessReason;
    this.sandboxAllowance =
      sandboxAllowance ?? new SandboxAllowanceService(config);
  }

  /**
   * Who carries a LIVE send. The CONTROL PLANE wins (ADR-0011); the env path is only consulted when
   * no plugin instance is configured, which is the migration state slice 5 removes.
   *
   * Returns null when neither source can name a provider. Callers must treat that as "cannot send" —
   * never as "send some other way". The resolver itself throws when its store is unreachable with
   * nothing cached (fail closed, deliberately): that surfaces as a 5xx rather than a silent
   * downgrade to the fake provider, which would report success for a message that never left.
   */
  private async liveProvider(): Promise<LiveProvider | null> {
    const resolved = await this.resolver?.resolveSms("live");
    if (resolved && !refusedUnderTest(resolved.provider.slug)) {
      return {
        provider: resolved.provider,
        creds: resolved.creds,
        vendor: resolved.vendor,
      };
    }
    // No plugin instance. Fall back to the env provider only if the env path is actually configured
    // for live — envLiveReady already demands a real key and ARKESEL_SANDBOX=false, and is true in
    // NODE_ENV=test so the suite keeps running on the fake provider.
    if (this.envLiveReady) {
      return {
        provider: this.envProvider,
        creds: this.envCreds,
        vendor: null,
      };
    }
    return null;
  }

  /**
   * Engine deps for a delivery mode. `rates` (the account's resolved SMS price book) is only consumed
   * by prepareSend's rateSegments — dispatch/DLR/sweep never reprice (they recover cost from the
   * reservation), so callers pass it only at prepare time. Omitted → the engine's compiled default.
   *
   * Async since ADR-0011: a live send asks the control plane which provider carries it. That read is
   * TTL-cached in the resolver, so this is a map lookup on the hot path, not a query per send.
   */
  async deps(
    deliveryMode: DeliveryMode = "live",
    rates?: RateTable,
  ): Promise<EngineDeps> {
    const base =
      deliveryMode === "virtual"
        ? { db: this.db, provider: this.virtualProvider }
        : await this.liveDeps();
    // The token backend is injected on EVERY deps() — unlike `rates`, resolution (DLR, sweeper)
    // must also settle token holds, and those paths don't pass rates.
    const withTokens = {
      ...base,
      tokens: TOKEN_BACKEND,
      sandboxAllowance: {
        consume: (
          tx: TenantTx,
          input: Parameters<SandboxAllowanceService["consume"]>[1],
        ) => this.sandboxAllowance.consume(tx, input),
      },
    };
    return rates ? { ...withTokens, rates } : withTokens;
  }

  /**
   * Deps for the live plane. With no provider configured this falls back to the env provider object
   * so RESOLUTION paths (DLR ingest, sweeper) still have something to hold — they bill against the
   * message's own recorded provider_slug regardless (see engine resolveMessage), so the object here
   * does not decide money. DISPATCH is gated separately by liveReadiness(), which refuses to send.
   */
  private async liveDeps(): Promise<EngineDeps> {
    const live = await this.liveProvider();
    return {
      db: this.db,
      provider: live?.provider ?? this.envProvider,
      ...(live?.creds ? { creds: live.creds } : {}),
    };
  }

  /**
   * The slug of the provider that would carry a live send — for the `provider.<slug>` kill-switch.
   * Resolver-derived, never `SMS_PROVIDER`: once the control plane owns selection, that env var
   * stops describing reality and a switch keyed on it would gate the wrong provider.
   */
  async providerSlug(deliveryMode: DeliveryMode = "live"): Promise<string> {
    if (deliveryMode === "virtual") return this.virtualProvider.slug;
    const live = await this.liveProvider();
    return (live?.provider ?? this.envProvider).slug;
  }

  /**
   * Whether a live send can proceed, and why not when it can't. A configured plugin instance makes
   * the environment live-ready on its own — that is the whole point of ADR-0011, config without a
   * redeploy — so the env readiness check is only the fallback answer.
   */
  async liveReadiness(): Promise<{
    ready: boolean;
    reason: string | null;
  }> {
    if (await this.liveProvider()) return { ready: true, reason: null };
    return {
      ready: false,
      reason:
        this.envLiveReason ??
        "Live SMS delivery is not enabled for this environment.",
    };
  }

  async dispatch(
    input: SendInput,
    prepared: PreparedSend,
    deliveryMode: DeliveryMode,
  ): Promise<SendResult> {
    const live = deliveryMode === "virtual" ? null : await this.liveProvider();
    const result = await dispatchProviderSend({
      deps: await this.deps(deliveryMode),
      virtualProvider: this.virtualProvider,
      input,
      prepared,
      deliveryMode,
    });
    if (deliveryMode === "virtual") {
      await maybeAutoStop(this.virtualPhone, input, result);
    }
    // ADR-0011 §6: `connected` is EARNED by actually reaching the vendor. This is the only writer —
    // enabling a toggle no longer claims it. Only for control-plane-resolved instances (vendor
    // non-null); the env path has no row to mark.
    if (live?.vendor) {
      await this.registry?.markDispatchOutcome(
        live.vendor,
        "live",
        result.status === "failed" ? "error" : "ok",
      );
    }
    return result;
  }

  legacyDispatch(
    input: SendInput,
    prepared: PreparedSend,
  ): Promise<SendResult> {
    return engineDispatchSend(
      { db: this.db, provider: this.legacySandboxProvider },
      input,
      prepared,
    );
  }
}
