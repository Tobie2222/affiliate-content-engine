import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // Biến môi trường thật lấy từ .env ở thư mục gốc dự án hoặc từ môi trường chạy.
      envFilePath: ['.env', '../.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.getOrThrow<string>('DB_HOST'),
        port: Number(config.getOrThrow('DB_PORT')),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        autoLoadEntities: true,
        // Không bao giờ dùng synchronize: schema chỉ thay đổi qua migration.
        synchronize: false,
        migrationsRun: false,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: Number(config.getOrThrow('REDIS_PORT')),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    // Giới hạn tần suất mặc định theo IP; endpoint nhạy cảm đặt chặt hơn bằng @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    HealthModule,
    AuthModule,
    OrganizationsModule,
    AgentsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
