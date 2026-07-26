import type {
  PriceBookDto,
  PublicPricingResponse,
  UpsertPriceBookRequest,
} from "@app/contracts";
import {
  accounts,
  type ProvisioningDb,
  priceBooks,
  type TenantId,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import {
  listPriceBooks,
  readPublicPricing,
  upsertPriceBook,
} from "./price-book-writes.js";
import { PricingService } from "./pricing.service.js";

/** The staff actor attributed to an audited price change (from the BFF x-actor-* headers). */
interface Actor {
  readonly email?: string | null;
  readonly staffId?: string | null;
}

/**
 * Admin-console price-book control plane (ADR-0010 slice 3) — kept separate from the hot-path
 * PricingService resolver. Every write is audited; a rate edit clears the resolver cache and an
 * assignment invalidates just that account, so a staff change takes effect within the send path's
 * cache TTL at the latest.
 */
@Injectable()
export class PriceBookAdminService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  /** All price books with their rates. Ensures the default book exists first. */
  async listBooks(): Promise<PriceBookDto[]> {
    await this.pricing.ensureDefaultBook();
    return listPriceBooks(this.provisioning.db);
  }

  async publicPricing(): Promise<PublicPricingResponse | null> {
    return readPublicPricing(this.provisioning.db);
  }

  /**
   * Create (id null) or update a book + its full rate set. A rate change can move ANY account priced
   * on this book, so the whole resolver cache is cleared (books are few). Returns null on unknown id.
   */
  async upsertBook(
    id: string | null,
    req: UpsertPriceBookRequest,
    actor: Actor,
  ): Promise<PriceBookDto | null> {
    const dto = await upsertPriceBook(this.provisioning.db, id, req);
    if (!dto) return null;
    this.pricing.clearCache();
    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email ?? null,
      action: "price_book.upsert",
      targetType: "price_book",
      targetId: dto.id,
      summary: `Price book "${dto.name}" ${id ? "updated" : "created"}`,
      metadata: {
        mode: dto.mode,
        is_default: dto.is_default,
        is_public: dto.is_public,
        rate_count: dto.rates.length,
      },
    });
    return dto;
  }

  /**
   * Assign (or clear → default) an account's price book. Validates the book exists BEFORE the update
   * (a valid-but-unknown id would otherwise hit the FK and 500), invalidates that account, and audits.
   */
  async assignAccount(
    accountId: string,
    bookId: string | null,
    actor: Actor,
  ): Promise<"ok" | "account_not_found" | "book_not_found"> {
    if (bookId) {
      const [book] = await this.provisioning.db
        .select({ id: priceBooks.id })
        .from(priceBooks)
        .where(eq(priceBooks.id, bookId))
        .limit(1);
      if (!book) return "book_not_found";
    }
    const [updated] = await this.provisioning.db
      .update(accounts)
      .set({ priceBookId: bookId })
      .where(eq(accounts.id, accountId as TenantId))
      .returning({ id: accounts.id });
    if (!updated) return "account_not_found";
    this.pricing.invalidate(accountId);
    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email ?? null,
      action: "price_book.assign",
      targetType: "account",
      targetId: accountId,
      summary: bookId
        ? `Account assigned price book ${bookId}`
        : "Account price book cleared (→ default)",
      metadata: { price_book_id: bookId },
    });
    return "ok";
  }
}
