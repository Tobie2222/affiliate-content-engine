import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Trạng thái comment chứa link affiliate: NONE (bài không có comment), PENDING (chờ đăng), POSTING (đang gửi),
 * POSTED (đã đăng), FAILED (lỗi; xem comment_failure_kind). Độc lập với trạng thái của bài.
 */
export type CommentStatus = 'NONE' | 'PENDING' | 'POSTING' | 'POSTED' | 'FAILED';

@Entity({ name: 'published_posts' })
export class PublishedPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'content_post_id', type: 'uuid' })
  contentPostId: string;

  @Column({ name: 'social_account_id', type: 'uuid' })
  socialAccountId: string;

  @Column({ name: 'publish_job_id', type: 'uuid', nullable: true })
  publishJobId: string | null;

  @Column({ name: 'external_post_id', type: 'varchar', length: 100 })
  externalPostId: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  permalink: string | null;

  @Column({ name: 'published_at', type: 'timestamptz' })
  publishedAt: Date;

  @Column({ name: 'comment_status', type: 'varchar', length: 10, default: 'NONE' })
  commentStatus: CommentStatus;

  @Column({ name: 'comment_external_id', type: 'varchar', length: 100, nullable: true })
  commentExternalId: string | null;

  /** NOT_SENT: chắc chắn chưa đăng comment. UNKNOWN: không rõ, cần người kiểm tra trước khi thử lại. */
  @Column({ name: 'comment_failure_kind', type: 'varchar', length: 10, nullable: true })
  commentFailureKind: 'NOT_SENT' | 'UNKNOWN' | null;

  @Column({ name: 'comment_error', type: 'text', nullable: true })
  commentError: string | null;

  @Column({ name: 'comment_attempts', type: 'int', default: 0 })
  commentAttempts: number;

  @Column({ name: 'comment_started_at', type: 'timestamptz', nullable: true })
  commentStartedAt: Date | null;

  @Column({ name: 'comment_posted_at', type: 'timestamptz', nullable: true })
  commentPostedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
