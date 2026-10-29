import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type SocialAccountStatus = 'ACTIVE' | 'DISCONNECTED' | 'NEEDS_REAUTH';
export type SocialAccountMode = 'MOCK' | 'OFFICIAL';

/** Tài khoản Threads của một tổ chức. Chưa lưu token: kết nối thật (OAuth) chưa được làm. */
@Entity({ name: 'social_accounts' })
export class SocialAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 20, default: 'THREADS' })
  platform: 'THREADS';

  @Column({ type: 'varchar', length: 60 })
  handle: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName: string;

  @Column({ name: 'external_account_id', type: 'varchar', length: 100, nullable: true })
  externalAccountId: string | null;

  @Column({ type: 'varchar', length: 10 })
  mode: SocialAccountMode;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: SocialAccountStatus;

  @Column({ name: 'connected_by', type: 'uuid', nullable: true })
  connectedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
