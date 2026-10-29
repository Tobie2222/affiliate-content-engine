import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
