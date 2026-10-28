import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AgentEventType } from '../agents/agent.types';
import { AgentOfficeService } from '../agents/agent-office.service';
import { AffiliateLinksService } from '../affiliate/affiliate-links.service';
import { Product } from '../affiliate/entities/product.entity';
import { ProductsService } from '../affiliate/products.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Organization } from '../organizations/entities/organization.entity';
import { MediaService } from '../media/media.service';
import { QaReport, RuleFinding, runQaRules } from './content-rules';
import {
  ContentStateMachine,
  ContentStatus,
  ContentTransitionError,
} from './content-state-machine';
import {
  CreatePostDto,
  DEFAULT_DISCLOSURE,
  GeneratePostsDto,
  ListPostsQuery,
  ReviewPostDto,
  UpdatePostDto,
} from './dto/content.dto';
import { ContentPostVersion } from './entities/content-post-version.entity';
import { ContentPost, StoredQaReport } from './entities/content-post.entity';
import { PostApproval } from './entities/post-approval.entity';
import { normalizeDrafts } from './llm-draft';
import { LLM_PROVIDER, LlmProvider } from './providers/llm-provider.types';

const RECENT_POSTS_FOR_DUPLICATES = 50;
const EDITABLE: ReadonlyArray<ContentStatus> = [
  ContentStatus.Draft,
  ContentStatus.ChangesRequested,
  ContentStatus.PendingApproval,
  ContentStatus.Approved,
  ContentStatus.Blocked,
];

/** So khớp không phân biệt hoa thường và khoảng trắng thừa. */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function reviewNote(note: string | undefined): string {
  return note?.trim() ?? '';
}

