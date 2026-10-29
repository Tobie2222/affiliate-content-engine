import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { AffiliateLinksService } from '../affiliate/affiliate-links.service';
import { AgentEventType } from '../agents/agent.types';
import { AgentOfficeService } from '../agents/agent-office.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { composeText, normalizeText } from '../content/content-rules';
import {
  ContentStateMachine,
  ContentStatus,
  ContentTransitionError,
  RequirementState,
} from '../content/content-state-machine';
import { ContentPost } from '../content/entities/content-post.entity';
import { PostApproval } from '../content/entities/post-approval.entity';
import { MediaService } from '../media/media.service';
import { CreateSocialAccountDto, RetryPublishDto, SchedulePostDto } from './dto/publishing.dto';
import { PublishFailureKind, PublishJob } from './entities/publish-job.entity';
import { PublishedPost } from './entities/published-post.entity';
import { SocialAccount } from './entities/social-account.entity';
import {
  buildIdempotencyKey,
  isStalePublishing,
  normalizeHandle,
  sanitizeError,
  STALE_PUBLISHING_MINUTES,
  validateScheduleTime,
} from './publish-rules';
import { THREADS_PROVIDER, ThreadsProvider, ThreadsPublishError } from './providers/threads-provider.types';
import { UnavailableThreadsProvider } from './providers/unavailable-threads.provider';

const DUE_BATCH = 10;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export interface RuntimeChecks {
  checks: { socialAccountActive: boolean; affiliateLink: RequirementState; mediaRights: RequirementState };
  failures: string[];
  affiliateUrl: string | null;
}

export type JobOutcome = 'PUBLISHED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';

