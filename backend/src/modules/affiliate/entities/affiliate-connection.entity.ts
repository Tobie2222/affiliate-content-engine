import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AffiliateProviderName = 'SHOPEE';
export type ConnectionStatus = 'MOCK' | 'ACTIVE' | 'DISCONNECTED' | 'ERROR';

@Entity({ name: 'affiliate_connections' })
export class AffiliateConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 30 })
  provider: AffiliateProviderName;

  @Column({ name: 'external_account_id', type: 'varchar', length: 100, nullable: true })
  externalAccountId: string | null;

  /** MOCK = kết nối giả lập để dev, KHÔNG phải tài khoản Shopee thật. */
  @Column({ name: 'connection_status', type: 'varchar', length: 20 })
  connectionStatus: ConnectionStatus;

  /** Tham chiếu tới kho bí mật. Không bao giờ lưu khóa/secret ở đây. */
  @Column({ name: 'credential_reference', type: 'varchar', length: 200, nullable: true })
  credentialReference: string | null;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
