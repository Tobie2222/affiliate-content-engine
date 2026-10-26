import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { LicenseType, ReviewStatus } from '../license-policy';

@Entity({ name: 'media_licenses' })
export class MediaLicense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'media_asset_id', type: 'uuid' })
  mediaAssetId: string;

  @Column({ name: 'license_type', type: 'varchar', length: 30 })
  licenseType: LicenseType;

  @Column({ name: 'licensor_name', type: 'varchar', length: 200, nullable: true })
  licensorName: string | null;

  @Column({ name: 'proof_url', type: 'text', nullable: true })
  proofUrl: string | null;

  @Column({ name: 'proof_note', type: 'text', nullable: true })
  proofNote: string | null;

  @Column({ name: 'attribution_text', type: 'varchar', length: 500, nullable: true })
  attributionText: string | null;

  @Column({ name: 'commercial_use_allowed', type: 'boolean' })
  commercialUseAllowed: boolean;

  @Column({ name: 'valid_from', type: 'timestamptz', nullable: true })
  validFrom: Date | null;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil: Date | null;

  @Column({ name: 'review_status', type: 'varchar', length: 10, default: 'PENDING' })
  reviewStatus: ReviewStatus;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
