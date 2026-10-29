import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { AffiliateLinksService } from '../affiliate/affiliate-links.service';
import { AgentOfficeService } from '../agents/agent-office.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { composeText } from '../content/content-rules';
import { ContentStatus } from '../content/content-state-machine';
import { ContentPost } from '../content/entities/content-post.entity';
import { PostApproval } from '../content/entities/post-approval.entity';
import { MediaService } from '../media/media.service';
import { PublishJob } from './entities/publish-job.entity';
import { PublishedPost } from './entities/published-post.entity';
import { SocialAccount } from './entities/social-account.entity';
import { MockThreadsProvider } from './providers/mock-threads.provider';
import { ThreadsPublishError } from './providers/threads-provider.types';
import { PublishingService } from './publishing.service';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const POST = 'c0000000-0000-4000-8000-000000000001';
const LINK = 'l0000000-0000-4000-8000-000000000001';
const PRODUCT = 'p0000000-0000-4000-8000-000000000001';
const T0 = new Date('2026-10-27T03:00:00Z');
const LATER = new Date(T0.getTime() + 60 * 60_000);
const URL = 'https://s.shopee.vn/AbCdEf';
const BODY = 'Bình giữ nhiệt này mình dùng mỗi ngày đi làm, nước nóng vẫn ấm đến chiều.';
const DISCLOSURE = 'Mình nhận hoa hồng nếu bạn mua qua link này.';

type Row = Record<string, unknown>;
type Op = { _op: 'lte' | 'lt'; value: Date };
const isOp = (v: unknown): v is Op => typeof v === 'object' && v !== null && '_op' in (v as object);

function fakeRepo(uniqueKeys: string[] = []) {
  const rows: Row[] = [];
  let counter = 0;
  const matchOne = (actual: unknown, expected: unknown) => {
    if (isOp(expected)) {
      const a = (actual as Date | null)?.getTime();
      if (a === undefined) {
        return false;
      }
      return expected._op === 'lte' ? a <= expected.value.getTime() : a < expected.value.getTime();
    }
    return actual === expected;
  };
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => matchOne(row[k], v));
  return {
    rows,
    create: (x: Row) => ({ ...x }),
    save: async (x: Row) => {
      counter += 1;
      for (const key of uniqueKeys) {
        if (rows.some((r) => r[key] === x[key])) {
          throw Object.assign(new Error('duplicate'), { code: '23505' });
        }
      }
      const saved = { ...x, id: (x.id as string | undefined) ?? `id-${counter}`, createdAt: new Date(T0.getTime() + counter) };
      rows.push(saved);
      return { ...saved };
    },
    findOne: async ({ where }: { where: Row }) => {
      const found = rows.find((r) => matches(r, where));
      return found ? { ...found } : null;
    },
    find: async ({ where, order, take }: { where: Row; order?: Record<string, 'ASC' | 'DESC'>; take?: number }) => {
      const [key, dir] = Object.entries(order ?? { createdAt: 'DESC' })[0];
      const hit = rows
        .filter((r) => matches(r, where))
        .sort((a, b) => {
          const d = ((a[key] as Date).getTime() ?? 0) - ((b[key] as Date).getTime() ?? 0);
          return dir === 'ASC' ? d : -d;
        })
        .map((r) => ({ ...r }));
      return take ? hit.slice(0, take) : hit;
    },
    update: async (criteria: Row, patch: Row) => {
      const hit = rows.filter((r) => matches(r, criteria));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    },
  };
}

