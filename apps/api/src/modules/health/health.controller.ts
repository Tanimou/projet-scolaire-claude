import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';

import { readMigrationState } from '../../shared/migrations/migration-state';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { buildManifestPayload } from '../../shared/release/release-manifest';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get('healthz')
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('readyz')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
    ]);
  }

  /**
   * Manifeste de release (VAL-10) : quelle version de schéma et quel build
   * tournent réellement, et si cet artefact est bien celui qu'on croit déployer
   * (`release.verdict` — S-E02-6 / R-05). Volontairement limité à un nom de
   * migration et à des SHA courts — aucune donnée de tenant, aucune chaîne de
   * connexion. C'est cette route que `scripts/release-gate.sh` interroge.
   */
  @Get('version')
  async version() {
    const state = await readMigrationState(this.prisma);
    // `app: 'api'` (S-E02-10) : le worker et le web publient désormais le même
    // manifeste sur leurs propres routes. Sans ce champ, un proxy mal routé qui
    // renverrait CE manifeste sur /version/worker serait indiscernable d'un
    // worker conforme — la gate vérifie donc l'identité de l'artefact qui répond.
    return {
      ...buildManifestPayload('api'),
      schemaVersion: state.schemaVersion,
      migrations: {
        status: state.status,
        applied: state.applied.length,
        pending: state.pending.length,
      },
    };
  }

  @Get()
  root() {
    return {
      name: 'Pilotage scolaire API',
      version: '0.0.0',
      docs: '/docs',
      health: '/healthz',
      ready: '/readyz',
      manifest: '/version',
    };
  }
}
