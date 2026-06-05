import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';

import { AlertsCronModule } from './modules/alerts-cron/alerts-cron.module';
import { ExportsModule } from './modules/exports/exports.module';
import { NotificationsDigestModule } from './modules/notifications-digest/notifications-digest.module';
import { NotificationsEmailModule } from './modules/notifications-email/notifications-email.module';
import { ParentDigestModule } from './modules/parent-digest/parent-digest.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { QueueModule } from './shared/queue/queue.module';
import { StorageModule } from './shared/storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Load in order: worker-local override → repo-root .env (S3 / Redis / DB shared with API)
      envFilePath: [
        join(process.cwd(), '.env'),
        join(__dirname, '..', '..', '..', '.env'),
        join(__dirname, '..', '..', '..', '..', '.env'),
      ],
    }),
    PrismaModule,
    StorageModule,
    QueueModule,
    ExportsModule,
    AlertsCronModule,
    NotificationsEmailModule,
    ParentDigestModule,
    NotificationsDigestModule,
  ],
})
export class AppModule {}
