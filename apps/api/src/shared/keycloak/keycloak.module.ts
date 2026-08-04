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
    // Best-effort SMTP bootstrap so dev emails reach the local SMTP catcher without
    // manual Keycloak admin clicks. Skipped on errors (Keycloak may not be up yet at
    // boot — an admin can re-configure via the UI).
    if (this.config.get('NODE_ENV') === 'production') return;

    // S-E06-1 / PF-54 — le repli codé en dur vers le nom du service SMTP de
    // développement est supprimé. C'était un nom de service docker-compose
    // écrit en dur dans du code applicatif : sans
    // `MAIL_HOST`, l'API demandait à Keycloak d'envoyer son courrier vers un
    // hôte qui n'existe que dans la pile de dev. Une configuration absente fait
    // désormais SAUTER l'amorçage, en le disant, plutôt que d'en inventer une.
    // Le comportement de dev est inchangé : `x-app-env` pose bien `MAIL_HOST`.
    const mailHost = this.config.get<string>('MAIL_HOST')?.trim();
    if (!mailHost) {
      this.logger.log('SMTP bootstrap skipped: MAIL_HOST is not configured.');
      return;
    }

    try {
      await this.admin.configureSmtp({
        host: mailHost,
        port: Number(this.config.get<string>('MAIL_PORT') ?? 1025),
        from: this.config.get<string>('MAIL_FROM_ADDRESS') ?? 'no-reply@pilotage.local',
        fromDisplayName: 'Pilotage scolaire',
      });
    } catch (err) {
      this.logger.warn(`SMTP bootstrap skipped: ${(err as Error).message}`);
    }
  }
}
