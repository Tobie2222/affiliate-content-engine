import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AffiliateLinksService } from '../affiliate/affiliate-links.service';
import { ProductsService } from '../affiliate/products.service';
import { AgentOfficeService } from '../agents/agent-office.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MediaService } from '../media/media.service';
import { Organization } from '../organizations/entities/organization.entity';
import { ContentService } from './content.service';
import { ContentStatus } from './content-state-machine';
import { DEFAULT_DISCLOSURE } from './dto/content.dto';
import { ContentPostVersion } from './entities/content-post-version.entity';
import { ContentPost } from './entities/content-post.entity';
import { PostApproval } from './entities/post-approval.entity';
import { MockLlmProvider } from './providers/mock-llm.provider';
import { LlmProvider } from './providers/llm-provider.types';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EDITOR = '11111111-1111-4111-8111-111111111111';
const REVIEWER = '22222222-2222-4222-8222-222222222222';
const PRODUCT = 'p0000000-0000-4000-8000-000000000001';
const OTHER_PRODUCT = 'p0000000-0000-4000-8000-000000000002';
const LINK = 'l0000000-0000-4000-8000-000000000001';
const LINK_OTHER_PRODUCT = 'l0000000-0000-4000-8000-000000000002';
const T0 = new Date('2026-10-27T03:00:00Z');

const GOOD_BODY =
  'Bình giữ nhiệt này mình dùng mỗi ngày đi làm, nước nóng vẫn ấm đến chiều. Nắp vặn chắc tay, không rỉ nước trong túi.';
const OTHER_BODY =
  'Hộp cơm văn phòng gọn nhẹ, ngăn riêng canh và món mặn nên không bị lẫn mùi. Rửa nhanh, bỏ được vào lò vi sóng.';

type Row = Record<string, unknown>;

/** Kho dữ liệu giả trong bộ nhớ: kiểm tra logic nghiệp vụ, không thay cho test với PostgreSQL thật. */
function fakeRepo<T extends Row>() {
  const rows: T[] = [];
  let counter = 0;
  const matches = (row: T, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
  const repo = {
    rows,
    create: jest.fn((x: Partial<T>) => ({ ...x }) as T),
    save: jest.fn(async (x: T) => {
      counter += 1;
      const saved = { ...x, id: (x.id as string | undefined) ?? `id-${counter}`, createdAt: new Date(T0.getTime() + counter) } as T;
      rows.push(saved);
      return { ...saved };
    }),
    findOne: jest.fn(async ({ where }: { where: Row }) => {
      const found = rows.find((r) => matches(r, where));
      return found ? { ...found } : null;
    }),
    find: jest.fn(async ({ where }: { where: Row }) =>
      rows
        .filter((r) => matches(r, where))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
        .map((r) => ({ ...r })),
    ),
    findAndCount: jest.fn(async ({ where }: { where: Row }) => {
      const hit = rows.filter((r) => matches(r, where)).map((r) => ({ ...r }));
      return [hit, hit.length] as [T[], number];
    }),
    update: jest.fn(async (criteria: Row, patch: Row) => {
      const hit = rows.filter((r) => matches(r, criteria));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    }),
  };
  return repo;
}

function setup(options: { llm?: LlmProvider; sod?: boolean } = {}) {
  const posts = fakeRepo<Row>();
  const versions = fakeRepo<Row>();
  const approvals = fakeRepo<Row>();
  const orgs = fakeRepo<Row>();
  orgs.rows.push({ id: ORG_A, separationOfDuties: options.sod ?? true });

  const byClass = new Map<unknown, unknown>([
    [ContentPost, posts],
    [ContentPostVersion, versions],
    [PostApproval, approvals],
    [Organization, orgs],
  ]);
  const dataSource = {
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) =>
      work({ getRepository: (cls: unknown) => byClass.get(cls) }),
    ),
  };

  const state = {
    linkStatus: { ok: true } as { ok: true } | { ok: false; reason: string },
    mediaOk: true,
    attributions: [] as string[],
    price: null as number | null,
  };
  const products = {
    requireProduct: jest.fn(async (org: string, id: string) => {
      if (org !== ORG_A || (id !== PRODUCT && id !== OTHER_PRODUCT)) {
        throw new NotFoundException('Không tìm thấy sản phẩm.');
      }
      return {
        id,
        name: 'Bình giữ nhiệt',
        category: 'Đồ gia dụng',
        description: null,
        currentPrice: state.price,
        currency: state.price === null ? null : 'VND',
        priceVerifiedAt: state.price === null ? null : T0,
      };
    }),
  };
  const links = {
    get: jest.fn(async (org: string, id: string) => {
      if (org !== ORG_A || (id !== LINK && id !== LINK_OTHER_PRODUCT)) {
        throw new NotFoundException('Không tìm thấy link.');
      }
      return {
        id,
        organizationId: org,
        productId: id === LINK ? PRODUCT : OTHER_PRODUCT,
        affiliateUrl: 'https://s.shopee.vn/AbCdEf',
        publishable: state.linkStatus,
      };
    }),
  };
  const media = {
    requireAsset: jest.fn(async (org: string, id: string) => {
      if (org !== ORG_A) {
        throw new NotFoundException('Không tìm thấy media.');
      }
      return { id };
    }),
    assertUsable: jest.fn(async () => {
      if (!state.mediaOk) {
        throw new ConflictException('Giấy phép media đã hết hạn.');
      }
      return { attributions: state.attributions };
    }),
  };
  const office = { emit: jest.fn(async (_input: unknown) => ({})) };
  const audit = { record: jest.fn(async (_entry: unknown) => undefined) };

  const service = new ContentService(
    dataSource as unknown as DataSource,
    posts as unknown as Repository<ContentPost>,
    versions as unknown as Repository<ContentPostVersion>,
    approvals as unknown as Repository<PostApproval>,
    orgs as unknown as Repository<Organization>,
    options.llm ?? new MockLlmProvider(),
    products as unknown as ProductsService,
    links as unknown as AffiliateLinksService,
    media as unknown as MediaService,
    office as unknown as AgentOfficeService,
    audit as unknown as AuditLogsService,
  );
  return { service, posts, versions, approvals, orgs, office, audit, state, media, dataSource };
}