@Injectable()
export class ContentService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ContentPost) private readonly posts: Repository<ContentPost>,
    @InjectRepository(ContentPostVersion) private readonly versions: Repository<ContentPostVersion>,
    @InjectRepository(PostApproval) private readonly approvals: Repository<PostApproval>,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly products: ProductsService,
    private readonly links: AffiliateLinksService,
    private readonly media: MediaService,
    private readonly office: AgentOfficeService,
    private readonly audit: AuditLogsService,
  ) {}

  // ---------- Đọc ----------

  async list(organizationId: string, query: ListPostsQuery) {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const [items, total] = await this.posts.findAndCount({
      where: { organizationId, ...(query.status ? { status: query.status } : {}) },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total, limit, offset };
  }

  async get(organizationId: string, postId: string) {
    const post = await this.requirePost(organizationId, postId);
    const [versions, approvals] = await Promise.all([
      this.versions.find({ where: { organizationId, contentPostId: post.id }, order: { version: 'DESC' } }),
      this.approvals.find({ where: { organizationId, contentPostId: post.id }, order: { createdAt: 'DESC' } }),
    ]);
    return { post, versions, approvals };
  }

  // ---------- Tạo ----------

  /** Bài do người viết tay. Luôn bắt đầu ở DRAFT, phiên bản 1. */
  async create(organizationId: string, actorId: string, dto: CreatePostDto): Promise<ContentPost> {
    await this.assertRefs(organizationId, dto.productId, dto.affiliateLinkId, dto.mediaAssetId ?? null);
    const post = await this.insertPost({
      organizationId,
      productId: dto.productId,
      affiliateLinkId: dto.affiliateLinkId,
      mediaAssetId: dto.mediaAssetId ?? null,
      body: dto.body.trim(),
      disclosureText: dto.disclosureText?.trim() || DEFAULT_DISCLOSURE,
      authorId: actorId,
      generatedBy: 'HUMAN',
      llmProvider: null,
      llmModel: null,
      createdBy: actorId,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'content.post.created',
      entityType: 'content_post',
      entityId: post.id,
      metadata: { generatedBy: 'HUMAN' },
    });
    return post;
  }

  /**
   * AI đề xuất bản nháp. Agent "Viết bài" phải đang chạy (không PAUSED); mọi bản nháp ra ở DRAFT,
   * chưa ai là "người soạn", và phải qua QA rồi người duyệt mới đi tiếp.
   */
  async generate(organizationId: string, actorId: string, dto: GeneratePostsDto) {
    const { product } = await this.assertRefs(organizationId, dto.productId, dto.affiliateLinkId, dto.mediaAssetId ?? null);
    const count = dto.count ?? 2;

    // Gọi emit TRƯỚC: nếu agent "Viết bài" đang tạm dừng (409) thì từ chối, không gọi LLM.
    // Các lỗi khác của phần hiển thị (ví dụ tổ chức cũ chưa có agent) không được chặn nghiệp vụ.
    try {
      await this.office.emit({
        organizationId,
        agentKey: 'writer',
        type: AgentEventType.TaskStarted,
        message: `Đang viết ${count} bản nháp cho "${product.name}"`,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
    }

    let drafts: string[];
    let provider: string;
    let model: string;
    try {
      const result = await this.llm.generateDrafts({
        product: { name: product.name, category: product.category, description: product.description },
        count,
        tone: dto.tone ?? 'FRIENDLY',
      });
      drafts = normalizeDrafts(result.drafts, count);
      provider = result.provider;
      model = result.model;
      if (drafts.length === 0) {
        throw new BadRequestException('Nhà cung cấp AI không trả về bản nháp hợp lệ.');
      }
    } catch (error) {
      await this.safeEmit(organizationId, 'writer', AgentEventType.TaskFailed, 'Không tạo được bản nháp');
      throw error;
    }

    const created: ContentPost[] = [];
    for (const body of drafts) {
      created.push(
        await this.insertPost({
          organizationId,
          productId: dto.productId,
          affiliateLinkId: dto.affiliateLinkId,
          mediaAssetId: dto.mediaAssetId ?? null,
          body,
          disclosureText: DEFAULT_DISCLOSURE,
          authorId: null,
          generatedBy: 'AI',
          llmProvider: provider,
          llmModel: model,
          createdBy: actorId,
        }),
      );
    }

    await this.safeEmit(organizationId, 'writer', AgentEventType.Handoff, `Gửi ${created.length} bản nháp sang QA·QC`, 'qa');
    const checked: ContentPost[] = [];
    let failing = 0;
    for (const post of created) {
      const report = await this.runQa(organizationId, post.id);
      if (!report.ok) {
        failing += 1;
      }
      checked.push(await this.requirePost(organizationId, post.id));
    }
    await this.safeEmit(
      organizationId,
      'qa',
      AgentEventType.TaskCompleted,
      `Đã kiểm tra ${checked.length} bản nháp: ${failing} bản còn lỗi`,
    );
    await this.audit.record({
      organizationId,
      actorId,
      action: 'content.post.generated',
      entityType: 'content_post',
      metadata: { count: checked.length, provider, model, postIds: checked.map((p) => p.id) },
    });
    return { posts: checked, provider, model };
  }

  // ---------- Sửa ----------

  /**
   * Sửa nội dung. Mỗi lần sửa tăng content_version và làm mất hiệu lực lần duyệt cũ (bài quay về DRAFT).
   * Người sửa trở thành "người soạn" của bài.
   */
  async update(organizationId: string, actorId: string, postId: string, dto: UpdatePostDto): Promise<ContentPost> {
    const post = await this.requirePost(organizationId, postId);
    if (post.contentVersion !== dto.expectedVersion) {
      throw new ConflictException(
        `Bài đã được sửa (phiên bản hiện tại ${post.contentVersion}, bạn đang sửa ${dto.expectedVersion}). Hãy tải lại.`,
      );
    }
    if (!EDITABLE.includes(post.status)) {
      throw new ConflictException(`Bài đang ở trạng thái ${post.status}, không sửa được.`);
    }

    const next = {
      body: dto.body !== undefined ? dto.body.trim() : post.body,
      disclosureText: dto.disclosureText !== undefined ? dto.disclosureText.trim() : post.disclosureText,
      affiliateLinkId: dto.affiliateLinkId ?? post.affiliateLinkId,
      mediaAssetId: dto.mediaAssetId !== undefined ? dto.mediaAssetId : post.mediaAssetId,
    };
    if (
      next.body === post.body &&
      next.disclosureText === post.disclosureText &&
      next.affiliateLinkId === post.affiliateLinkId &&
      next.mediaAssetId === post.mediaAssetId
    ) {
      return post;
    }
    if (next.disclosureText.length === 0) {
      next.disclosureText = DEFAULT_DISCLOSURE;
    }
    await this.assertRefs(organizationId, post.productId, next.affiliateLinkId, next.mediaAssetId);

    if (post.status !== ContentStatus.Draft) {
      this.assertTransition(post.status, ContentStatus.Draft, { currentVersion: post.contentVersion });
    }

    const newVersion = post.contentVersion + 1;
    const updated = await this.dataSource.transaction(async (manager) => {
      const result = await manager.getRepository(ContentPost).update(
        { id: post.id, organizationId, contentVersion: dto.expectedVersion },
        {
          ...next,
          status: ContentStatus.Draft,
          contentVersion: newVersion,
          authorId: actorId,
          blockedReason: null,
          qaReport: null,
          qaCheckedAt: null,
        },
      );
      if (result.affected !== 1) {
        throw new ConflictException('Bài vừa được người khác sửa. Hãy tải lại.');
      }
      await manager.getRepository(ContentPostVersion).save(
        manager.getRepository(ContentPostVersion).create({
          organizationId,
          contentPostId: post.id,
          version: newVersion,
          body: next.body,
          disclosureText: next.disclosureText,
          affiliateLinkId: next.affiliateLinkId,
          mediaAssetId: next.mediaAssetId,
          editedBy: actorId,
          source: 'HUMAN',
        }),
      );
      return manager.getRepository(ContentPost).findOne({ where: { id: post.id, organizationId } });
    });

    await this.audit.record({
      organizationId,
      actorId,
      action: 'content.post.edited',
      entityType: 'content_post',
      entityId: post.id,
      metadata: { fromVersion: post.contentVersion, toVersion: newVersion, fromStatus: post.status },
    });
    return updated as ContentPost;
  }

  // ---------- QA ----------

  /** Chạy toàn bộ kiểm tra (quy tắc nội dung + link + giấy phép media) và lưu kết quả kèm phiên bản được kiểm tra. */
  async runQa(organizationId: string, postId: string, now = new Date()): Promise<StoredQaReport> {
    const post = await this.requirePost(organizationId, postId);
    const [product, link] = await Promise.all([
      this.products.requireProduct(organizationId, post.productId),
      this.links.get(organizationId, post.affiliateLinkId),
    ]);

    const recent = await this.posts.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: RECENT_POSTS_FOR_DUPLICATES,
    });
    const base = runQaRules({
      body: post.body,
      disclosureText: post.disclosureText,
      affiliateUrl: link.affiliateUrl,
      product: {
        name: product.name,
        currentPrice: product.currentPrice === null ? null : Number(product.currentPrice),
        currency: product.currency,
        priceVerifiedAt: product.priceVerifiedAt,
      },
      recentBodies: recent.filter((p) => p.id !== post.id).map((p) => p.body),
      now,
    });

    const findings: RuleFinding[] = [...base.findings];
    if (!link.publishable.ok) {
      findings.push({ rule: 'LINK_STATUS', severity: 'FAIL', message: `Link affiliate: ${link.publishable.reason}` });
    }
    if (link.productId !== post.productId) {
      findings.push({ rule: 'LINK_STATUS', severity: 'FAIL', message: 'Link affiliate không thuộc sản phẩm của bài.' });
    }
    if (post.mediaAssetId) {
      try {
        const assessment = await this.media.assertUsable(organizationId, post.mediaAssetId, now);
        // Giấy phép CC BY bắt buộc ghi nguồn: bài phải chứa nguyên văn dòng ghi nguồn đã khai báo.
        const haystack = normalizeText(`${post.body}\n${post.disclosureText}`);
        for (const attribution of assessment.attributions) {
          if (!haystack.includes(normalizeText(attribution))) {
            findings.push({
              rule: 'MEDIA_RIGHTS',
              severity: 'FAIL',
              message: `Media yêu cầu ghi nguồn. Hãy thêm nguyên văn vào bài: "${attribution}"`,
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Media không dùng được.';
        findings.push({ rule: 'MEDIA_RIGHTS', severity: 'FAIL', message });
      }
    }

    const report: StoredQaReport = {
      ...base,
      findings,
      ok: !findings.some((f) => f.severity === 'FAIL'),
      forVersion: post.contentVersion,
      checkedAt: now.toISOString(),
    };
    await this.posts.update(
      { id: post.id, organizationId, contentVersion: post.contentVersion },
      { qaReport: report, qaCheckedAt: now },
    );
    return report;
  }

  // ---------- Gửi duyệt / rút lại ----------

  async submit(organizationId: string, actorId: string, postId: string, now = new Date()): Promise<ContentPost> {
    const post = await this.requirePost(organizationId, postId);
    if (post.status !== ContentStatus.Draft) {
      throw new ConflictException(`Chỉ gửi duyệt được bài ở trạng thái DRAFT (hiện là ${post.status}).`);
    }
    const report = await this.runQa(organizationId, postId, now);
    if (!report.ok) {
      throw new BadRequestException({ message: 'Bài chưa đạt kiểm tra QA.', findings: report.findings.filter((f) => f.severity === 'FAIL') });
    }
    this.assertTransition(post.status, ContentStatus.PendingApproval, { currentVersion: post.contentVersion });

    await this.conditionalStatus(organizationId, post, ContentStatus.Draft, ContentStatus.PendingApproval);
    await this.audit.record({
      organizationId,
      actorId,
      action: 'content.post.submitted',
      entityType: 'content_post',
      entityId: post.id,
      metadata: { version: post.contentVersion },
    });
    await this.safeEmit(organizationId, 'qa', AgentEventType.NeedsApproval, 'Có bài đang chờ người duyệt');
    return this.requirePost(organizationId, postId);
  }

  async withdraw(organizationId: string, actorId: string, postId: string): Promise<ContentPost> {
    const post = await this.requirePost(organizationId, postId);
    if (post.status !== ContentStatus.PendingApproval) {
      throw new ConflictException(`Chỉ rút lại được bài đang chờ duyệt (hiện là ${post.status}).`);
    }
    this.assertTransition(post.status, ContentStatus.Draft, { currentVersion: post.contentVersion });
    await this.conditionalStatus(organizationId, post, ContentStatus.PendingApproval, ContentStatus.Draft);
    await this.audit.record({
      organizationId,
      actorId,
      action: 'content.post.withdrawn',
      entityType: 'content_post',
      entityId: post.id,
    });
    return this.requirePost(organizationId, postId);
  }

  // ---------- Duyệt (chỉ người dùng có quyền content.review) ----------

  async review(
    organizationId: string,
    actorId: string,
    postId: string,
    dto: ReviewPostDto,
    now = new Date(),
  ): Promise<{ post: ContentPost; approval: PostApproval }> {
    const post = await this.requirePost(organizationId, postId);
    if (post.status !== ContentStatus.PendingApproval) {
      throw new ConflictException(`Bài không ở trạng thái chờ duyệt (hiện là ${post.status}).`);
    }
    if (dto.version !== post.contentVersion) {
      throw new ConflictException(
        `Bạn đã xem phiên bản ${dto.version} nhưng bài hiện ở phiên bản ${post.contentVersion}. Hãy xem lại bản mới.`,
      );
    }
    const note = reviewNote(dto.note);
    if (dto.decision !== 'APPROVE' && note.length < 5) {
      throw new BadRequestException('Khi từ chối hoặc yêu cầu sửa cần ghi lý do (tối thiểu 5 ký tự).');
    }

    const target =
      dto.decision === 'APPROVE'
        ? ContentStatus.Approved
        : dto.decision === 'REJECT'
          ? ContentStatus.Rejected
          : ContentStatus.ChangesRequested;

    if (dto.decision === 'APPROVE') {
      // Kiểm tra lại NGAY LÚC DUYỆT: link, giấy phép, giá có thể đã đổi từ lúc gửi duyệt.
      const report = await this.runQa(organizationId, postId, now);
      if (!report.ok) {
        throw new BadRequestException({ message: 'Không duyệt được: bài chưa đạt kiểm tra QA.', findings: report.findings.filter((f) => f.severity === 'FAIL') });
      }
    }

    const org = await this.orgs.findOne({ where: { id: organizationId } });
    this.assertTransition(post.status, target, {
      currentVersion: post.contentVersion,
      approvedVersion: dto.version,
      actor: { isReviewer: true, isAuthor: post.authorId === actorId },
      separationOfDuties: org?.separationOfDuties ?? true,
    });

    const approval = await this.dataSource.transaction(async (manager) => {
      const result = await manager.getRepository(ContentPost).update(
        { id: post.id, organizationId, status: ContentStatus.PendingApproval, contentVersion: dto.version },
        { status: target },
      );
      if (result.affected !== 1) {
        throw new ConflictException('Bài vừa thay đổi hoặc đã được xử lý. Hãy tải lại.');
      }
      const repo = manager.getRepository(PostApproval);
      return repo.save(
        repo.create({
          organizationId,
          contentPostId: post.id,
          contentVersion: dto.version,
          decision: dto.decision === 'APPROVE' ? 'APPROVED' : dto.decision === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED',
          reviewerId: actorId,
          note: note || null,
        }),
      );
    });

    await this.audit.record({
      organizationId,
      actorId,
      action: `content.post.${dto.decision === 'APPROVE' ? 'approved' : dto.decision === 'REJECT' ? 'rejected' : 'changes_requested'}`,
      entityType: 'content_post',
      entityId: post.id,
      metadata: { version: dto.version, authorId: post.authorId, generatedBy: post.generatedBy },
    });
    return { post: await this.requirePost(organizationId, postId), approval };
  }

  // ---------- Nội bộ ----------

  private async requirePost(organizationId: string, postId: string): Promise<ContentPost> {
    const post = await this.posts.findOne({ where: { id: postId, organizationId } });
    if (!post) {
      throw new NotFoundException('Không tìm thấy bài viết.');
    }
    return post;
  }

  /** Mọi tham chiếu phải thuộc ĐÚNG tổ chức; link phải thuộc đúng sản phẩm. Media chưa cần có giấy phép lúc soạn. */
  private async assertRefs(
    organizationId: string,
    productId: string,
    affiliateLinkId: string,
    mediaAssetId: string | null,
  ): Promise<{ product: Product }> {
    const product = await this.products.requireProduct(organizationId, productId);
    const link = await this.links.get(organizationId, affiliateLinkId);
    if (link.productId !== product.id) {
      throw new BadRequestException('Link affiliate không thuộc sản phẩm đã chọn.');
    }
    if (mediaAssetId) {
      await this.media.requireAsset(organizationId, mediaAssetId);
    }
    return { product };
  }

  private async insertPost(data: {
    organizationId: string;
    productId: string;
    affiliateLinkId: string;
    mediaAssetId: string | null;
    body: string;
    disclosureText: string;
    authorId: string | null;
    generatedBy: 'HUMAN' | 'AI';
    llmProvider: string | null;
    llmModel: string | null;
    createdBy: string;
  }): Promise<ContentPost> {
    return this.dataSource.transaction(async (manager) => {
      const postRepo = manager.getRepository(ContentPost);
      const post = await postRepo.save(
        postRepo.create({
          ...data,
          status: ContentStatus.Draft,
          contentVersion: 1,
          blockedReason: null,
          qaReport: null,
          qaCheckedAt: null,
        }),
      );
      const versionRepo = manager.getRepository(ContentPostVersion);
      await versionRepo.save(
        versionRepo.create({
          organizationId: data.organizationId,
          contentPostId: post.id,
          version: 1,
          body: data.body,
          disclosureText: data.disclosureText,
          affiliateLinkId: data.affiliateLinkId,
          mediaAssetId: data.mediaAssetId,
          editedBy: data.authorId,
          source: data.generatedBy,
        }),
      );
      return post;
    });
  }

  private async conditionalStatus(
    organizationId: string,
    post: ContentPost,
    from: ContentStatus,
    to: ContentStatus,
  ): Promise<void> {
    const result = await this.posts.update(
      { id: post.id, organizationId, status: from, contentVersion: post.contentVersion },
      { status: to },
    );
    if (result.affected !== 1) {
      throw new ConflictException('Bài vừa thay đổi. Hãy tải lại.');
    }
  }

  /** Chuyển lỗi của state machine thành lỗi HTTP: thiếu quyền/tách quyền là 403, còn lại là 409. */
  private assertTransition(
    from: ContentStatus,
    to: ContentStatus,
    ctx: Parameters<typeof ContentStateMachine.assert>[2],
  ): void {
    try {
      ContentStateMachine.assert(from, to, ctx);
    } catch (error) {
      if (error instanceof ContentTransitionError) {
        if (error.code === 'GUARD_FAILED' && /Chỉ người có quyền duyệt|Người soạn không được tự duyệt/.test(error.reason)) {
          throw new ForbiddenException(error.reason);
        }
        throw new ConflictException(error.reason);
      }
      throw error;
    }
  }

  /** Sự kiện văn phòng AI là phần hiển thị; lỗi (ví dụ agent đang tạm dừng) không được làm hỏng nghiệp vụ đã xong. */
  private async safeEmit(
    organizationId: string,
    agentKey: string,
    type: Exclude<AgentEventType, AgentEventType.StatusChanged>,
    message: string,
    targetAgentKey?: string,
  ): Promise<void> {
    try {
      await this.office.emit({ organizationId, agentKey, type, message, targetAgentKey });
    } catch {
      // bỏ qua có chủ ý
    }
  }
}

export type { QaReport };
