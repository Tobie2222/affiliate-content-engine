import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Token truy cập đã mã hóa của một tài khoản Threads thật. Không có API nào trả bảng này ra ngoài. */
@Entity({ name: 'social_account_credentials' })
export class SocialAccountCredential {
  @PrimaryColumn({ name: 'social_account_id', type: 'uuid' })
  socialAccountId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'token_ciphertext', type: 'text' })
  tokenCiphertext: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
