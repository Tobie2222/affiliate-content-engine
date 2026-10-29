import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PublishJobStatus = 'QUEUED' | 'PUBLISHING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
/** NOT_SENT: chắc chắn chưa gửi bài đi. UNKNOWN: đã gửi nhưng không rõ kết quả, cần người đối soát. */
export type PublishFailureKind = 'NOT_SENT' | 'UNKNOWN';

@Entity({ name: 'publish_jobs' })
export class PublishJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'content_post_id', type: 'uuid' })
  contentPostId: string;

  @Column({ name: 'social_account_id', type: 'uuid' })
  socialAccountId: string;

  @Column({ name: 'content_version', type: 'int' })
  contentVersion: number;

  @Column({ name: 'scheduled_for', type: 'timestamptz' })
  scheduledFor: Date;

  @Column({ type: 'varchar', length: 12 })
  status: PublishJobStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 150 })
  idempotencyKey: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'external_post_id', type: 'varchar', length: 100, nullable: true })
  externalPostId: string | null;

  @Column({ name: 'failure_kind', type: 'varchar', length: 10, nullable: true })
  failureKind: PublishFailureKind | null;

  @Column({ name: 'retry_safe', type: 'boolean', nullable: true })
  retrySafe: boolean | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'scheduled_by', type: 'uuid', nullable: true })
  scheduledBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
