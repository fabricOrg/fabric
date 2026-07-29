import {
  assignPriceBookRequestSchema,
  providerCostRateInputSchema,
  upsertPriceBookRequestSchema,
} from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest, notFound } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { PriceBookAdminService } from "./price-book-admin.service.js";

/**
 * Price-book control plane for the admin-console BFF (ADR-0010 slice 3). BffToken-guarded; the acting
 * staff identity is attested by the BFF via x-actor-* headers (it gates on the staff session + role
 * first) and recorded to the audit log. Read + upsert books, assign a book to an account.
 */
@Controller("internal/admin/price-books")
@UseGuards(BffTokenGuard)
export class PricingController {
  constructor(
    @Inject(PriceBookAdminService)
    private readonly pricing: PriceBookAdminService,
  ) {}

  @Get()
  async list() {
    return { books: await this.pricing.listBooks() };
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const parsed = upsertPriceBookRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest("invalid_price_book", firstIssue(parsed.error));
    }
    // Create always returns a book (no id to miss).
    return this.pricing.upsertBook(null, parsed.data, {
      email: actorEmail ?? null,
      staffId: actorStaffId ?? null,
    });
  }

  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const parsed = upsertPriceBookRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest("invalid_price_book", firstIssue(parsed.error));
    }
    const dto = await this.pricing.upsertBook(id, parsed.data, {
      email: actorEmail ?? null,
      staffId: actorStaffId ?? null,
    });
    if (!dto) throw notFound("price_book_not_found", "Unknown price book.");
    return dto;
  }

  @Post("assignments/:accountId")
  async assign(
    @Param("accountId") accountId: string,
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const parsed = assignPriceBookRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_assignment",
        "Provide a price_book_id or null.",
      );
    }
    const result = await this.pricing.assignAccount(
      accountId,
      parsed.data.price_book_id,
      { email: actorEmail ?? null, staffId: actorStaffId ?? null },
      parsed.data.billing_currency,
    );
    if (result === "book_not_found") {
      throw notFound("price_book_not_found", "Unknown price book.");
    }
    if (result === "account_not_found") {
      throw notFound("account_not_found", "Unknown account.");
    }
    return { ok: true };
  }

  @Get("provider-costs")
  async listProviderCosts() {
    return { rates: await this.pricing.listProviderCosts() };
  }

  @Post("provider-costs")
  async publishProviderCost(
    @Body() body: unknown,
    @Headers("x-actor-email") actorEmail?: string,
    @Headers("x-actor-staff-id") actorStaffId?: string,
  ) {
    const parsed = providerCostRateInputSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest("invalid_provider_cost", firstIssue(parsed.error));
    }
    return this.pricing.publishProviderCost(parsed.data, {
      email: actorEmail ?? null,
      staffId: actorStaffId ?? null,
    });
  }
}

function firstIssue(error: { issues: readonly { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid price book.";
}
