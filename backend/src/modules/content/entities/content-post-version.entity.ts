import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'content_post_versions' })
export class ContentPostVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'content_post_id', type: 'uuid' })
  contentPostId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'disclosure_text', type: 'varchar', length: 300 })
  disclosureText: string;

  @Column({ name: 'affiliate_link_id', type: 'uuid' })
  affiliateLinkId: string;

  @Column({ name: 'media_asset_id', type: 'uuid', nullable: true })
  mediaAssetId: string | null;

  @Column({ name: 'edited_by', type: 'uuid', nullable: true })
  editedBy: string | null;

  @Column({ type: 'varchar', length: 10 })
  source: 'HUMAN' | 'AI';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
