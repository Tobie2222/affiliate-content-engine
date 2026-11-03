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
import { CreateSocialAccountDto, MarkPublishedDto, RetryCommentDto, RetryPublishDto, SchedulePostDto } from './dto/publishing.dto';
import { PublishFailureKind, PublishJob } from './entities/publish-job.entity';
import { PublishedPost } from './entities/published-post.entity';
import { SocialAccount } from './entities/social-account.entity';
import {
  buildIdempotencyKey,
  COMMENT_PICKUP_SECONDS,
  composeCommentText,
  isPlausibleAccessToken,
  isStalePublishing,
  normalizeHandle,
  parseThreadsPermalink,
  sanitizeError,
  STALE_COMMENT_MINUTES,
  STALE_PUBLISHING_MINUTES,
  validateManualPublishedAt,
  validateScheduleTime,
} from './publish-rules';
import { THREADS_PROVIDER, ThreadsProfile, ThreadsProvider, ThreadsPublishError } from './providers/threads-provider.types';
import { SocialCredentialsService } from './social-credentials.service';

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
    private readonly credentials: SocialCredentialsService,
  ) {}

  // ---------- Tài khoản ----------

  listAccounts(organizationId: string): Promise<SocialAccount[]> {
    return this.accounts.find({ where: { organizationId }, order: { createdAt: 'DESC' } });
  }

  /** Cho giao diện biết hệ thống đang ở chế độ giả lập hay Threads thật (để hiện đúng biểu mẫu kết nối). */
  providerInfo(): { mode: 'mock' | 'live' } {
    return { mode: this.threads.mode };
  }

  /**
   * Kết nối tài khoản.
   * - Chế độ giả lập (mặc định): tạo tài khoản MOCK, không đăng thật, không lưu token.
   * - Chế độ Threads thật: cần dán token; hệ thống gọi Threads để xác thực, tên tài khoản phải khớp với token, rồi lưu token ĐÃ MÃ HÓA.
   * Tài khoản đã ngắt kết nối hoặc cần xác thực lại được kết nối lại (cập nhật token) thay vì báo trùng.
   */
  async createAccount(organizationId: string, actorId: string, dto: CreateSocialAccountDto): Promise<SocialAccount> {
    const handle = normalizeHandle(dto.handle);
    if (!handle) {
      throw new BadRequestException('Tên tài khoản chỉ gồm chữ thường, số, dấu chấm, gạch dưới (tối đa 30 ký tự).');
    }
    const live = this.threads.mode === 'live';
    const token = dto.accessToken?.trim() ?? '';
    let externalAccountId = `mock-${randomUUID()}`;
    if (live) {
      if (!token) {
        throw new BadRequestException('Cần dán access token Threads để kết nối tài khoản thật.');
      }
      if (!isPlausibleAccessToken(token)) {
        throw new BadRequestException('Token có ký tự không hợp lệ (xuống dòng, khoảng trắng...). Hãy dán lại đúng token.');
      }
      let profile: ThreadsProfile;
      try {
        profile = await this.threads.fetchProfile(token);
      } catch (error) {
        if (error instanceof ThreadsPublishError) {
          throw new BadRequestException(`Token không dùng được: ${sanitizeError(error.message)}`);
        }
        throw error;
      }
      if (normalizeHandle(profile.username) !== handle) {
        throw new BadRequestException(`Token thuộc tài khoản @${profile.username.toLowerCase()}, không phải @${handle}.`);
      }
      externalAccountId = profile.id;
    } else if (token) {
      throw new BadRequestException('Chế độ giả lập không nhận token. Đặt THREADS_PROVIDER=official để kết nối Threads thật.');
    }
    const mode = live ? ('OFFICIAL' as const) : ('MOCK' as const);
    const displayName = dto.displayName.trim();

    try {
      const existing = await this.accounts.findOne({ where: { organizationId, platform: 'THREADS', handle } });
      if (existing && existing.status === 'ACTIVE') {
        throw new ConflictException('Tài khoản này đã được kết nối trong tổ chức.');
      }
      const saved = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(SocialAccount);
        let account: SocialAccount;
        if (existing) {
          await repo.update(
            { id: existing.id, organizationId },
            { displayName, externalAccountId, mode, status: 'ACTIVE', connectedBy: actorId },
          );
          account = { ...existing, displayName, externalAccountId, mode, status: 'ACTIVE', connectedBy: actorId };
        } else {
          account = await repo.save(
            repo.create({ organizationId, platform: 'THREADS', handle, displayName, externalAccountId, mode, status: 'ACTIVE', connectedBy: actorId }),
          );
        }
        if (live) {
          await this.credentials.store(manager, organizationId, account.id, token);
        }
        return account;
      });
      await this.audit.record({
        organizationId,
        actorId,
        action: existing ? 'social_account.reconnected' : 'social_account.connected',
        entityType: 'social_account',
        entityId: saved.id,
        metadata: { handle, mode },
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
    await this.credentials.remove(organizationId, account.id);
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

  /**
   * Ghi nhận bài ĐÃ có trên Threads dù hệ thống báo thất bại hoặc không rõ kết quả.
   * Người dùng phải xác nhận đã mở Threads và thấy bài; link phải đúng tài khoản đã chọn để đăng.
   * Bài chuyển FAILED -> PUBLISHED nên không thể đăng lại (tránh đăng trùng) và vào được báo cáo phân tích.
   */
  async markPublishedManually(
    organizationId: string,
    actorId: string,
    postId: string,
    dto: MarkPublishedDto,
    now = new Date(),
  ): Promise<{ post: ContentPost; published: PublishedPost }> {
    const post = await this.requirePost(organizationId, postId);
    if (post.status !== ContentStatus.Failed) {
      throw new ConflictException(`Chỉ ghi nhận thủ công được bài đăng thất bại (hiện là ${post.status}).`);
    }
    const [last] = await this.jobs.find({ where: { organizationId, contentPostId: post.id, status: 'FAILED' }, order: { createdAt: 'DESC' } });
    if (!last || last.contentVersion !== post.contentVersion) {
      throw new ConflictException('Không tìm thấy lần đăng thất bại tương ứng với phiên bản hiện tại của bài.');
    }
    const account = await this.requireAccount(organizationId, last.socialAccountId);
    const link = parseThreadsPermalink(dto.permalink);
    if (!link) {
      throw new BadRequestException('Link không đúng dạng bài Threads (https://www.threads.net/@tên/post/mã).');
    }
    if (link.handle !== account.handle) {
      throw new BadRequestException(`Link thuộc tài khoản @${link.handle}, không phải @${account.handle} đã chọn để đăng.`);
    }
    const publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : now;
    const timeCheck = validateManualPublishedAt(publishedAt, last.createdAt, now);
    if (!timeCheck.ok) {
      throw new BadRequestException(timeCheck.reason);
    }
    this.assertTransition(ContentStatus.Failed, ContentStatus.Published, {
      currentVersion: post.contentVersion,
      manuallyConfirmedPublished: dto.confirmPublishedOnThreads === true,
    });

    let published: PublishedPost;
    try {
      published = await this.dataSource.transaction(async (manager) => {
        const postResult = await manager.getRepository(ContentPost).update(
          { id: post.id, organizationId, status: ContentStatus.Failed, contentVersion: post.contentVersion },
          { status: ContentStatus.Published },
        );
        if (postResult.affected !== 1) {
          throw new ConflictException('Bài vừa thay đổi. Hãy tải lại.');
        }
        const repo = manager.getRepository(PublishedPost);
        return repo.save(
          repo.create({
            organizationId,
            contentPostId: post.id,
            socialAccountId: account.id,
            publishJobId: last.id,
            externalPostId: `manual:${link.code}`,
            permalink: link.url,
            publishedAt,
          }),
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Bài này hoặc link này đã được ghi nhận trước đó.');
      }
      throw error;
    }
    await this.audit.record({
      organizationId,
      actorId,
      action: 'publish.marked_manually',
      entityType: 'content_post',
      entityId: post.id,
      metadata: { jobId: last.id, previousFailureKind: last.failureKind, permalink: link.url },
    });
    await this.safeEmit(organizationId, AgentEventType.TaskCompleted, 'Đã ghi nhận bài đăng (xác nhận thủ công)');
    return { post: await this.requirePost(organizationId, postId), published };
  }

  // ---------- Worker ----------

  /** Một vòng xử lý: dọn việc treo, rồi đăng các việc đã đến giờ. Gọi định kỳ bởi worker hoặc thủ công (dev). */
  async runDue(
    now = new Date(),
    organizationId?: string,
  ): Promise<{ recovered: number; results: Array<{ jobId: string; outcome: JobOutcome }>; commentsRecovered: number; commentsHandled: number }> {
    const recovered = await this.recoverStale(now, organizationId);
    const commentsRecovered = await this.recoverStaleComments(now, organizationId);
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
    const commentsHandled = await this.pickUpPendingComments(now, organizationId);
    return { recovered, results, commentsRecovered, commentsHandled };
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

    // Bài chính chỉ có nội dung + dòng công khai hoa hồng; link affiliate đăng ở comment ngay dưới bài.
    const text = composeText(post.body, post.disclosureText, null);
    let accessToken: string | null = null;
    if (account.mode === 'OFFICIAL') {
      try {
        accessToken = await this.credentials.tokenFor(job.organizationId, account.id);
      } catch {
        await this.failPublishing(job, post.id, 'NOT_SENT', 'Không đọc được token đã lưu (sai TOKEN_ENCRYPTION_KEY?). Hãy kết nối lại tài khoản.', now);
        return 'FAILED';
      }
    }
    let published: PublishedPost;
    let externalPostId: string;
    try {
      const result = await this.threads.publishText({
        idempotencyKey: job.idempotencyKey,
        accountExternalId: account.externalAccountId ?? '',
        accessToken,
        text,
        hasMedia: post.mediaAssetId !== null,
      });
      externalPostId = result.externalPostId;
      published = await this.dataSource.transaction(async (manager) => {
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
        return repo.save(
          repo.create({
            organizationId: job.organizationId,
            contentPostId: post.id,
            socialAccountId: account.id,
            publishJobId: job.id,
            externalPostId: result.externalPostId,
            permalink: result.permalink,
            publishedAt: now,
            commentStatus: runtime.affiliateUrl ? 'PENDING' : 'NONE',
          }),
        );
      });
    } catch (error) {
      // Nếu lỗi nằm ở bước GHI KẾT QUẢ sau khi đã đăng, việc vẫn ở PUBLISHING và sẽ được đánh dấu UNKNOWN khi quá hạn.
      const wrote = error instanceof ConflictException;
      if (wrote) {
        return 'SKIPPED';
      }
      const kind: PublishFailureKind = error instanceof ThreadsPublishError ? error.kind : 'UNKNOWN';
      const message = error instanceof ThreadsPublishError ? sanitizeError(error.message) : 'Lỗi không xác định khi gửi bài đi.';
      await this.failPublishing(job, post.id, kind, message, now);
      if (error instanceof ThreadsPublishError && error.reason === 'AUTH') {
        await this.markNeedsReauth(job.organizationId, account.id);
      }
      return 'FAILED';
    }
    await this.audit.record({
      organizationId: job.organizationId,
      action: 'publish.succeeded',
      entityType: 'content_post',
      entityId: post.id,
      metadata: { jobId: job.id, externalPostId, mode: this.threads.mode },
    });
    await this.safeEmit(job.organizationId, AgentEventType.TaskCompleted, 'Đã đăng bài');
    // Comment chứa link: lỗi ở đây KHÔNG ảnh hưởng bài đã đăng (xem attemptComment).
    await this.attemptComment(job.organizationId, published.id, now);
    return 'PUBLISHED';
  }

  // ---------- Comment chứa link affiliate ----------

  /**
   * Đăng comment chứa link dưới bài chính. Chỉ một tiến trình thắng quyền gửi (PENDING -> POSTING có điều kiện).
   * Kết quả ghi vào published_posts.comment_*: lỗi comment không bao giờ làm bài đã đăng bị đăng lại.
   * Link được kiểm tra lại ngay trước khi gửi; link không còn hợp lệ thì KHÔNG đăng.
   */
  async attemptComment(organizationId: string, publishedId: string, now = new Date()): Promise<'POSTED' | 'FAILED' | 'SKIPPED'> {
    const row = await this.published.findOne({ where: { id: publishedId, organizationId } });
    if (!row || row.commentStatus !== 'PENDING') {
      return 'SKIPPED';
    }
    const claim = await this.published.update(
      { id: row.id, organizationId, commentStatus: 'PENDING', commentAttempts: row.commentAttempts },
      { commentStatus: 'POSTING', commentAttempts: row.commentAttempts + 1, commentStartedAt: now },
    );
    if (claim.affected !== 1) {
      return 'SKIPPED';
    }
    const fail = async (kind: PublishFailureKind, message: string, reauth = false): Promise<'FAILED'> => {
      await this.published.update(
        { id: row.id, organizationId, commentStatus: 'POSTING' },
        { commentStatus: 'FAILED', commentFailureKind: kind, commentError: sanitizeError(message) },
      );
      await this.audit.record({
        organizationId,
        action: 'publish.comment_failed',
        entityType: 'content_post',
        entityId: row.contentPostId,
        metadata: { publishedPostId: row.id, kind },
      });
      if (reauth) {
        await this.markNeedsReauth(organizationId, row.socialAccountId);
      }
      return 'FAILED';
    };

    let post: ContentPost;
    let account: SocialAccount;
    let affiliateUrl: string;
    try {
      post = await this.requirePost(organizationId, row.contentPostId);
      account = await this.requireAccount(organizationId, row.socialAccountId);
      const link = await this.links.get(organizationId, post.affiliateLinkId);
      if (link.productId !== post.productId || !link.publishable.ok) {
        const why = link.publishable.ok ? 'không thuộc sản phẩm của bài' : link.publishable.reason;
        return await fail('NOT_SENT', `Link affiliate không còn đăng được nên chưa đăng comment: ${why}`);
      }
      affiliateUrl = link.affiliateUrl;
    } catch {
      return fail('NOT_SENT', 'Không kiểm tra lại được bài, tài khoản hoặc link affiliate nên chưa đăng comment.');
    }
    if (account.status !== 'ACTIVE') {
      return fail('NOT_SENT', 'Tài khoản Threads không ở trạng thái hoạt động nên chưa đăng comment. Hãy kết nối lại rồi thử lại.');
    }
    let accessToken: string | null = null;
    if (account.mode === 'OFFICIAL') {
      try {
        accessToken = await this.credentials.tokenFor(organizationId, account.id);
      } catch {
        return fail('NOT_SENT', 'Không đọc được token đã lưu (sai TOKEN_ENCRYPTION_KEY?). Hãy kết nối lại tài khoản.');
      }
    }
    try {
      const result = await this.threads.publishReply({
        idempotencyKey: `ace:comment:${row.id}`,
        accountExternalId: account.externalAccountId ?? '',
        accessToken,
        replyToExternalId: row.externalPostId,
        text: composeCommentText(affiliateUrl),
      });
      await this.published.update(
        { id: row.id, organizationId, commentStatus: 'POSTING' },
        { commentStatus: 'POSTED', commentExternalId: result.externalPostId, commentPostedAt: now, commentFailureKind: null, commentError: null },
      );
      await this.audit.record({
        organizationId,
        action: 'publish.comment_posted',
        entityType: 'content_post',
        entityId: row.contentPostId,
        metadata: { publishedPostId: row.id, commentExternalId: result.externalPostId },
      });
      return 'POSTED';
    } catch (error) {
      const typed = error instanceof ThreadsPublishError;
      return fail(typed ? error.kind : 'UNKNOWN', typed ? error.message : 'Lỗi không xác định khi gửi comment.', typed && error.reason === 'AUTH');
    }
  }

  /**
   * Thử lại comment lỗi. Nếu lần trước không rõ kết quả (UNKNOWN) phải xác nhận đã kiểm tra trên Threads và comment chưa có
   * (confirmNotPosted), hoặc báo comment thực ra đã có (alreadyPosted) để ghi nhận mà không đăng lại.
   */
  async retryComment(organizationId: string, actorId: string, postId: string, dto: RetryCommentDto) {
    await this.requirePost(organizationId, postId);
    const row = await this.published.findOne({ where: { organizationId, contentPostId: postId } });
    if (!row) {
      throw new ConflictException('Bài chưa được đăng.');
    }
    if (row.commentStatus !== 'FAILED') {
      throw new ConflictException(`Chỉ thử lại được comment bị lỗi (hiện là ${row.commentStatus}).`);
    }
    if (dto.alreadyPosted === true && dto.confirmNotPosted === true) {
      throw new BadRequestException('Chỉ chọn một: comment đã có hoặc comment chưa có.');
    }
    if (dto.alreadyPosted === true) {
      const done = await this.published.update(
        { id: row.id, organizationId, commentStatus: 'FAILED' },
        { commentStatus: 'POSTED', commentExternalId: 'manual', commentPostedAt: new Date(), commentFailureKind: null, commentError: null },
      );
      if (done.affected !== 1) {
        throw new ConflictException('Comment vừa thay đổi. Hãy tải lại.');
      }
      await this.audit.record({
        organizationId,
        actorId,
        action: 'publish.comment_marked_posted',
        entityType: 'content_post',
        entityId: postId,
        metadata: { publishedPostId: row.id, previousFailureKind: row.commentFailureKind },
      });
      return this.getForPost(organizationId, postId);
    }
    if (row.commentFailureKind !== 'NOT_SENT' && dto.confirmNotPosted !== true) {
      throw new ConflictException(
        'Lần đăng comment trước không rõ kết quả: comment có thể đã có trên Threads. Hãy kiểm tra trực tiếp; nếu chưa có comment, gửi lại kèm xác nhận.',
      );
    }
    const reopened = await this.published.update(
      { id: row.id, organizationId, commentStatus: 'FAILED' },
      { commentStatus: 'PENDING', commentFailureKind: null, commentError: null },
    );
    if (reopened.affected !== 1) {
      throw new ConflictException('Comment vừa thay đổi. Hãy tải lại.');
    }
    await this.audit.record({
      organizationId,
      actorId,
      action: 'publish.comment_retry_requested',
      entityType: 'content_post',
      entityId: postId,
      metadata: { publishedPostId: row.id, previousFailureKind: row.commentFailureKind, confirmedNotPosted: dto.confirmNotPosted === true },
    });
    await this.attemptComment(organizationId, row.id);
    return this.getForPost(organizationId, postId);
  }

  /** Comment đang gửi quá lâu: không rõ kết quả, không tự thử lại. */
  async recoverStaleComments(now: Date, organizationId?: string): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_COMMENT_MINUTES * 60_000);
    const stale = await this.published.find({
      where: { commentStatus: 'POSTING', commentStartedAt: LessThan(cutoff), ...(organizationId ? { organizationId } : {}) },
    });
    let recovered = 0;
    for (const row of stale) {
      const moved = await this.published.update(
        { id: row.id, commentStatus: 'POSTING', commentAttempts: row.commentAttempts },
        {
          commentStatus: 'FAILED',
          commentFailureKind: 'UNKNOWN',
          commentError: 'Quá thời gian chờ phản hồi: chưa rõ comment đã được đăng hay chưa. Hãy kiểm tra trên Threads.',
        },
      );
      if (moved.affected === 1) {
        recovered += 1;
        await this.audit.record({
          organizationId: row.organizationId,
          action: 'publish.comment_recovered_unknown',
          entityType: 'content_post',
          entityId: row.contentPostId,
          metadata: { publishedPostId: row.id },
        });
      }
    }
    return recovered;
  }

  /** Đăng bù các comment còn PENDING (tiến trình dừng giữa lúc đăng bài và đăng comment). */
  private async pickUpPendingComments(now: Date, organizationId?: string): Promise<number> {
    const cutoff = new Date(now.getTime() - COMMENT_PICKUP_SECONDS * 1000);
    const pending = await this.published.find({
      where: { commentStatus: 'PENDING', publishedAt: LessThanOrEqual(cutoff), ...(organizationId ? { organizationId } : {}) },
      order: { publishedAt: 'ASC' },
      take: DUE_BATCH,
    });
    let handled = 0;
    for (const row of pending) {
      if ((await this.attemptComment(row.organizationId, row.id, now)) !== 'SKIPPED') {
        handled += 1;
      }
    }
    return handled;
  }

  private async markNeedsReauth(organizationId: string, accountId: string): Promise<void> {
    const result = await this.accounts.update({ id: accountId, organizationId, status: 'ACTIVE' }, { status: 'NEEDS_REAUTH' });
    if (result.affected === 1) {
      await this.audit.record({
        organizationId,
        action: 'social_account.needs_reauth',
        entityType: 'social_account',
        entityId: accountId,
      });
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
    const live = this.threads.mode === 'live';
    if (account.mode === 'MOCK' && live) {
      socialAccountActive = false;
      failures.push('Tài khoản giả lập không thể đăng khi hệ thống đang ở chế độ Threads thật.');
    }
    if (account.mode === 'OFFICIAL' && !live) {
      socialAccountActive = false;
      failures.push('Tài khoản Threads thật không thể đăng khi hệ thống đang ở chế độ giả lập (THREADS_PROVIDER=mock).');
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