function setup(options: { env?: Record<string, string>; media?: boolean } = {}) {
  const accounts = fakeRepo(['handle']);
  const jobs = fakeRepo();
  const published = fakeRepo();
  const posts = fakeRepo();
  const approvals = fakeRepo();
  const byClass = new Map<unknown, unknown>([
    [SocialAccount, accounts],
    [PublishJob, jobs],
    [PublishedPost, published],
    [ContentPost, posts],
    [PostApproval, approvals],
  ]);
  const dataSource = { transaction: async (work: (m: unknown) => Promise<unknown>) => work({ getRepository: (c: unknown) => byClass.get(c) }) };

  const state = {
    link: { ok: true } as { ok: true } | { ok: false; reason: string },
    mediaError: null as string | null,
    attributions: [] as string[],
    paused: false,
  };
  const links = {
    get: async (org: string, id: string) => {
      if (org !== ORG_A || id !== LINK) {
        throw new NotFoundException('Không tìm thấy link.');
      }
      return { id, productId: PRODUCT, affiliateUrl: URL, publishable: state.link };
    },
  };
  const media = {
    assertUsable: async () => {
      if (state.mediaError) {
        throw new UnprocessableEntityException(state.mediaError);
      }
      return { attributions: state.attributions };
    },
  };
  const emitted: Array<{ type: string; message: string }> = [];
  const office = {
    emit: async (input: { type: string; message: string }) => {
      if (state.paused && input.type === 'TASK_STARTED') {
        throw new ConflictException('Agent đang tạm dừng.');
      }
      emitted.push(input);
      return {};
    },
  };
  const auditEntries: Array<{ action: string }> = [];
  const audit = { record: async (e: { action: string }) => void auditEntries.push(e) };
  const threads = new MockThreadsProvider();
  const env: Record<string, string> = { THREADS_PROVIDER: 'mock', NODE_ENV: 'development', ...options.env };
  const config = { get: (k: string) => env[k] };

  const service = new PublishingService(
    dataSource as unknown as DataSource,
    accounts as unknown as Repository<SocialAccount>,
    jobs as unknown as Repository<PublishJob>,
    published as unknown as Repository<PublishedPost>,
    posts as unknown as Repository<ContentPost>,
    approvals as unknown as Repository<PostApproval>,
    threads,
    links as unknown as AffiliateLinksService,
    media as unknown as MediaService,
    office as unknown as AgentOfficeService,
    audit as unknown as AuditLogsService,
    config as unknown as ConfigService,
  );
  return { service, accounts, jobs, published, posts, approvals, threads, state, emitted, auditEntries, env };
}

type Ctx = ReturnType<typeof setup>;

async function account(ctx: Ctx, handle = 'shop.demo') {
  return ctx.service.createAccount(ORG_A, ACTOR, { handle, displayName: 'Shop demo' });
}

/** Bài đã được duyệt đúng phiên bản hiện tại, sẵn sàng lên lịch. */
function approvedPost(ctx: Ctx, extra: Row = {}) {
  ctx.posts.rows.push({
    id: POST, organizationId: ORG_A, productId: PRODUCT, affiliateLinkId: LINK, mediaAssetId: null,
    body: BODY, disclosureText: DISCLOSURE, status: ContentStatus.Approved, contentVersion: 1,
    blockedReason: null, createdAt: T0, ...extra,
  });
  ctx.approvals.rows.push({ id: 'ap-1', organizationId: ORG_A, contentPostId: POST, contentVersion: 1, decision: 'APPROVED', createdAt: T0 });
}

async function scheduled(ctx: Ctx, when = LATER) {
  approvedPost(ctx);
  const acc = await account(ctx);
  const result = await ctx.service.schedule(ORG_A, ACTOR, POST, { socialAccountId: acc.id, scheduledFor: when.toISOString(), expectedVersion: 1 }, T0);
  return { acc, ...result };
}

const postRow = (ctx: Ctx) => ctx.posts.rows[0];
const jobRow = (ctx: Ctx) => ctx.jobs.rows[0];

