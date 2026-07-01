import { type AppDb, createAppDb } from "@app/db";
import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** DI token for the app_runtime-backed {@link AppDb}. Inject with `@Inject(APP_DB)`. */
export const APP_DB = Symbol("APP_DB");

/**
 * Provides the single app-wide {@link AppDb} over the NON-owner `app_runtime` connection
 * (`DATABASE_URL_APP`). Every tenant-scoped handler injects APP_DB and goes through
 * `withTenant(...)` — the RLS runtime seam. Global so feature modules don't re-import it.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AppDb => {
        const url = config.get<string>("DATABASE_URL_APP");
        if (!url) {
          throw new Error(
            "DATABASE_URL_APP is required (non-owner app_runtime connection)",
          );
        }
        return createAppDb(url);
      },
    },
  ],
  exports: [APP_DB],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  // Close the pool on shutdown (enableShutdownHooks in main.ts triggers this).
  async onModuleDestroy(): Promise<void> {
    await this.db.end();
  }
}
