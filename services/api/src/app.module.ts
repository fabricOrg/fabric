import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggerModule } from "nestjs-pino";
import { AdminModule } from "./admin/admin.module.js";
import { ApiKeysModule } from "./api-keys/api-keys.module.js";
import { ApplicationsModule } from "./applications/applications.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { ConsentModule } from "./consent/consent.module.js";
import { DbModule } from "./db/db.module.js";
import { EmailModule } from "./email/email.module.js";
import { FlowsModule } from "./flows/flows.module.js";
import { HealthModule } from "./health/health.module.js";
import { loggerParams } from "./http/logging.config.js";
import { IdentityModule } from "./identity/identity.module.js";
import { ImpersonationModule } from "./impersonation/impersonation.module.js";
import { KillSwitchModule } from "./kill-switches/kill-switches.module.js";
import { MaintenanceModule } from "./maintenance/maintenance.module.js";
import { MembersModule } from "./members/members.module.js";
import { MessageDefinitionsModule } from "./message-definitions/message-definitions.module.js";
import { MessagesModule } from "./messages/messages.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { PluginsModule } from "./plugins/plugins.module.js";
import { PrivacyModule } from "./privacy/privacy.module.js";
import { ProposalsModule } from "./proposals/proposals.module.js";
import { RequestLogsModule } from "./request-logs/request-logs.module.js";
import { SendersModule } from "./senders/senders.module.js";
import { SmsModule } from "./sms/sms.module.js";
import { SmsTemplatesModule } from "./sms-templates/sms-templates.module.js";
import { VerifyModule } from "./verify/verify.module.js";
import { WalletModule } from "./wallet/wallet.module.js";
import { WebhooksModule } from "./webhooks/webhooks.module.js";

/**
 * Root module. ConfigModule (global) loads env (.env locally; Secrets Manager in cloud). DbModule
 * provides the app_runtime-backed AppDb (the tenant seam) globally. HealthModule exposes /health.
 * Feature modules (api-keys L2, wallet L3, sms L5) mount here as they land.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Structured JSON logs: request_id on every line, tenant_id once resolved, secrets redacted.
    LoggerModule.forRoot(loggerParams()),
    // Registers the cron infrastructure for MaintenanceModule (sweeper + ledger invariant).
    ScheduleModule.forRoot(),
    DbModule,
    HealthModule,
    IdentityModule,
    AdminModule,
    AuditModule,
    EmailModule,
    FlowsModule,
    ImpersonationModule,
    KillSwitchModule,
    MaintenanceModule,
    MembersModule,
    PaymentsModule,
    PluginsModule,
    ProposalsModule,
    ApiKeysModule,
    ApplicationsModule,
    MessageDefinitionsModule,
    MessagesModule,
    RequestLogsModule,
    ConsentModule,
    SendersModule,
    // COMPLIANCE §6: the staff DSR surface. Registered here, not only via SmsModule — erasure is a
    // platform capability, not an SMS one.
    PrivacyModule,
    SmsModule,
    SmsTemplatesModule,
    VerifyModule,
    WalletModule,
    WebhooksModule,
  ],
})
export class AppModule {}
