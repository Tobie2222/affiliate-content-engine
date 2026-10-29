import { ServiceUnavailableException } from '@nestjs/common';
import { ThreadsPublishError } from './threads-provider.types';
import type { ThreadsProvider, ThreadsPublishResult } from './threads-provider.types';

/** THREADS_PROVIDER=official nhưng tích hợp thật chưa được làm: từ chối rõ ràng, không đăng gì. */
export class UnavailableThreadsProvider implements ThreadsProvider {
  readonly mode = 'live' as const;

  async publishText(): Promise<ThreadsPublishResult> {
    throw new ThreadsPublishError('NOT_SENT', 'Kết nối Threads thật chưa được hỗ trợ.');
  }

  static connectError(): ServiceUnavailableException {
    return new ServiceUnavailableException('Kết nối Threads thật (OAuth) chưa được hỗ trợ. Hãy dùng THREADS_PROVIDER=mock.');
  }
}
