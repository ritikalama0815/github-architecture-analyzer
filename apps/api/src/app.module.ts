import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalysesModule } from './analyses/analyses.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AnalysesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
