import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserStatus {
  Active = 'ACTIVE',
  Disabled = 'DISABLED',
}

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Luôn lưu dạng chữ thường. */
  @Column({ type: 'varchar', length: 320 })
  email: string;

  /** select: false -> không bao giờ được nạp trừ khi chọn tường minh (đăng nhập). */
  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName: string;

  @Column({ type: 'varchar', length: 20, default: UserStatus.Active })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
