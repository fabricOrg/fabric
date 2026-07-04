import { createProvisioningDb, type ProvisioningDb } from "@app/db";
import { Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export const PROVISIONING_DB = Symbol("PROVISIONING_DB");

interface ConfigurationReader {
  get(name: string): string | undefined;
}

export function provisioningDatabaseUrl(config: ConfigurationReader): string {
  const dedicatedUrl = config.get("DATABASE_URL_PROVISIONER");
  if (dedicatedUrl) return dedicatedUrl;

  const runtime = config.get("NODE_ENV") ?? process.env.NODE_ENV;
  const localFallback = config.get("DATABASE_URL_SUPER");
  if (runtime !== "production" && localFallback) return localFallback;

  throw new Error(
    "DATABASE_URL_PROVISIONER is required for identity provisioning.",
  );
}

@Module({
  providers: [
    {
      provide: PROVISIONING_DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ProvisioningDb =>
        createProvisioningDb(provisioningDatabaseUrl(config)),
    },
  ],
  exports: [PROVISIONING_DB],
})
export class ProvisioningDbModule implements OnModuleDestroy {
  constructor(@Inject(PROVISIONING_DB) private readonly db: ProvisioningDb) {}

  async onModuleDestroy(): Promise<void> {
    await this.db.end();
  }
}
