import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AssetLicenseStatus } from '../license-policy';

export type MediaType = 'IMAGE' | 'VIDEO';
export type AssetStatus = 'ACTIVE' | 'ARCHIVED';

@Entity({ name: 'media_assets' })
export class MediaAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'media_type', type: 'varchar', length: 10 })
  mediaType: MediaType;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'source_url', type: 'text' })
  sourceUrl: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100, nullable: true })
  mimeType: string | null;

  @Column({ name: 'asset_status', type: 'varchar', length: 10, default: 'ACTIVE' })
  assetStatus: AssetStatus;

  /** Bản lưu tạm kết quả đánh giá giấy phép; trạng thái đúng tại thời điểm dùng được tính lại từ giấy phép. */
  @Column({ name: 'license_status', type: 'varchar', length: 20, default: 'UNLICENSED' })
  licenseStatus: AssetLicenseStatus;

  @Column({ name: 'license_expires_at', type: 'timestamptz', nullable: true })
  licenseExpiresAt: Date | null;

  @Column({ name: 'license_checked_at', type: 'timestamptz', nullable: true })
  licenseCheckedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
