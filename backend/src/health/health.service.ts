import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';

export type CheckState = 'up' | 'down';

export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: { database: CheckState; redis: CheckState };
}

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.redis = new Redis({
      host: config.getOrThrow<string>('REDIS_HOST'),
      port: Number(config.getOrThrow('REDIS_PORT')),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // Tránh crash tiến trình khi Redis tạm thời không kết nối được.
    this.redis.on('error', () => undefined);
  }

  async readiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    return {
      status: database === 'up' && redis === 'up' ? 'ok' : 'error',
      checks: { database, redis },
    };
  }

  private async checkDatabase(): Promise<CheckState> {
    try {
      await withTimeout(this.dataSource.query('SELECT 1'), CHECK_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<CheckState> {
    try {
      if (this.redis.status === 'wait' || this.redis.status === 'end') {
        await withTimeout(this.redis.connect(), CHECK_TIMEOUT_MS);
      }
      const reply = await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS);
      return reply === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