@Injectable()
export class PublishingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SocialAccount) private readonly accounts: Repository<SocialAccount>,
    @InjectRepository(PublishJob) private readonly jobs: Repository<PublishJob>,
    @InjectRepository(PublishedPost) private readonly published: Repository<PublishedPost>,
    @InjectRepository(ContentPost) private readonly posts: Repository<ContentPost>,
    @InjectRepository(PostApproval) private readonly approvals: Repository<PostApproval>,
    @Inject(THREADS_PROVIDER) private readonly threads: ThreadsProvider,
    private readonly links: AffiliateLinksService,
    private readonly media: MediaService,
    private readonly office: AgentOfficeService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  // ---------- Tài khoản ----------

  listAccounts(organizationId: string): Promise<SocialAccount[]> {
    return this.accounts.find({ where: { organizationId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Kết nối tài khoản. Hiện chỉ có tài khoản MOCK (chạy thử, không đăng thật, không lưu token).
   * Kết nối Threads thật (OAuth) chưa được làm nên bị từ chối rõ ràng thay vì giả vờ thành công.
   */
  async createAccount(organizationId: string, actorId: string, dto: CreateSocialAccountDto): Promise<SocialAccount> {
    if ((this.config.get<string>('THREADS_PROVIDER') ?? 'mock') !== 'mock') {
      throw UnavailableThreadsProvider.connectError();
    }
    const handle = normalizeHandle(dto.handle);
    if (!handle) {
      throw new BadRequestException('Tên tài khoản chỉ gồm chữ thường, số, dấu chấm, gạch dưới (tối đa 30 ký tự).');
    }
    try {
      const saved = await this.accounts.save(
        this.accounts.create({
          organizationId,
          platform: 'THREADS',
          handle,
          displayName: dto.displayName.trim(),
          externalAccountId: `mock-${randomUUID()}`,
          mode: 'MOCK',
          status: 'ACTIVE',
          connectedBy: actorId,
        }),
      );
      await this.audit.record({
        organizationId,
        actorId,
        action: 'social_account.connected',
        entityType: 'social_account',
        entityId: saved.id,
        metadata: { handle, mode: 'MOCK' },
      });
      return saved;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Tài khoản này đã được kết nối trong tổ chức.');
      }
      throw error;
    }
  }

  async disconnectAccount(organizationId: string, actorId: string, accountId: string): Promise<SocialAccount> {
    const account = await this.requireAccount(organizationId, accountId);
    const active = await this.jobs.find({ where: { organizationId, socialAccountId: account.id, status: 'QUEUED' } });
    const publishing = await this.jobs.find({ where: { organizationId, socialAccountId: account.id, status: 'PUBLISHING' } });
    if (active.length + publishing.length > 0) {
      throw new ConflictException(
        `Tài khoản còn ${active.length + publishing.length} bài đang chờ đăng. Hãy hủy lịch các bài đó trước khi ngắt kết nối.`,
      );
    }
    await this.accounts.update({ id: account.id, organizationId }, { status: 'DISCONNECTED' });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'social_account.disconnected',
      entityType: 'social_account',
      entityId: account.id,
    });
    return this.requireAccount(organizationId, accountId);
  }

  // ---------- Đọc ----------

  async getForPost(organizationId: string, postId: string) {
    await this.requirePost(organizationId, postId);
    const [jobs, published] = await Promise.all([
      this.jobs.find({ where: { organizationId, contentPostId: postId }, order: { createdAt: 'DESC' } }),
      this.published.findOne({ where: { organizationId, contentPostId: postId } }),
    ]);
    return { jobs, published };
  }

  // ---------- Lên lịch / hủy lịch / thử lại ----------

  async schedule(
    organizationId: string,
    actorId: string,
    postId: string,
    dto: SchedulePostDto,
    now = new Date(),
  ): Promise<{ post: ContentPost; job: PublishJob }> {
    const post = await this.requirePost(organizationId, postId);
    if (post.status !== ContentStatus.Approved) {
      throw new ConflictException(`Chỉ lên lịch được bài đã duyệt (hiện là ${post.status}).`);
    }
    if (dto.expectedVersion !== post.contentVersion) {
      throw new ConflictException(
        `Bạn đang xem phiên bản ${dto.expectedVersion} nhưng bài hiện ở phiên bản ${post.contentVersion}. Hãy tải lại.`,
      );
    }
    const account = await this.requireAccount(organizationId, dto.socialAccountId);
    const when = new Date(dto.scheduledFor);
    const timeCheck = validateScheduleTime(when, now);
    if (!timeCheck.ok) {
      throw new BadRequestException(timeCheck.reason);
    }

    const approvedVersion = await this.approvedVersion(organizationId, post);
    const runtime = await this.runtimeChecks(post, account);
    this.assertTransition(ContentStatus.Approved, ContentStatus.Scheduled, {
      currentVersion: post.contentVersion,
      approvedVersion,
      checks: runtime.checks,
    }, runtime.failures);

    const job = await this.insertScheduled(organizationId, actorId, post, account.id, when);
    await this.audit.record({
      organizationId,
      actorId,
      action: 'publish.scheduled',
      entityType: 'content_post',
      entityId: post.id,
      metadata: { jobId: job.id, socialAccountId: account.id, scheduledFor: when.toISOString(), version: post.contentVersion },
    });
    await this.safeEmit(organizationId, AgentEventType.Note, `Đã lên lịch đăng bài lúc ${when.toISOString()}`);
    return { post: await this.requirePost(organizationId, postId), job };
  }

  async unschedule(organizationId: string, actorId: string, postId: string): Promise<ContentPost> {
    const post = await this.requirePost(organizationId, postId);
    if (post.status !== ContentStatus.Scheduled) {
      throw new ConflictException(`Chỉ hủy lịch được bài đang chờ đăng (hiện là ${post.status}).`);
    }
    const approvedVersion = await this.approvedVersion(organizationId, post);
    this.assertTransition(ContentStatus.Scheduled, ContentStatus.Approved, {
      currentVersion: post.contentVersion,
      approvedVersion,
    });
    await this.dataSource.transaction(async (manager) => {
      const jobResult = await manager.getRepository(PublishJob).update(
        { organizationId, contentPostId: post.id, status: 'QUEUED' },
        { status: 'CANCELLED', finishedAt: new Date(), lastError: 'Người dùng hủy lịch.' },
      );
      const postResult = await manager.getRepository(ContentPost).update(
        { id: post.id, organizationId, status: ContentStatus.Scheduled, contentVersion: post.contentVersion },
        { status: ContentStatus.Approved },
      );
      // Việc đã bị worker nhận (không còn QUEUED) hoặc bài vừa đổi: hủy không còn an toàn.
      if (jobResult.affected !== 1 || postResult.affected !== 1) {
        throw new ConflictException('Bài đã bắt đầu được đăng hoặc vừa thay đổi. Hãy tải lại.');
      }
    });
    await this.audit.record({ organizationId, actorId, action: 'publish.unscheduled', entityType: 'content_post', entityId: post.id });
    return this.requirePost(organizationId, postId);
  }

  /**
   * Đăng lại bài FAILED. Nếu lần trước thất bại với kết quả KHÔNG RÕ (UNKNOWN), người dùng phải xác nhận
   * đã kiểm tra trên Threads và bài chưa được đăng; nếu không, từ chối để tránh đăng trùng.
   */
  async retry(
    organizationId: string,
    actorId: string,
    postId: string,
    dto: RetryPublishDto,
    now = new Date(),
  ): Promise<{ post: ContentPost; job: PublishJob }> {
    const post = await this.requirePost(organizationId, postId);
    if (post.status !== ContentStatus.Failed) {
      throw new ConflictException(`Chỉ thử lại được bài đăng thất bại (hiện là ${post.status}).`);
    }
    const [last] = await this.jobs.find({ where: { organizationId, contentPostId: post.id, status: 'FAILED' }, order: { createdAt: 'DESC' } });
    if (!last || last.contentVersion !== post.contentVersion) {
      throw new ConflictException('Không tìm thấy lần đăng thất bại tương ứng với phiên bản hiện tại của bài.');
    }
    const retrySafe = last.retrySafe === true || dto.confirmNotPublished === true;
    if (!retrySafe) {
      throw new ConflictException(
        'Lần đăng trước không rõ kết quả: bài có thể đã lên Threads. Hãy kiểm tra trực tiếp trên Threads; nếu chưa có bài, gửi lại kèm xác nhận.',
      );
    }
    const when = dto.scheduledFor ? new Date(dto.scheduledFor) : now;
    if (dto.scheduledFor) {
      const timeCheck = validateScheduleTime(when, now);
      if (!timeCheck.ok) {
        throw new BadRequestException(timeCheck.reason);
      }
    }
    const account = await this.requireAccount(organizationId, last.socialAccountId);
    const approvedVersion = await this.approvedVersion(organizationId, post);
    const runtime = await this.runtimeChecks(post, account);
    this.assertTransition(ContentStatus.Failed, ContentStatus.Scheduled, {
      currentVersion: post.contentVersion,
      approvedVersion,
      checks: runtime.checks,
      retrySafe: true,
    }, runtime.failures);

    const job = await this.dataSource.transaction(async (manager) => {
      const postResult = await manager.getRepository(ContentPost).update(
        { id: post.id, organizationId, status: ContentStatus.Failed, contentVersion: post.contentVersion },
        { status: ContentStatus.Scheduled },
      );
      const jobResult = await manager.getRepository(PublishJob).update(
        { id: last.id, organizationId, status: 'FAILED' },
        { status: 'QUEUED', scheduledFor: when, startedAt: null, finishedAt: null, failureKind: null, retrySafe: null, lastError: null },
      );
      if (postResult.affected !== 1 || jobResult.affected !== 1) {
        throw new ConflictException('Bài vừa thay đổi. Hãy tải lại.');
      }
      return { ...last, status: 'QUEUED' as const, scheduledFor: when };
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'publish.retry_requested',
      entityType: 'content_post',
      entityId: post.id,
      metadata: { jobId: last.id, previousFailureKind: last.failureKind, confirmedNotPublished: dto.confirmNotPublished === true },
    });
    return { post: await this.requirePost(organizationId, postId), job };
  }

  // ---------- Worker ----------

  /** Một vòng xử lý: dọn việc treo, rồi đăng các việc đã đến giờ. Gọi định kỳ bởi worker hoặc thủ công (dev). */
  async runDue(now = new Date(), organizationId?: string): Promise<{ recovered: number; results: Array<{ jobId: string; outcome: JobOutcome }> }> {
    const recovered = await this.recoverStale(now, organizationId);
    const due = await this.jobs.find({
      where: { status: 'QUEUED', scheduledFor: LessThanOrEqual(now), ...(organizationId ? { organizationId } : {}) },
      order: { scheduledFor: 'ASC' },
      take: DUE_BATCH,
    });
    const results: Array<{ jobId: string; outcome: JobOutcome }> = [];
    for (const job of due) {
      try {
        results.push({ jobId: job.id, outcome: await this.publishJob(job.id, now) });
      } catch {
        // Một việc lỗi không được chặn các việc khác; trạng thái việc/bài đã được xử lý bên trong publishJob.
        results.push({ jobId: job.id, outcome: 'SKIPPED' });
      }
    }
    return { recovered, results };
  }

  /** Việc PUBLISHING quá lâu: không rõ bài đã đăng hay chưa. Không tự thử lại, chờ người đối soát. */
  async recoverStale(now: Date, organizationId?: string): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_PUBLISHING_MINUTES * 60_000);
    const stale = await this.jobs.find({
      where: { status: 'PUBLISHING', startedAt: LessThan(cutoff), ...(organizationId ? { organizationId } : {}) },
    });
    let recovered = 0;
    for (const job of stale) {
      if (!isStalePublishing(job.startedAt, now)) {
        continue;
      }
      const message = 'Quá thời gian chờ phản hồi: chưa rõ bài đã được đăng hay chưa. Hãy kiểm tra trên Threads.';
      const moved = await this.dataSource.transaction(async (manager) => {
        const jobResult = await manager.getRepository(PublishJob).update(
          { id: job.id, status: 'PUBLISHING', attempts: job.attempts },
          { status: 'FAILED', finishedAt: now, failureKind: 'UNKNOWN', retrySafe: false, lastError: message },
        );
        if (jobResult.affected !== 1) {
          return false;
        }
        await manager.getRepository(ContentPost).update(
          { id: job.contentPostId, organizationId: job.organizationId, status: ContentStatus.Publishing },
          { status: ContentStatus.Failed },
        );
        return true;
      });
      if (moved) {
        recovered += 1;
        await this.audit.record({
          organizationId: job.organizationId,
          action: 'publish.recovered_unknown',
          entityType: 'content_post',
          entityId: job.contentPostId,
          metadata: { jobId: job.id },
        });
      }
    }
    return recovered;
  }

  /** Xử lý một việc đã đến giờ. Mọi nhánh kết thúc ở một trạng thái rõ ràng của cả việc lẫn bài. */
  async publishJob(jobId: string, now = new Date()): Promise<JobOutcome> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job || job.status !== 'QUEUED' || job.scheduledFor.getTime() > now.getTime()) {
      return 'SKIPPED';
    }
    const post = await this.posts.findOne({ where: { id: job.contentPostId, organizationId: job.organizationId } });
    if (!post || post.status !== ContentStatus.Scheduled || post.contentVersion !== job.contentVersion) {
      await this.jobs.update(
        { id: job.id, status: 'QUEUED' },
        { status: 'CANCELLED', finishedAt: now, lastError: 'Bài không còn ở trạng thái chờ đăng hoặc nội dung đã đổi.' },
      );
      return 'SKIPPED';
    }

    // Agent "Đăng bài" đang tạm dừng ("Dừng tự chạy"): để việc nằm lại hàng chờ, không đăng.
    try {
      await this.office.emit({
        organizationId: job.organizationId,
        agentKey: 'publisher',
        type: AgentEventType.TaskStarted,
        message: 'Đang đăng bài đã lên lịch',
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        return 'SKIPPED';
      }
    }

    const account = await this.accounts.findOne({ where: { id: job.socialAccountId, organizationId: job.organizationId } });
    const approvedVersion = await this.approvedVersion(job.organizationId, post);
    const runtime = account
      ? await this.runtimeChecks(post, account, now)
      : { checks: { socialAccountActive: false, affiliateLink: 'FAILED' as const, mediaRights: 'FAILED' as const }, failures: ['Không tìm thấy tài khoản.'], affiliateUrl: null };

    const gate = ContentStateMachine.evaluate(ContentStatus.Scheduled, ContentStatus.Publishing, {
      currentVersion: post.contentVersion,
      approvedVersion,
      checks: runtime.checks,
    });
    if (!gate.ok || !account) {
      const reason = runtime.failures.length > 0 ? runtime.failures.join(' ') : gate.ok ? 'Không có tài khoản.' : gate.reason;
      await this.blockScheduled(job, reason, now);
      return 'BLOCKED';
    }

    // Nhận việc: chỉ một worker thắng (cập nhật có điều kiện cả việc lẫn bài).
    const claimed = await this.dataSource.transaction(async (manager) => {
      const jobResult = await manager.getRepository(PublishJob).update(
        { id: job.id, status: 'QUEUED', attempts: job.attempts },
        { status: 'PUBLISHING', attempts: job.attempts + 1, startedAt: now },
      );
      if (jobResult.affected !== 1) {
        return false;
      }
      const postResult = await manager.getRepository(ContentPost).update(
        { id: post.id, organizationId: job.organizationId, status: ContentStatus.Scheduled, contentVersion: job.contentVersion },
        { status: ContentStatus.Publishing },
      );
      if (postResult.affected !== 1) {
        throw new ConflictException('Bài vừa thay đổi.');
      }
      return true;
    }).catch((error: unknown) => {
      if (error instanceof ConflictException) {
        return false;
      }
      throw error;
    });
    if (!claimed) {
      return 'SKIPPED';
    }

    const text = composeText(post.body, post.disclosureText, runtime.affiliateUrl);
    try {
      const result = await this.threads.publishText({
        idempotencyKey: job.idempotencyKey,
        accountExternalId: account.externalAccountId ?? '',
        text,
        hasMedia: post.mediaAssetId !== null,
      });
      await this.dataSource.transaction(async (manager) => {
        const jobResult = await manager.getRepository(PublishJob).update(
          { id: job.id, status: 'PUBLISHING' },
          { status: 'SUCCEEDED', finishedAt: now, externalPostId: result.externalPostId },
        );
        const postResult = await manager.getRepository(ContentPost).update(
          { id: post.id, organizationId: job.organizationId, status: ContentStatus.Publishing },
          { status: ContentStatus.Published },
        );
        if (jobResult.affected !== 1 || postResult.affected !== 1) {
          throw new ConflictException('Không ghi được kết quả đăng.');
        }
        const repo = manager.getRepository(PublishedPost);
        await repo.save(
          repo.create({
            organizationId: job.organizationId,
            contentPostId: post.id,
            socialAccountId: account.id,
            publishJobId: job.id,
            externalPostId: result.externalPostId,
            permalink: result.permalink,
            publishedAt: now,
          }),
        );
      });
      await this.audit.record({
        organizationId: job.organizationId,
        action: 'publish.succeeded',
        entityType: 'content_post',
        entityId: post.id,
        metadata: { jobId: job.id, externalPostId: result.externalPostId, mode: this.threads.mode },
      });
      await this.safeEmit(job.organizationId, AgentEventType.TaskCompleted, 'Đã đăng bài');
      return 'PUBLISHED';
    } catch (error) {
      // Nếu lỗi nằm ở bước GHI KẾT QUẢ sau khi đã đăng, việc vẫn ở PUBLISHING và sẽ được đánh dấu UNKNOWN khi quá hạn.
      const wrote = error instanceof ConflictException;
      if (wrote) {
        return 'SKIPPED';
      }
      const kind: PublishFailureKind = error instanceof ThreadsPublishError ? error.kind : 'UNKNOWN';
      const message = error instanceof ThreadsPublishError ? sanitizeError(error.message) : 'Lỗi không xác định khi gửi bài đi.';
      await this.failPublishing(job, post.id, kind, message, now);
      return 'FAILED';
    }
  }

  // ---------- Nội bộ ----------

  private async failPublishing(job: PublishJob, postId: string, kind: PublishFailureKind, message: string, now: Date): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(PublishJob).update(
        { id: job.id, status: 'PUBLISHING' },
        { status: 'FAILED', finishedAt: now, failureKind: kind, retrySafe: kind === 'NOT_SENT', lastError: message },
      );
      await manager.getRepository(ContentPost).update(
        { id: postId, organizationId: job.organizationId, status: ContentStatus.Publishing },
        { status: ContentStatus.Failed },
      );
    });
    await this.audit.record({
      organizationId: job.organizationId,
      action: 'publish.failed',
      entityType: 'content_post',
      entityId: postId,
      metadata: { jobId: job.id, failureKind: kind },
    });
    await this.safeEmit(job.organizationId, AgentEventType.TaskFailed, `Đăng bài thất bại: ${message}`);
  }

  private async blockScheduled(job: PublishJob, reason: string, now: Date): Promise<void> {
    const text = sanitizeError(`Không đăng vì: ${reason}`);
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(PublishJob).update(
        { id: job.id, status: 'QUEUED' },
        { status: 'CANCELLED', finishedAt: now, lastError: text },
      );
      await manager.getRepository(ContentPost).update(
        { id: job.contentPostId, organizationId: job.organizationId, status: ContentStatus.Scheduled },
        { status: ContentStatus.Blocked, blockedReason: text },
      );
    });
    await this.audit.record({
      organizationId: job.organizationId,
      action: 'publish.blocked',
      entityType: 'content_post',
      entityId: job.contentPostId,
      metadata: { jobId: job.id, reason: text },
    });
    await this.safeEmit(job.organizationId, AgentEventType.TaskFailed, text);
  }

  private async insertScheduled(
    organizationId: string,
    actorId: string,
    post: ContentPost,
    socialAccountId: string,
    when: Date,
  ): Promise<PublishJob> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const postResult = await manager.getRepository(ContentPost).update(
          { id: post.id, organizationId, status: ContentStatus.Approved, contentVersion: post.contentVersion },
          { status: ContentStatus.Scheduled },
        );
        if (postResult.affected !== 1) {
          throw new ConflictException('Bài vừa thay đổi. Hãy tải lại.');
        }
        const repo = manager.getRepository(PublishJob);
        return repo.save(
          repo.create({
            organizationId,
            contentPostId: post.id,
            socialAccountId,
            contentVersion: post.contentVersion,
            scheduledFor: when,
            status: 'QUEUED',
            idempotencyKey: buildIdempotencyKey(post.id, post.contentVersion, randomUUID()),
            attempts: 0,
            startedAt: null,
            finishedAt: null,
            externalPostId: null,
            failureKind: null,
            retrySafe: null,
            lastError: null,
            scheduledBy: actorId,
          }),
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Bài này đã có lịch đăng đang hoạt động.');
      }
      throw error;
    }
  }

  /** Kiểm tra lại NGAY LÚC lên lịch và NGAY TRƯỚC khi đăng: tài khoản, link affiliate, giấy phép media (và dòng ghi nguồn). */
  async runtimeChecks(post: ContentPost, account: SocialAccount, now = new Date()): Promise<RuntimeChecks> {
    const failures: string[] = [];
    const production = this.config.get<string>('NODE_ENV') === 'production';

    let socialAccountActive = account.status === 'ACTIVE';
    if (!socialAccountActive) {
      failures.push('Tài khoản Threads không ở trạng thái hoạt động.');
    }
    if (account.mode === 'MOCK' && production) {
      socialAccountActive = false;
      failures.push('Tài khoản giả lập (MOCK) không được dùng để đăng trên production.');
    }

    let affiliateLink: RequirementState = 'OK';
    let affiliateUrl: string | null = null;
    try {
      const link = await this.links.get(post.organizationId, post.affiliateLinkId);
      affiliateUrl = link.affiliateUrl;
      if (link.productId !== post.productId) {
        affiliateLink = 'FAILED';
        failures.push('Link affiliate không thuộc sản phẩm của bài.');
      } else if (!link.publishable.ok) {
        affiliateLink = 'FAILED';
        failures.push(`Link affiliate chưa đăng được: ${link.publishable.reason}`);
      }
    } catch {
      affiliateLink = 'FAILED';
      failures.push('Không tìm thấy link affiliate của bài.');
    }

    let mediaRights: RequirementState = 'NOT_REQUIRED';
    if (post.mediaAssetId) {
      mediaRights = 'OK';
      try {
        const assessment = await this.media.assertUsable(post.organizationId, post.mediaAssetId, now);
        const full = normalizeText(`${post.body}\n${post.disclosureText}`);
        for (const attribution of assessment.attributions ?? []) {
          if (!full.includes(normalizeText(attribution))) {
            mediaRights = 'FAILED';
            failures.push(`Media yêu cầu ghi nguồn nhưng bài thiếu dòng: "${attribution}".`);
          }
        }
      } catch (error) {
        mediaRights = 'FAILED';
        failures.push(error instanceof Error ? error.message : 'Giấy phép media không hợp lệ.');
      }
    }

    return { checks: { socialAccountActive, affiliateLink, mediaRights }, failures, affiliateUrl };
  }

  /** Phiên bản của lần duyệt APPROVED gần nhất khớp phiên bản hiện tại; null nếu không có (bài chưa được duyệt đúng bản). */
  private async approvedVersion(organizationId: string, post: ContentPost): Promise<number | null> {
    const approvals = await this.approvals.find({ where: { organizationId, contentPostId: post.id } });
    const match = approvals.find((a) => a.decision === 'APPROVED' && a.contentVersion === post.contentVersion);
    return match ? match.contentVersion : null;
  }

  private assertTransition(
    from: ContentStatus,
    to: ContentStatus,
    ctx: Parameters<typeof ContentStateMachine.assert>[2],
    failures: string[] = [],
  ): void {
    try {
      ContentStateMachine.assert(from, to, ctx);
    } catch (error) {
      if (error instanceof ContentTransitionError) {
        if (error.code === 'GUARD_FAILED') {
          const detail = failures.length > 0 ? failures.join(' ') : error.reason;
          throw new UnprocessableEntityException(detail);
        }
        throw new ConflictException(error.reason);
      }
      throw error;
    }
  }

  private async requirePost(organizationId: string, postId: string): Promise<ContentPost> {
    const post = await this.posts.findOne({ where: { id: postId, organizationId } });
    if (!post) {
      throw new NotFoundException('Không tìm thấy bài viết.');
    }
    return post;
  }

  private async requireAccount(organizationId: string, accountId: string): Promise<SocialAccount> {
    const account = await this.accounts.findOne({ where: { id: accountId, organizationId } });
    if (!account) {
      throw new NotFoundException('Không tìm thấy tài khoản mạng xã hội.');
    }
    return account;
  }

  private async safeEmit(
    organizationId: string,
    type: Exclude<AgentEventType, AgentEventType.StatusChanged | AgentEventType.Handoff>,
    message: string,
  ): Promise<void> {
    try {
      await this.office.emit({ organizationId, agentKey: 'publisher', type, message });
    } catch {
      // Phần hiển thị không được làm hỏng nghiệp vụ đã xong.
    }
  }
}
