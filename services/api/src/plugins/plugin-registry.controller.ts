import {
  configurePluginRequestSchema,
  createLiveInstanceRequestSchema,
  type PluginCredentialAck,
  pluginActionRequestSchema,
} from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest, notFound, unauthorized } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { PluginCredentialsService } from "./plugin-credentials.service.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

/**
 * Platform plugin registry — staff/internal control-plane (BffToken-guarded, called by the
 * admin-console server, never a browser). Global config; not tenant-scoped.
 */
@Controller("internal/plugins")
@UseGuards(BffTokenGuard)
export class PluginRegistryController {
  constructor(
    @Inject(PluginRegistryService)
    private readonly registry: PluginRegistryService,
    @Inject(PluginCredentialsService)
    private readonly credentials: PluginCredentialsService,
  ) {}

  @Get()
  async list() {
    return { instances: await this.registry.list() };
  }

  @Post()
  async apply(@Body() body: unknown) {
    const parsed = pluginActionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_plugin_action",
        "The plugin action request is invalid.",
      );
    }
    const updated = await this.registry.apply(
      parsed.data.id,
      parsed.data.action,
    );
    if (!updated) throw notFound("unknown_plugin", "Unknown plugin instance.");
    return updated;
  }

  /** Create the live sibling of a catalog vendor. Born disabled and uncredentialed. */
  @Post("live-instances")
  async createLive(@Body() body: unknown) {
    const parsed = createLiveInstanceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_live_instance_request",
        parsed.error.issues[0]?.message ?? "The request is invalid.",
        String(parsed.error.issues[0]?.path[0] ?? "vendor"),
      );
    }
    return this.registry.createLiveInstance(parsed.data);
  }

  /**
   * Install or rotate an instance's credentials. WRITE-ONLY: the response carries a fingerprint and
   * version, never the secret. This is the endpoint that makes adding a carrier a staff action
   * rather than a redeploy (ADR-0011).
   */
  @Post(":id/credentials")
  // Typed as the contract the binding PUBLISHES, so the two cannot drift silently. They did: the
  // binding named the instance DTO while this returns a fingerprint + version, and nothing failed
  // until strict validation rejected a credential that had already been written.
  async configure(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ): Promise<PluginCredentialAck> {
    if (!actorEmail) {
      throw unauthorized("missing_actor", "Actor identity is required.");
    }
    const parsed = configurePluginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_credential_request",
        parsed.error.issues[0]?.message ?? "The credential payload is invalid.",
        "credential",
      );
    }
    return this.credentials.configure(id, parsed.data, {
      email: actorEmail,
      staffId: actorStaffId ?? null,
    });
  }
}
