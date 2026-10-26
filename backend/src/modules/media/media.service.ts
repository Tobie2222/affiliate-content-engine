import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { parsePublicHttpsUrl } from '../affiliate/url-policy';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateMediaAssetDto, CreateMediaLicenseDto, ListMediaQuery, ReviewLicenseDto } from './dto/media.dto';
import { MediaAsset, MediaType } from './entities/media-asset.entity';
import { MediaLicense } from './entities/media-license.entity';
import {
  AssetAssessment,
  AssetLicenseStatus,
  LicenseFacts,
  assessAsset,
  validateLicenseInput,
} from './license-policy';

/** Số media tối đa kiểm tra lại trong một lần; vượt quá thì báo `truncated`. */
export const MAX_RECHECK_ASSETS = 5000;
const MAX_REPORTED_CHANGES = 100;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** Kiểu MIME (nếu có) phải khớp loại media: ảnh với image/*, video với video/*. */
export function mimeMatchesType(mediaType: MediaType, mime: string): boolean {
  const m = /^(image|video)\/[a-z0-9][a-z0-9.+-]*$/.exec(mime.trim().toLowerCase());
  return m !== null && m[1] === (mediaType === 'IMAGE' ? 'image' : 'video');
}

function toFacts(license: MediaLicense): LicenseFacts {
  return {
    id: license.id,
    licenseType: license.licenseType,
    reviewStatus: license.reviewStatus,
    commercialUseAllowed: license.commercialUseAllowed,
    validFrom: license.validFrom,
    validUntil: license.validUntil,
    attributionText: license.attributionText,
  };
}

export interface RecheckChange {
  assetId: string;
  title: string;
  from: AssetLicenseStatus;
  to: AssetLicenseStatus;
}

