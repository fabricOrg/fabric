import type { WalletSnapshot } from "@app/contracts";
import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";

import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { invalidRequest, newRequestId } from "../http/api-error.js";
import { StatementService } from "./statement.service.js";
import { WalletQueryService } from "./wallet-query.service.js";

/** Structural reply shape — fastify is not a direct dependency of this package. */
interface ReplyLike {
  header(name: string, value: string): unknown;
}

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/wallet")
@UseGuards(ApiKeyGuard)
export class WalletController {
  constructor(
    @Inject(WalletQueryService)
    private readonly wallet: WalletQueryService,
    @Inject(StatementService)
    private readonly statements: StatementService,
  ) {}

  @Get()
  async get(@Req() req: AuthedRequest): Promise<WalletSnapshot> {
    const tenant = requireScope(req.tenant, "wallet:read");
    const snapshot = await this.wallet.getSnapshot(tenant.id);
    return { ...snapshot, request_id: newRequestId() };
  }

  /** B1: auditable statement — CSV of the customer-account ledger for a period. Defaults to the
   *  current calendar month (UTC) in GHS. */
  @Get("statement")
  async statement(
    @Req() req: AuthedRequest,
    // passthrough: headers are set ONLY on the success path — @Header would force text/csv onto
    // the JSON error envelope and crash serialization.
    @Res({ passthrough: true }) reply: ReplyLike,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("currency") cur?: string,
  ): Promise<string> {
    const tenant = requireScope(req.tenant, "wallet:read");
    const now = new Date();
    const defaultFrom = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const parsedFrom = from ? new Date(from) : defaultFrom;
    const parsedTo = to ? new Date(to) : now;
    if (
      Number.isNaN(parsedFrom.getTime()) ||
      Number.isNaN(parsedTo.getTime())
    ) {
      throw invalidRequest(
        "invalid_period",
        "from/to must be ISO-8601 timestamps.",
        "from",
      );
    }
    const csv = await this.statements.statementCsv(tenant.id, {
      from: parsedFrom,
      to: parsedTo,
      currency: cur ?? "GHS",
    });
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header(
      "content-disposition",
      'attachment; filename="fabric-statement.csv"',
    );
    return csv;
  }
}
