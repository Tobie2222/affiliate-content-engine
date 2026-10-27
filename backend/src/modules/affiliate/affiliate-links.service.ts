import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { validateUserAffiliateUrl } from './affiliate-link-url';
import { ConnectionsService } from './connections.service';
import { AffiliateLink } from './entities/affiliate-link.entity';
import { PublishableCheck, checkLinkPublishable } from './link-policy';
import { ProductsService } from './products.service';
import { SHOPEE_PROVIDER, ShopeeProvider } from './providers/shopee-provider.types';

export type LinkView = AffiliateLink & { publishable: PublishableCheck };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

@Injectable()
export class AffiliateLinksService {
  constructor(
    @InjectRepository(AffiliateLink) private readonly links: Repository<AffiliateLink>,
    @Inject(SHOPEE_PROVIDER) private readonly provider: ShopeeProvider,
    private readonly products: ProductsService,
    private readonly connections: ConnectionsService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  private toView(link: AffiliateLink): LinkView {
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    return {
      ...link,
      publishable: checkLinkPublishable({ status: link.linkStatus, source: link.source }, nodeEnv),
    };
  }

  /** Lấy một link của đúng tổ chức, kèm kết luận có đăng được hay không (dùng cho QA bài viết). */
  async get(organizationId: string, linkId: string): Promise<LinkView> {
    return this.toView(await this.requireLink(organizationId, linkId));
  }

  async list(organizationId: string, productId: string): Promise<LinkView[]> {
    await this.products.requireProduct(organizationId, productId);
    const links = await this.links.find({
      where: { organizationId, productId },
      order: { createdAt: 'DESC' },
    });
    return links.map((l) => this.toView(l));
  }

  /**
   * Link do người dùng tự nhập. Hệ thống KHÔNG tự bịa link. Link ở trạng thái UNVERIFIED cho tới khi
   * người có quyền xác minh; chưa xác minh thì không đăng được.
   */
  async createUserSupplied(
    organizationId: string,
    actorId: string,
    productId: string,
    rawUrl: string,
  ): Promise<LinkView> {
    const product = await this.products.requireProduct(organizationId, productId);
    const check = validateUserAffiliateUrl(rawUrl);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }
    const link = await this.insert({
      organizationId,
      affiliateConnectionId: null,
      productId: product.id,
      destinationUrl: product.productUrl,
      affiliateUrl: check.url,
      externalLinkId: null,
      subId: null,
      source: 'USER_SUPPLIED',
      linkStatus: 'UNVERIFIED',
      verifiedBy: null,
      createdBy: actorId,
      lastVerifiedAt: null,
    });
    await this.auditLink(organizationId, actorId, 'affiliate_link.created', link);
    return this.toView(link);
  }

  /** Tạo link qua nhà cung cấp (hiện là Shopee GIẢ LẬP). Link do nhà cung cấp tạo có hiệu lực ngay. */
  async generate(
    organizationId: string,
    actorId: string,
    productId: string,
    connectionId: string,
    subId?: string,
  ): Promise<LinkView> {
    const product = await this.products.requireProduct(organizationId, productId);
    const connection = await this.connections.requireUsable(organizationId, connectionId);
    const generated = await this.provider.generateShortLink({
      productUrl: product.productUrl,
      subIds: subId ? [subId] : [],
    });
    const link = await this.insert({
      organizationId,
      affiliateConnectionId: connection.id,
      productId: product.id,
      destinationUrl: product.productUrl,
      affiliateUrl: generated.affiliateUrl,
      externalLinkId: generated.externalLinkId,
      subId: subId ?? null,
      source: this.provider.mode === 'mock' ? 'MOCK' : 'PROVIDER_API',
      linkStatus: 'ACTIVE',
      verifiedBy: null,
      createdBy: actorId,
      lastVerifiedAt: new Date(),
    });
    await this.auditLink(organizationId, actorId, 'affiliate_link.generated', link);
    return this.toView(link);
  }

  /** Người có quyền xác nhận đã kiểm tra link thật: UNVERIFIED -> ACTIVE. */
  async verify(organizationId: string, actorId: string, linkId: string): Promise<LinkView> {
    const link = await this.requireLink(organizationId, linkId);
    if (link.linkStatus !== 'UNVERIFIED') {
      throw new ConflictException(`Chỉ xác minh được link đang UNVERIFIED (hiện là ${link.linkStatus}).`);
    }
    link.linkStatus = 'ACTIVE';
    link.verifiedBy = actorId;
    link.lastVerifiedAt = new Date();
    const saved = await this.links.save(link);
    await this.auditLink(organizationId, actorId, 'affiliate_link.verified', saved);
    return this.toView(saved);
  }

  async revoke(organizationId: string, actorId: string, linkId: string): Promise<LinkView> {
    const link = await this.requireLink(organizationId, linkId);
    if (link.linkStatus !== 'UNVERIFIED' && link.linkStatus !== 'ACTIVE') {
      throw new ConflictException(`Link đang ở trạng thái ${link.linkStatus}, không thu hồi được.`);
    }
    link.linkStatus = 'REVOKED';
    const saved = await this.links.save(link);
    await this.auditLink(organizationId, actorId, 'affiliate_link.revoked', saved);
    return this.toView(saved);
  }

  /** Lấy link THUỘC ĐÚNG tổ chức. */
  private async requireLink(organizationId: string, linkId: string): Promise<AffiliateLink> {
    const link = await this.links.findOne({ where: { id: linkId, organizationId } });
    if (!link) {
      throw new NotFoundException('Không tìm thấy link affiliate.');
    }
    return link;
  }

  private async insert(data: Omit<AffiliateLink, 'id' | 'createdAt' | 'updatedAt'>): Promise<AffiliateLink> {
    try {
      return await this.links.save(this.links.create(data));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Link này đã tồn tại trong tổ chức.');
      }
      throw error;
    }
  }

  private auditLink(
    organizationId: string,
    actorId: string,
    action: string,
    link: AffiliateLink,
  ): Promise<void> {
    return this.audit.record({
      organizationId,
      actorId,
      action,
      entityType: 'affiliate_link',
      entityId: link.id,
      metadata: { productId: link.productId, source: link.source, status: link.linkStatus },
    });
  }
}
