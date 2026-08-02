import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';

import { buildSha, readMigrationState } from '../../shared/migrations/migration-state';
import { PrismaService } from '../../shared/prisma/prisma.service';

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
   * tournent réellement. Volontairement limité à un nom de migration et à un SHA
   * court — aucune donnée de tenant, aucune chaîne de connexion.
   */
  @Get('version')
  async version() {
    const state = await readMigrationState(this.prisma);
    return {
      buildSha: buildSha(),
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
