import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'organizations' })
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100 })
  slug: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';

  /** Tách quyền: người soạn không được tự duyệt bài của mình. Mặc định bật. */
  @Column({ name: 'separation_of_duties', type: 'boolean', default: true })
  separationOfDuties: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