describe('tài khoản Threads', () => {
  it('kết nối tài khoản MOCK, chuẩn hóa tên và ghi nhật ký', async () => {
    const ctx = setup();
    const acc = await ctx.service.createAccount(ORG_A, ACTOR, { handle: '@Shop.Demo', displayName: ' Shop ' });
    expect(acc).toMatchObject({ handle: 'shop.demo', mode: 'MOCK', status: 'ACTIVE', displayName: 'Shop', platform: 'THREADS' });
    expect(ctx.auditEntries.map((e) => e.action)).toContain('social_account.connected');
  });

  it('từ chối tên không hợp lệ và tên trùng', async () => {
    const ctx = setup();
    await expect(ctx.service.createAccount(ORG_A, ACTOR, { handle: 'có dấu cách', displayName: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await account(ctx);
    await expect(account(ctx)).rejects.toBeInstanceOf(ConflictException);
  });

  it('THREADS_PROVIDER khác mock: từ chối kết nối giả vờ', async () => {
    const ctx = setup({ env: { THREADS_PROVIDER: 'official' } });
    await expect(account(ctx)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(ctx.accounts.rows.length).toBe(0);
  });

  it('không ngắt kết nối khi còn bài chờ đăng', async () => {
    const ctx = setup();
    const { acc } = await scheduled(ctx);
    await expect(ctx.service.disconnectAccount(ORG_A, ACTOR, acc.id)).rejects.toBeInstanceOf(ConflictException);
    await ctx.service.unschedule(ORG_A, ACTOR, POST);
    const after = await ctx.service.disconnectAccount(ORG_A, ACTOR, acc.id);
    expect(after.status).toBe('DISCONNECTED');
  });
});

describe('PublishingService.schedule', () => {
  it('lên lịch bài đã duyệt: bài SCHEDULED, tạo việc QUEUED có khóa idempotent', async () => {
    const ctx = setup();
    const { job, post } = await scheduled(ctx);
    expect(post.status).toBe(ContentStatus.Scheduled);
    expect(job).toMatchObject({ status: 'QUEUED', contentVersion: 1, attempts: 0 });
    expect(String(job.idempotencyKey)).toContain(POST);
    expect(ctx.auditEntries.map((e) => e.action)).toContain('publish.scheduled');
  });

  it('mỗi lần lên lịch mới có khóa idempotent mới', async () => {
    const ctx = setup();
    const first = await scheduled(ctx);
    await ctx.service.unschedule(ORG_A, ACTOR, POST);
    const second = await ctx.service.schedule(ORG_A, ACTOR, POST, { socialAccountId: first.acc.id, scheduledFor: LATER.toISOString(), expectedVersion: 1 }, T0);
    expect(second.job.idempotencyKey).not.toBe(first.job.idempotencyKey);
  });

  it('chỉ lên lịch bài APPROVED', async () => {
    const ctx = setup();
    approvedPost(ctx, { status: ContentStatus.Draft });
    const acc = await account(ctx);
    await expect(
      ctx.service.schedule(ORG_A, ACTOR, POST, { socialAccountId: acc.id, scheduledFor: LATER.toISOString(), expectedVersion: 1 }, T0),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('từ chối khi phiên bản người dùng xem đã cũ', async () => {
    const ctx = setup();
    approvedPost(ctx);
    const acc = await account(ctx);
    await expect(
      ctx.service.schedule(ORG_A, ACTOR, POST, { socialAccountId: acc.id, scheduledFor: LATER.toISOString(), expectedVersion: 2 }, T0),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('từ chối thời điểm quá khứ hoặc quá gần', async () => {
    const ctx = setup();
    approvedPost(ctx);
    const acc = await account(ctx);
    for (const when of [new Date(T0.getTime() - 1000), new Date(T0.getTime() + 30_000)]) {
      await expect(
        ctx.service.schedule(ORG_A, ACTOR, POST, { socialAccountId: acc.id, scheduledFor: when.toISOString(), expectedVersion: 1 }, T0),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(ctx.jobs.rows.length).toBe(0);
  });

  it('không có lần duyệt cho đúng phiên bản hiện tại -> 422', async () => {
    const ctx = setup();
    approvedPost(ctx, { contentVersion: 2 });
    const acc = await account(ctx);
    await expect(
      ctx.service.schedule(ORG_A, ACTOR, POST, { socialAccountId: acc.id, scheduledFor: LATER.toISOString(), expectedVersion: 2 }, T0),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('link chưa đăng được -> 422 kèm lý do, không tạo việc', async () => {
    const ctx = setup();
    approvedPost(ctx);
    const acc = await account(ctx);
    ctx.state.link = { ok: false, reason: 'Link chưa được xác minh.' };
    await expect(
      ctx.service.schedule(ORG_A, ACTOR, POST, { socialAccountId: acc.id, scheduledFor: LATER.toISOString(), expectedVersion: 1 }, T0),
    ).rejects.toThrow('chưa được xác minh');
    expect(ctx.jobs.rows.length).toBe(0);
    expect(postRow(ctx).status).toBe(ContentStatus.Approved);
  });

  it('giấy phép media hết hạn -> 422', async () => {
    const ctx = setup();
    approvedPost(ctx, { mediaAssetId: 'm1' });
    const acc = await account(ctx);
    ctx.state.mediaError = 'Giấy phép đã hết hạn.';
    await expect(
      ctx.service.schedule(ORG_A, ACTOR, POST, { socialAccountId: acc.id, scheduledFor: LATER.toISOString(), expectedVersion: 1 }, T0),
    ).rejects.toThrow('hết hạn');
  });

  it('CC BY thiếu dòng ghi nguồn -> 422; có dòng ghi nguồn thì qua', async () => {
    const ctx = setup();
    approvedPost(ctx, { mediaAssetId: 'm1' });
    const acc = await account(ctx);
    ctx.state.attributions = ['Ảnh: Nguyễn A / CC BY 4.0'];
    const dto = { socialAccountId: acc.id, scheduledFor: LATER.toISOString(), expectedVersion: 1 };
    await expect(ctx.service.schedule(ORG_A, ACTOR, POST, dto, T0)).rejects.toThrow('ghi nguồn');
    postRow(ctx).body = `${BODY}\nẢnh: Nguyễn A / CC BY 4.0`;
    const ok = await ctx.service.schedule(ORG_A, ACTOR, POST, dto, T0);
    expect(ok.post.status).toBe(ContentStatus.Scheduled);
  });

  it('tài khoản ngắt kết nối hoặc của tổ chức khác không dùng được', async () => {
    const ctx = setup();
    approvedPost(ctx);
    const acc = await account(ctx);
    const dto = { socialAccountId: acc.id, scheduledFor: LATER.toISOString(), expectedVersion: 1 };
    await ctx.service.disconnectAccount(ORG_A, ACTOR, acc.id);
    await expect(ctx.service.schedule(ORG_A, ACTOR, POST, dto, T0)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(ctx.service.schedule(ORG_B, ACTOR, POST, dto, T0)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('production: tài khoản MOCK không được dùng để đăng', async () => {
    const ctx = setup({ env: { NODE_ENV: 'production' } });
    approvedPost(ctx);
    const acc = await account(ctx);
    await expect(
      ctx.service.schedule(ORG_A, ACTOR, POST, { socialAccountId: acc.id, scheduledFor: LATER.toISOString(), expectedVersion: 1 }, T0),
    ).rejects.toThrow('MOCK');
  });
});

describe('PublishingService.unschedule', () => {
  it('hủy lịch: bài về APPROVED, việc CANCELLED', async () => {
    const ctx = setup();
    await scheduled(ctx);
    const post = await ctx.service.unschedule(ORG_A, ACTOR, POST);
    expect(post.status).toBe(ContentStatus.Approved);
    expect(jobRow(ctx).status).toBe('CANCELLED');
  });

  it('không hủy được bài chưa lên lịch hoặc đã được worker nhận', async () => {
    const ctx = setup();
    approvedPost(ctx);
    await expect(ctx.service.unschedule(ORG_A, ACTOR, POST)).rejects.toBeInstanceOf(ConflictException);
    const ctx2 = setup();
    await scheduled(ctx2);
    jobRow(ctx2).status = 'PUBLISHING';
    await expect(ctx2.service.unschedule(ORG_A, ACTOR, POST)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PublishingService.runDue', () => {
  it('đăng việc đã đến giờ: PUBLISHED, ghi bài đã đăng, văn bản gồm dòng công khai và link', async () => {
    const ctx = setup();
    await scheduled(ctx);
    const run = await ctx.service.runDue(new Date(LATER.getTime() + 1000));
    expect(run.results.map((r) => r.outcome)).toEqual(['PUBLISHED']);
    expect(postRow(ctx).status).toBe(ContentStatus.Published);
    expect(jobRow(ctx)).toMatchObject({ status: 'SUCCEEDED', attempts: 1 });
    expect(ctx.published.rows.length).toBe(1);
    expect(ctx.published.rows[0].externalPostId).toBe(jobRow(ctx).externalPostId);
    const sent = [...ctx.threads.published.values()][0];
    expect(sent.text).toBe(composeText(BODY, DISCLOSURE, URL));
    expect(ctx.emitted.map((e) => e.type)).toContain('TASK_COMPLETED');
  });

  it('chưa đến giờ thì không đăng', async () => {
    const ctx = setup();
    await scheduled(ctx);
    const run = await ctx.service.runDue(new Date(LATER.getTime() - 1000));
    expect(run.results).toEqual([]);
    expect(postRow(ctx).status).toBe(ContentStatus.Scheduled);
    expect(ctx.threads.published.size).toBe(0);
  });

  it('chạy lại nhiều lần không đăng trùng', async () => {
    const ctx = setup();
    await scheduled(ctx);
    const at = new Date(LATER.getTime() + 1000);
    await ctx.service.runDue(at);
    const again = await ctx.service.runDue(at);
    expect(again.results).toEqual([]);
    expect(await ctx.service.publishJob(String(jobRow(ctx).id), at)).toBe('SKIPPED');
    expect(ctx.threads.published.size).toBe(1);
    expect(ctx.published.rows.length).toBe(1);
  });

  it('hai worker cùng nhận một việc: chỉ một bên đăng', async () => {
    const ctx = setup();
    await scheduled(ctx);
    const at = new Date(LATER.getTime() + 1000);
    const id = String(jobRow(ctx).id);
    const outcomes = await Promise.all([ctx.service.publishJob(id, at), ctx.service.publishJob(id, at)]);
    expect([...outcomes].sort()).toEqual(['PUBLISHED', 'SKIPPED']);
    expect(ctx.threads.published.size).toBe(1);
  });

  it('link bị thu hồi sau khi lên lịch: chặn bài (BLOCKED), không gọi Threads', async () => {
    const ctx = setup();
    await scheduled(ctx);
    ctx.state.link = { ok: false, reason: 'Link đã bị thu hồi.' };
    const run = await ctx.service.runDue(new Date(LATER.getTime() + 1000));
    expect(run.results[0].outcome).toBe('BLOCKED');
    expect(postRow(ctx)).toMatchObject({ status: ContentStatus.Blocked });
    expect(String(postRow(ctx).blockedReason)).toContain('thu hồi');
    expect(jobRow(ctx).status).toBe('CANCELLED');
    expect(ctx.threads.published.size).toBe(0);
  });

  it('giấy phép media hết hạn sau khi lên lịch: chặn bài', async () => {
    const ctx = setup();
    approvedPost(ctx, { mediaAssetId: 'm1' });
    const acc = await account(ctx);
    await ctx.service.schedule(ORG_A, ACTOR, POST, { socialAccountId: acc.id, scheduledFor: LATER.toISOString(), expectedVersion: 1 }, T0);
    ctx.state.mediaError = 'Giấy phép đã hết hạn.';
    const run = await ctx.service.runDue(new Date(LATER.getTime() + 1000));
    expect(run.results[0].outcome).toBe('BLOCKED');
    expect(ctx.threads.published.size).toBe(0);
  });

  it('tài khoản bị ngắt sau khi lên lịch (sửa trực tiếp DB): chặn bài', async () => {
    const ctx = setup();
    const { acc } = await scheduled(ctx);
    ctx.accounts.rows.find((r) => r.id === acc.id)!.status = 'NEEDS_REAUTH';
    const run = await ctx.service.runDue(new Date(LATER.getTime() + 1000));
    expect(run.results[0].outcome).toBe('BLOCKED');
  });

  it('agent Đăng bài đang tạm dừng: việc nằm lại hàng chờ', async () => {
    const ctx = setup();
    await scheduled(ctx);
    ctx.state.paused = true;
    const run = await ctx.service.runDue(new Date(LATER.getTime() + 1000));
    expect(run.results[0].outcome).toBe('SKIPPED');
    expect(jobRow(ctx).status).toBe('QUEUED');
    expect(postRow(ctx).status).toBe(ContentStatus.Scheduled);
    expect(ctx.threads.published.size).toBe(0);
    ctx.state.paused = false;
    const resumed = await ctx.service.runDue(new Date(LATER.getTime() + 2000));
    expect(resumed.results[0].outcome).toBe('PUBLISHED');
  });

  it('chỉ xử lý việc của tổ chức được chỉ định', async () => {
    const ctx = setup();
    await scheduled(ctx);
    const none = await ctx.service.runDue(new Date(LATER.getTime() + 1000), ORG_B);
    expect(none.results).toEqual([]);
    expect(jobRow(ctx).status).toBe('QUEUED');
  });
});

describe('thất bại và thử lại', () => {
  const at = new Date(LATER.getTime() + 1000);

  it('lỗi chắc chắn chưa gửi (NOT_SENT): FAILED, thử lại không cần xác nhận', async () => {
    const ctx = setup();
    await scheduled(ctx);
    ctx.threads.failNext = new ThreadsPublishError('NOT_SENT', 'Vượt hạn mức đăng bài.');
    const run = await ctx.service.runDue(at);
    expect(run.results[0].outcome).toBe('FAILED');
    expect(postRow(ctx).status).toBe(ContentStatus.Failed);
    expect(jobRow(ctx)).toMatchObject({ status: 'FAILED', failureKind: 'NOT_SENT', retrySafe: true });

    const retried = await ctx.service.retry(ORG_A, ACTOR, POST, {}, at);
    expect(retried.post.status).toBe(ContentStatus.Scheduled);
    expect(jobRow(ctx)).toMatchObject({ status: 'QUEUED', lastError: null });
    const second = await ctx.service.runDue(new Date(at.getTime() + 1000));
    expect(second.results[0].outcome).toBe('PUBLISHED');
    expect(jobRow(ctx).attempts).toBe(2);
    expect(ctx.threads.published.size).toBe(1);
  });

  it('lỗi không rõ (UNKNOWN): không tự thử lại; cần xác nhận đã kiểm tra trên Threads', async () => {
    const ctx = setup();
    await scheduled(ctx);
    ctx.threads.failNext = new Error('socket hang up token=sk-SECRET');
    await ctx.service.runDue(at);
    expect(jobRow(ctx)).toMatchObject({ status: 'FAILED', failureKind: 'UNKNOWN', retrySafe: false });
    expect(String(jobRow(ctx).lastError)).not.toContain('sk-SECRET');

    await expect(ctx.service.retry(ORG_A, ACTOR, POST, {}, at)).rejects.toBeInstanceOf(ConflictException);
    expect(postRow(ctx).status).toBe(ContentStatus.Failed);
    const ok = await ctx.service.retry(ORG_A, ACTOR, POST, { confirmNotPublished: true }, at);
    expect(ok.post.status).toBe(ContentStatus.Scheduled);
    expect(ctx.auditEntries.map((e) => e.action)).toContain('publish.retry_requested');
  });

  it('thử lại vẫn kiểm tra lại link/giấy phép', async () => {
    const ctx = setup();
    await scheduled(ctx);
    ctx.threads.failNext = new ThreadsPublishError('NOT_SENT', 'Lỗi tạm thời.');
    await ctx.service.runDue(at);
    ctx.state.link = { ok: false, reason: 'Link đã bị thu hồi.' };
    await expect(ctx.service.retry(ORG_A, ACTOR, POST, {}, at)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(postRow(ctx).status).toBe(ContentStatus.Failed);
  });

  it('chỉ thử lại bài FAILED', async () => {
    const ctx = setup();
    approvedPost(ctx);
    await expect(ctx.service.retry(ORG_A, ACTOR, POST, {}, at)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PublishingService.recoverStale', () => {
  it('việc PUBLISHING quá lâu -> FAILED/UNKNOWN, không tự thử lại; việc mới thì giữ nguyên', async () => {
    const ctx = setup();
    await scheduled(ctx);
    const claimedAt = new Date(LATER.getTime() + 1000);
    Object.assign(jobRow(ctx), { status: 'PUBLISHING', startedAt: claimedAt, attempts: 1 });
    postRow(ctx).status = ContentStatus.Publishing;

    expect(await ctx.service.recoverStale(new Date(claimedAt.getTime() + 5 * 60_000))).toBe(0);
    expect(jobRow(ctx).status).toBe('PUBLISHING');

    expect(await ctx.service.recoverStale(new Date(claimedAt.getTime() + 11 * 60_000))).toBe(1);
    expect(jobRow(ctx)).toMatchObject({ status: 'FAILED', failureKind: 'UNKNOWN', retrySafe: false });
    expect(postRow(ctx).status).toBe(ContentStatus.Failed);
    expect(ctx.threads.published.size).toBe(0);
  });
});

describe('đọc', () => {
  it('getForPost trả việc đăng và không lộ bài của tổ chức khác', async () => {
    const ctx = setup();
    await scheduled(ctx);
    const info = await ctx.service.getForPost(ORG_A, POST);
    expect(info.jobs.length).toBe(1);
    expect(info.published).toBeNull();
    await expect(ctx.service.getForPost(ORG_B, POST)).rejects.toBeInstanceOf(NotFoundException);
  });
});
