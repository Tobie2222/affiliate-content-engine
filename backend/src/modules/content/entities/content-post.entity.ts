import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { QaReport } from '../content-rules';
import { ContentStatus } from '../content-state-machine';

export type StoredQaReport = QaReport & { forVersion: number; checkedAt: string };

@Entity({ name: 'content_posts' })
export class ContentPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'affiliate_link_id', type: 'uuid' })
  affiliateLinkId: string;

  @Column({ name: 'media_asset_id', type: 'uuid', nullable: true })
  mediaAssetId: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'disclosure_text', type: 'varchar', length: 300 })
  disclosureText: string;

  @Column({ type: 'varchar', length: 20, default: ContentStatus.Draft })
  status: ContentStatus;

  @Column({ name: 'content_version', type: 'int', default: 1 })
  contentVersion: number;

  /** Người cuối cùng sửa nội dung. NULL với bản do AI viết chưa ai chỉnh: AI không phải "người soạn" để tách quyền. */
  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId: string | null;

  @Column({ name: 'generated_by', type: 'varchar', length: 10 })
  generatedBy: 'HUMAN' | 'AI';

  @Column({ name: 'llm_provider', type: 'varchar', length: 30, nullable: true })
  llmProvider: string | null;

  @Column({ name: 'llm_model', type: 'varchar', length: 100, nullable: true })
  llmModel: string | null;

  @Column({ name: 'blocked_reason', type: 'text', nullable: true })
  blockedReason: string | null;

  @Column({ name: 'qa_report', type: 'jsonb', nullable: true })
  qaReport: StoredQaReport | null;

  @Column({ name: 'qa_checked_at', type: 'timestamptz', nullable: true })
  qaCheckedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
