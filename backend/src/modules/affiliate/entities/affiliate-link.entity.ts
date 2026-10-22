import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { LinkSource, LinkStatus } from '../link-policy';

@Entity({ name: 'affiliate_links' })
export class AffiliateLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'affiliate_connection_id', type: 'uuid', nullable: true })
  affiliateConnectionId: string | null;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'destination_url', type: 'text' })
  destinationUrl: string;

  @Column({ name: 'affiliate_url', type: 'text' })
  affiliateUrl: string;

  @Column({ name: 'external_link_id', type: 'varchar', length: 200, nullable: true })
  externalLinkId: string | null;

  @Column({ name: 'sub_id', type: 'varchar', length: 50, nullable: true })
  subId: string | null;

  @Column({ type: 'varchar', length: 20 })
  source: LinkSource;

  @Column({ name: 'link_status', type: 'varchar', length: 20 })
  linkStatus: LinkStatus;

  @Column({ name: 'verified_by', type: 'uuid', nullable: true })
  verifiedBy: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