type Ctx = ReturnType<typeof setup>;

async function draft(ctx: Ctx, body = GOOD_BODY) {
  return ctx.service.create(ORG_A, EDITOR, { productId: PRODUCT, affiliateLinkId: LINK, body });
}

async function pending(ctx: Ctx, body = GOOD_BODY) {
  const post = await draft(ctx, body);
  return ctx.service.submit(ORG_A, EDITOR, post.id, T0);
}

describe('ContentService.create', () => {
  it('tạo bài DRAFT phiên bản 1, người soạn là người tạo, kèm dòng công khai mặc định', async () => {
    const ctx = setup();
    const post = await draft(ctx);
    expect(post.status).toBe(ContentStatus.Draft);
    expect(post.contentVersion).toBe(1);
    expect(post.authorId).toBe(EDITOR);
    expect(post.generatedBy).toBe('HUMAN');
    expect(post.disclosureText).toBe(DEFAULT_DISCLOSURE);
    expect(ctx.versions.rows.length).toBe(1);
    expect(ctx.versions.rows[0]).toMatchObject({ version: 1, source: 'HUMAN', editedBy: EDITOR });
  });

  it('từ chối link thuộc sản phẩm khác', async () => {
    const ctx = setup();
    await expect(
      ctx.service.create(ORG_A, EDITOR, { productId: PRODUCT, affiliateLinkId: LINK_OTHER_PRODUCT, body: GOOD_BODY }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.posts.rows.length).toBe(0);
  });

  it('không dùng được sản phẩm, link hay media của tổ chức khác', async () => {
    const ctx = setup();
    await expect(
      ctx.service.create(ORG_B, EDITOR, { productId: PRODUCT, affiliateLinkId: LINK, body: GOOD_BODY }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      ctx.service.create(ORG_A, EDITOR, { productId: PRODUCT, affiliateLinkId: 'l-khong-co', body: GOOD_BODY }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ContentService.generate', () => {
  it('bản nháp AI luôn ở DRAFT, chưa có người soạn, đã chạy QA và bị chặn vì còn nhãn [MẪU]', async () => {
    const ctx = setup();
    const result = await ctx.service.generate(ORG_A, EDITOR, { productId: PRODUCT, affiliateLinkId: LINK, count: 2 });
    expect(result.posts.length).toBe(2);
    for (const post of result.posts) {
      expect(post.status).toBe(ContentStatus.Draft);
      expect(post.authorId).toBe(null);
      expect(post.generatedBy).toBe('AI');
      expect(post.llmProvider).toBe('mock');
      expect(post.qaReport?.ok).toBe(false);
      expect(post.qaReport?.findings.some((f) => f.rule === 'PLACEHOLDER_LEFT')).toBe(true);
    }
    // Không có đường nào để bản nháp AI tự đi tiếp.
    await expect(ctx.service.submit(ORG_A, EDITOR, result.posts[0].id, T0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('agent "Viết bài" đang tạm dừng thì từ chối và không gọi LLM', async () => {
    const llm: LlmProvider = { mode: 'mock', generateDrafts: jest.fn(async () => ({ provider: 'x', model: 'y', drafts: ['a'] })) };
    const ctx = setup({ llm });
    ctx.office.emit.mockImplementation(async () => {
      throw new ConflictException('Agent "writer" đang tạm dừng.');
    });
    await expect(
      ctx.service.generate(ORG_A, EDITOR, { productId: PRODUCT, affiliateLinkId: LINK }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(llm.generateDrafts).not.toHaveBeenCalled();
    expect(ctx.posts.rows.length).toBe(0);
  });

  it('lỗi hiển thị của văn phòng AI (không phải tạm dừng) không chặn việc tạo nháp', async () => {
    const ctx = setup();
    ctx.office.emit.mockImplementation(async () => {
      throw new NotFoundException('Không tìm thấy agent.');
    });
    const result = await ctx.service.generate(ORG_A, EDITOR, { productId: PRODUCT, affiliateLinkId: LINK, count: 1 });
    expect(result.posts.length).toBe(1);
  });

  it('nhà cung cấp trả về rác thì báo lỗi và không tạo bài', async () => {
    const llm: LlmProvider = { mode: 'live', generateDrafts: jest.fn(async () => ({ provider: 'x', model: 'y', drafts: ['', '   '] })) };
    const ctx = setup({ llm });
    await expect(
      ctx.service.generate(ORG_A, EDITOR, { productId: PRODUCT, affiliateLinkId: LINK }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.posts.rows.length).toBe(0);
  });

  it('bản nháp từ nhà cung cấp "thật" hợp lệ vẫn phải qua người duyệt (không tự đi tiếp)', async () => {
    const llm: LlmProvider = { mode: 'live', generateDrafts: jest.fn(async () => ({ provider: 'x', model: 'y', drafts: [GOOD_BODY] })) };
    const ctx = setup({ llm });
    const result = await ctx.service.generate(ORG_A, EDITOR, { productId: PRODUCT, affiliateLinkId: LINK, count: 1 });
    expect(result.posts[0].status).toBe(ContentStatus.Draft);
    expect(result.posts[0].qaReport?.ok).toBe(true);
  });
});

describe('ContentService.update', () => {
  it('sửa nội dung tăng phiên bản, đổi người soạn, xóa kết quả QA cũ và ghi lịch sử', async () => {
    const ctx = setup();
    const post = await draft(ctx);
    await ctx.service.runQa(ORG_A, post.id, T0);
    const updated = await ctx.service.update(ORG_A, REVIEWER, post.id, { expectedVersion: 1, body: OTHER_BODY });
    expect(updated.contentVersion).toBe(2);
    expect(updated.authorId).toBe(REVIEWER);
    expect(updated.qaReport).toBe(null);
    expect(ctx.versions.rows.length).toBe(2);
    expect(ctx.versions.rows[1]).toMatchObject({ version: 2, body: OTHER_BODY, editedBy: REVIEWER });
  });

  it('sai phiên bản thì báo xung đột (có người sửa trước)', async () => {
    const ctx = setup();
    const post = await draft(ctx);
    await ctx.service.update(ORG_A, EDITOR, post.id, { expectedVersion: 1, body: OTHER_BODY });
    await expect(
      ctx.service.update(ORG_A, EDITOR, post.id, { expectedVersion: 1, body: GOOD_BODY }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('sửa bài đang chờ duyệt làm mất hiệu lực: quay về DRAFT, phiên bản mới', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    expect(post.status).toBe(ContentStatus.PendingApproval);
    const updated = await ctx.service.update(ORG_A, EDITOR, post.id, { expectedVersion: 1, body: OTHER_BODY });
    expect(updated.status).toBe(ContentStatus.Draft);
    expect(updated.contentVersion).toBe(2);
  });

  it('sửa bài đã duyệt cũng phải duyệt lại', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    await ctx.service.review(ORG_A, REVIEWER, post.id, { decision: 'APPROVE', version: 1 }, T0);
    const updated = await ctx.service.update(ORG_A, EDITOR, post.id, { expectedVersion: 1, body: OTHER_BODY });
    expect(updated.status).toBe(ContentStatus.Draft);
  });

  it('không sửa được bài đã bị từ chối hoặc đang đăng', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    await ctx.service.review(ORG_A, REVIEWER, post.id, { decision: 'REJECT', version: 1, note: 'Không phù hợp thương hiệu' }, T0);
    await expect(
      ctx.service.update(ORG_A, EDITOR, post.id, { expectedVersion: 1, body: OTHER_BODY }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('không đổi gì thì không tăng phiên bản', async () => {
    const ctx = setup();
    const post = await draft(ctx);
    const same = await ctx.service.update(ORG_A, EDITOR, post.id, { expectedVersion: 1, body: GOOD_BODY });
    expect(same.contentVersion).toBe(1);
    expect(ctx.versions.rows.length).toBe(1);
  });

  it('đổi sang link của sản phẩm khác bị từ chối', async () => {
    const ctx = setup();
    const post = await draft(ctx);
    await expect(
      ctx.service.update(ORG_A, EDITOR, post.id, { expectedVersion: 1, affiliateLinkId: LINK_OTHER_PRODUCT }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ContentService.submit / withdraw', () => {
  it('bài đạt QA được chuyển sang chờ duyệt', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    expect(post.status).toBe(ContentStatus.PendingApproval);
    expect(post.qaReport?.ok).toBe(true);
    expect(post.qaReport?.forVersion).toBe(1);
  });

  it('link chưa xác minh thì không gửi duyệt được', async () => {
    const ctx = setup();
    ctx.state.linkStatus = { ok: false, reason: 'Link chưa được xác minh.' };
    const post = await draft(ctx);
    await expect(ctx.service.submit(ORG_A, EDITOR, post.id, T0)).rejects.toBeInstanceOf(BadRequestException);
    expect((await ctx.service.get(ORG_A, post.id)).post.status).toBe(ContentStatus.Draft);
  });

  it('media hết giấy phép thì không gửi duyệt được', async () => {
    const ctx = setup();
    ctx.state.mediaOk = false;
    const post = await ctx.service.create(ORG_A, EDITOR, {
      productId: PRODUCT,
      affiliateLinkId: LINK,
      mediaAssetId: 'm-1',
      body: GOOD_BODY,
    });
    await expect(ctx.service.submit(ORG_A, EDITOR, post.id, T0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('media CC BY: bài phải có nguyên văn dòng ghi nguồn mới gửi duyệt được', async () => {
    const ctx = setup();
    ctx.state.attributions = ['Ảnh: Nguyễn An (CC BY 4.0)'];
    const post = await ctx.service.create(ORG_A, EDITOR, {
      productId: PRODUCT,
      affiliateLinkId: LINK,
      mediaAssetId: 'm-1',
      body: GOOD_BODY,
    });
    await expect(ctx.service.submit(ORG_A, EDITOR, post.id, T0)).rejects.toBeInstanceOf(BadRequestException);
    const report = (await ctx.service.get(ORG_A, post.id)).post.qaReport;
    expect(report?.findings.some((f) => f.rule === 'MEDIA_RIGHTS' && f.message.includes('Nguyễn An'))).toBe(true);

    // Thêm dòng ghi nguồn (không phân biệt hoa thường/khoảng trắng) thì qua.
    const edited = await ctx.service.update(ORG_A, EDITOR, post.id, {
      expectedVersion: 1,
      body: `${GOOD_BODY}  ẢNH: nguyễn an   (CC BY 4.0)`,
    });
    const submitted = await ctx.service.submit(ORG_A, EDITOR, edited.id, T0);
    expect(submitted.status).toBe(ContentStatus.PendingApproval);
  });

  it('chỉ gửi duyệt được bài DRAFT', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    await expect(ctx.service.submit(ORG_A, EDITOR, post.id, T0)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rút lại bài đang chờ duyệt về DRAFT; bài khác trạng thái thì không rút được', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    const back = await ctx.service.withdraw(ORG_A, EDITOR, post.id);
    expect(back.status).toBe(ContentStatus.Draft);
    await expect(ctx.service.withdraw(ORG_A, EDITOR, post.id)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ContentService.review', () => {
  it('người duyệt (khác người soạn) duyệt được và lưu bản ghi duyệt theo phiên bản', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    const { post: approved, approval } = await ctx.service.review(ORG_A, REVIEWER, post.id, { decision: 'APPROVE', version: 1 }, T0);
    expect(approved.status).toBe(ContentStatus.Approved);
    expect(approval).toMatchObject({ decision: 'APPROVED', contentVersion: 1, reviewerId: REVIEWER });
    expect(ctx.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'content.post.approved' }));
  });

  it('tách quyền bật: người soạn không tự duyệt bài của mình (403) và bài vẫn chờ duyệt', async () => {
    const ctx = setup({ sod: true });
    const post = await pending(ctx);
    await expect(
      ctx.service.review(ORG_A, EDITOR, post.id, { decision: 'APPROVE', version: 1 }, T0),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((await ctx.service.get(ORG_A, post.id)).post.status).toBe(ContentStatus.PendingApproval);
    expect(ctx.approvals.rows.length).toBe(0);
  });

  it('tách quyền tắt: người soạn được tự duyệt', async () => {
    const ctx = setup({ sod: false });
    const post = await pending(ctx);
    const { post: approved } = await ctx.service.review(ORG_A, EDITOR, post.id, { decision: 'APPROVE', version: 1 }, T0);
    expect(approved.status).toBe(ContentStatus.Approved);
  });

  it('bản nháp AI chưa ai sửa (authorId rỗng) thì mọi người duyệt đều duyệt được', async () => {
    const llm: LlmProvider = { mode: 'live', generateDrafts: jest.fn(async () => ({ provider: 'x', model: 'y', drafts: [GOOD_BODY] })) };
    const ctx = setup({ llm, sod: true });
    const { posts } = await ctx.service.generate(ORG_A, EDITOR, { productId: PRODUCT, affiliateLinkId: LINK, count: 1 });
    await ctx.service.submit(ORG_A, EDITOR, posts[0].id, T0);
    const { post } = await ctx.service.review(ORG_A, EDITOR, posts[0].id, { decision: 'APPROVE', version: 1 }, T0);
    expect(post.status).toBe(ContentStatus.Approved);
  });

  it('duyệt phiên bản cũ bị từ chối (người duyệt chưa xem bản mới)', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    await expect(
      ctx.service.review(ORG_A, REVIEWER, post.id, { decision: 'APPROVE', version: 2 }, T0),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('kiểm tra lại ngay lúc duyệt: link bị thu hồi sau khi gửi duyệt thì không duyệt được', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    ctx.state.linkStatus = { ok: false, reason: 'Link ở trạng thái BROKEN.' };
    await expect(
      ctx.service.review(ORG_A, REVIEWER, post.id, { decision: 'APPROVE', version: 1 }, T0),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await ctx.service.get(ORG_A, post.id)).post.status).toBe(ContentStatus.PendingApproval);
  });

  it('từ chối hoặc yêu cầu sửa bắt buộc có lý do', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    await expect(
      ctx.service.review(ORG_A, REVIEWER, post.id, { decision: 'REJECT', version: 1 }, T0),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctx.service.review(ORG_A, REVIEWER, post.id, { decision: 'REQUEST_CHANGES', version: 1, note: 'ngắn' }, T0),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('yêu cầu sửa đưa bài sang CHANGES_REQUESTED; sửa xong thì quay về DRAFT để gửi lại', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    const { post: changed, approval } = await ctx.service.review(
      ORG_A,
      REVIEWER,
      post.id,
      { decision: 'REQUEST_CHANGES', version: 1, note: 'Bỏ câu so sánh với đối thủ' },
      T0,
    );
    expect(changed.status).toBe(ContentStatus.ChangesRequested);
    expect(approval.decision).toBe('CHANGES_REQUESTED');
    const edited = await ctx.service.update(ORG_A, EDITOR, post.id, { expectedVersion: 1, body: OTHER_BODY });
    expect(edited.status).toBe(ContentStatus.Draft);
    const again = await ctx.service.submit(ORG_A, EDITOR, post.id, T0);
    expect(again.status).toBe(ContentStatus.PendingApproval);
  });

  it('bài đã duyệt rồi thì không duyệt lần nữa', async () => {
    const ctx = setup();
    const post = await pending(ctx);
    await ctx.service.review(ORG_A, REVIEWER, post.id, { decision: 'APPROVE', version: 1 }, T0);
    await expect(
      ctx.service.review(ORG_A, REVIEWER, post.id, { decision: 'APPROVE', version: 1 }, T0),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ContentService - cách ly tổ chức', () => {
  it('không xem được bài của tổ chức khác', async () => {
    const ctx = setup();
    const post = await draft(ctx);
    await expect(ctx.service.get(ORG_B, post.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.submit(ORG_B, EDITOR, post.id, T0)).rejects.toBeInstanceOf(NotFoundException);
    const listed = await ctx.service.list(ORG_B, {});
    expect(listed.total).toBe(0);
  });
});
