import { Global, Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { KeycloakAdminService } from './keycloak-admin.service';

@Global()
@Module({
  providers: [KeycloakAdminService],
  exports: [KeycloakAdminService],
})
export class KeycloakModule implements OnModuleInit {
  private readonly logger = new Logger(KeycloakModule.name);

  constructor(
    private readonly admin: KeycloakAdminService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    // Best-effort SMTP bootstrap so dev emails go to Maildev without manual Keycloak admin clicks.
    // Skipped on errors (Keycloak may not be up yet at boot — admin can re-configure via UI).
    if (this.config.get('NODE_ENV') === 'production') return;
    try {
      await this.admin.configureSmtp({
        host: this.config.get<string>('MAIL_HOST') ?? 'maildev',
        port: Number(this.config.get<string>('MAIL_PORT') ?? 1025),
        from: this.config.get<string>('MAIL_FROM_ADDRESS') ?? 'no-reply@pilotage.local',
        fromDisplayName: 'Pilotage scolaire',
      });
    } catch (err) {
      this.logger.warn(`SMTP bootstrap skipped: ${(err as Error).message}`);
    }
  }
}
