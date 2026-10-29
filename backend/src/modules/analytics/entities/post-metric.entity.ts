import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Ảnh chụp số liệu của một bài đã đăng. Trường NULL = chưa biết, không phải 0. */
@Entity({ name: 'post_metrics' })
export class PostMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'published_post_id', type: 'uuid' })
  publishedPostId: string;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt: Date;

  @Column({ type: 'int', nullable: true })
  views: number | null;

  @Column({ type: 'int', nullable: true })
  likes: number | null;

  @Column({ type: 'int', nullable: true })
  replies: number | null;

  @Column({ type: 'int', nullable: true })
  reposts: number | null;

  @Column({ type: 'int', nullable: true })
  quotes: number | null;

  /** MANUAL: người nhập tay. API: lấy từ Threads (chưa làm). */
  @Column({ type: 'varchar', length: 10 })
  source: 'MANUAL' | 'API';

  @Column({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
