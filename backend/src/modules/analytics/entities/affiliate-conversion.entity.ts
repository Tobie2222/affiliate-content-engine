import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ConversionStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';

@Entity({ name: 'affiliate_conversions' })
export class AffiliateConversion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'external_order_id', type: 'varchar', length: 100 })
  externalOrderId: string;

  @Column({ name: 'external_product_id', type: 'varchar', length: 100 })
  externalProductId: string;

  @Column({ name: 'order_time', type: 'timestamptz' })
  orderTime: Date;

  @Column({ type: 'varchar', length: 10 })
  status: ConversionStatus;

  /** NULL = báo cáo không có số hoa hồng (chưa biết), khác 0. numeric trả về dạng chuỗi nên đổi sang số khi đọc. */
  @Column({
    name: 'commission_amount',
    type: 'numeric',
    precision: 16,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value === null || value === undefined ? null : Number(value)),
    },
  })
  commissionAmount: number | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency: string | null;

  @Column({ name: 'sub_id', type: 'varchar', length: 50, nullable: true })
  subId: string | null;

  @Column({ type: 'varchar', length: 10 })
  source: 'CSV' | 'API';

  @Column({ name: 'imported_by', type: 'uuid', nullable: true })
  importedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