export interface RecheckResult {
  checked: number;
  changed: number;
  expiringSoon: number;
  changes: RecheckChange[];
  truncated: boolean;
}

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(MediaAsset) private readonly assets: Repository<MediaAsset>,
    @InjectRepository(MediaLicense) private readonly licenses: Repository<MediaLicense>,
    private readonly audit: AuditLogsService,
  ) {}

  async requireAsset(organizationId: string, assetId: string): Promise<MediaAsset> {
    const asset = await this.assets.findOne({ where: { id: assetId, organizationId } });
    if (!asset) {
      throw new NotFoundException('Không tìm thấy media.');
    }
    return asset;
  }

  async createAsset(organizationId: string, actorId: string, dto: CreateMediaAssetDto): Promise<MediaAsset> {
    const url = parsePublicHttpsUrl(dto.sourceUrl);
    if (!url.ok) {
      throw new BadRequestException(`Địa chỉ media: ${url.reason}`);
    }
    const mime = dto.mimeType?.trim();
    if (mime && !mimeMatchesType(dto.mediaType, mime)) {
      throw new BadRequestException(
        `Kiểu tệp "${mime}" không khớp loại media ${dto.mediaType === 'IMAGE' ? 'ảnh' : 'video'}.`,
      );
    }

    let saved: MediaAsset;
    try {
      saved = await this.assets.save(
        this.assets.create({
          organizationId,
          mediaType: dto.mediaType,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          sourceUrl: url.url.toString(),
          mimeType: mime ? mime.toLowerCase() : null,
          assetStatus: 'ACTIVE',
          licenseStatus: 'UNLICENSED',
          licenseExpiresAt: null,
          licenseCheckedAt: new Date(),
          createdBy: actorId,
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Media với địa chỉ này đã được đăng ký.');
      }
      throw error;
    }

    await this.audit.record({
      organizationId,
      actorId,
      action: 'media.asset.created',
      entityType: 'media_asset',
      entityId: saved.id,
      metadata: { mediaType: saved.mediaType },
    });
    return saved;
  }

  async list(organizationId: string, query: ListMediaQuery) {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const search = query.search?.trim();
    const [items, total] = await this.assets.findAndCount({
      where: {
        organizationId,
        ...(query.includeArchived ? {} : { assetStatus: 'ACTIVE' as const }),
        ...(query.licenseStatus ? { licenseStatus: query.licenseStatus } : {}),
        ...(query.mediaType ? { mediaType: query.mediaType } : {}),
        ...(search ? { title: ILike(`%${search.replace(/[\\%_]/g, '\\$&')}%`) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total, limit, offset };
  }

  async get(organizationId: string, assetId: string, now = new Date()) {
    const asset = await this.requireAsset(organizationId, assetId);
    const licenses = await this.licenses.find({
      where: { organizationId, mediaAssetId: asset.id },
      order: { createdAt: 'DESC' },
    });
    return { asset, licenses, assessment: assessAsset(licenses.map(toFacts), now) };
  }

  /** Đánh giá TRỰC TIẾP tại thời điểm `now` (không dùng bản lưu tạm). */
  async assess(organizationId: string, assetId: string, now = new Date()): Promise<AssetAssessment & { assetStatus: MediaAsset['assetStatus'] }> {
    const { asset, assessment } = await this.get(organizationId, assetId, now);
    return { ...assessment, assetStatus: asset.assetStatus };
  }

  /**
   * Cổng chặn dùng cho Phase 4-5: gọi ngay trước khi gắn media vào bài hoặc đăng bài.
   * Media đã lưu trữ hoặc không có giấy phép hợp lệ tại thời điểm này thì bị từ chối.
   */
  async assertUsable(organizationId: string, assetId: string, now = new Date()): Promise<AssetAssessment> {
    const { asset, assessment } = await this.get(organizationId, assetId, now);
    if (asset.assetStatus !== 'ACTIVE') {
      throw new UnprocessableEntityException('Media đã được lưu trữ, không dùng được.');
    }
    if (!assessment.usable) {
      throw new UnprocessableEntityException(`Media chưa dùng được: ${assessment.reason}`);
    }
    return assessment;
  }

  async addLicense(
    organizationId: string,
    actorId: string,
    assetId: string,
    dto: CreateMediaLicenseDto,
    now = new Date(),
  ) {
    const asset = await this.requireAsset(organizationId, assetId);
    if (asset.assetStatus !== 'ACTIVE') {
      throw new ConflictException('Media đã được lưu trữ, không thể thêm giấy phép.');
    }
    const checked = validateLicenseInput(dto, now);
    if (!checked.ok) {
      throw new BadRequestException(checked.errors);
    }

    const license = await this.licenses.save(
      this.licenses.create({
        organizationId,
        mediaAssetId: asset.id,
        ...checked.value,
        reviewStatus: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        createdBy: actorId,
      }),
    );
    const assessment = await this.refreshAssetStatus(asset, now);
    await this.audit.record({
      organizationId,
      actorId,
      action: 'media.license.created',
      entityType: 'media_license',
      entityId: license.id,
      metadata: { mediaAssetId: asset.id, licenseType: license.licenseType },
    });
    return { license, assessment };
  }

  /**
   * Chỉ người dùng (có quyền media.review) mới duyệt/từ chối được; agent và AI không có đường vào đây.
   * Giấy phép chỉ được xử lý một lần: UPDATE có điều kiện đang PENDING để hai người bấm cùng lúc không ghi đè nhau.
   */
  async reviewLicense(
    organizationId: string,
    actorId: string,
    licenseId: string,
    dto: ReviewLicenseDto,
    now = new Date(),
  ) {
    const existing = await this.licenses.findOne({ where: { id: licenseId, organizationId } });
    if (!existing) {
      throw new NotFoundException('Không tìm thấy giấy phép.');
    }
    const note = dto.note?.trim() ?? '';
    if (dto.decision === 'REJECT' && note.length < 5) {
      throw new BadRequestException('Khi từ chối cần ghi lý do (tối thiểu 5 ký tự).');
    }
    if (dto.decision === 'APPROVE' && existing.validUntil && existing.validUntil.getTime() <= now.getTime()) {
      throw new BadRequestException('Giấy phép đã hết hạn, không thể duyệt. Hãy thêm giấy phép mới.');
    }

    const result = await this.licenses.update(
      { id: licenseId, organizationId, reviewStatus: 'PENDING' },
      {
        reviewStatus: dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        reviewedBy: actorId,
        reviewedAt: now,
        reviewNote: note || null,
      },
    );
    if (result.affected !== 1) {
      throw new ConflictException('Giấy phép này đã được xử lý trước đó.');
    }

    const asset = await this.requireAsset(organizationId, existing.mediaAssetId);
    const assessment = await this.refreshAssetStatus(asset, now);
    await this.audit.record({
      organizationId,
      actorId,
      action: dto.decision === 'APPROVE' ? 'media.license.approved' : 'media.license.rejected',
      entityType: 'media_license',
      entityId: licenseId,
      metadata: { mediaAssetId: asset.id, createdBy: existing.createdBy, note: note || null },
    });
    const license = await this.licenses.findOne({ where: { id: licenseId, organizationId } });
    return { license, assessment };
  }

  async archive(organizationId: string, actorId: string, assetId: string): Promise<MediaAsset> {
    const asset = await this.requireAsset(organizationId, assetId);
    if (asset.assetStatus === 'ARCHIVED') {
      return asset;
    }
    await this.assets.update({ id: asset.id, organizationId }, { assetStatus: 'ARCHIVED' });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'media.asset.archived',
      entityType: 'media_asset',
      entityId: asset.id,
    });
    return { ...asset, assetStatus: 'ARCHIVED' };
  }

  /**
   * Kiểm tra lại toàn bộ media đang dùng: cập nhật bản lưu tạm theo thời điểm hiện tại
   * (giấy phép hết hạn / sắp hết hạn). Sau này chạy theo lịch bằng BullMQ; hiện gọi bằng tay qua API.
   */
  async recheckAll(organizationId: string, actorId: string | null, now = new Date()): Promise<RecheckResult> {
    const found = await this.assets.find({
      where: { organizationId, assetStatus: 'ACTIVE' },
      order: { createdAt: 'ASC' },
      take: MAX_RECHECK_ASSETS + 1,
    });
    const truncated = found.length > MAX_RECHECK_ASSETS;
    const assets = truncated ? found.slice(0, MAX_RECHECK_ASSETS) : found;
    const allLicenses = await this.licenses.find({ where: { organizationId } });

    const byAsset = new Map<string, LicenseFacts[]>();
    for (const license of allLicenses) {
      const list = byAsset.get(license.mediaAssetId) ?? [];
      list.push(toFacts(license));
      byAsset.set(license.mediaAssetId, list);
    }

    const changes: RecheckChange[] = [];
    let changed = 0;
    let expiringSoon = 0;
    for (const asset of assets) {
      const assessment = assessAsset(byAsset.get(asset.id) ?? [], now);
      if (assessment.status === 'EXPIRING_SOON') {
        expiringSoon += 1;
      }
      const sameExpiry = (asset.licenseExpiresAt?.getTime() ?? null) === (assessment.expiresAt?.getTime() ?? null);
      if (assessment.status !== asset.licenseStatus || !sameExpiry) {
        await this.assets.update(
          { id: asset.id, organizationId },
          { licenseStatus: assessment.status, licenseExpiresAt: assessment.expiresAt, licenseCheckedAt: now },
        );
        changed += 1;
        if (assessment.status !== asset.licenseStatus && changes.length < MAX_REPORTED_CHANGES) {
          changes.push({ assetId: asset.id, title: asset.title, from: asset.licenseStatus, to: assessment.status });
        }
      }
    }

    if (changed > 0) {
      await this.audit.record({
        organizationId,
        actorId,
        action: 'media.recheck',
        entityType: 'media_asset',
        metadata: { checked: assets.length, changed },
      });
    }
    return { checked: assets.length, changed, expiringSoon, changes, truncated };
  }

  private async refreshAssetStatus(asset: MediaAsset, now: Date): Promise<AssetAssessment> {
    const licenses = await this.licenses.find({
      where: { organizationId: asset.organizationId, mediaAssetId: asset.id },
    });
    const assessment = assessAsset(licenses.map(toFacts), now);
    await this.assets.update(
      { id: asset.id, organizationId: asset.organizationId },
      { licenseStatus: assessment.status, licenseExpiresAt: assessment.expiresAt, licenseCheckedAt: now },
    );
    return assessment;
  }
}
