import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { AffiliateProviderName } from './affiliate-connection.entity';

export type ProductStatus = 'ACTIVE' | 'UNAVAILABLE' | 'ARCHIVED';
export type ProductDataSource = 'CSV' | 'MANUAL' | 'MOCK' | 'API';

/** numeric của PostgreSQL trả về chuỗi; chuyển sang number, giữ nguyên null (= chưa biết). */
const numericTransformer = {
  to: (value: number | null | undefined): number | null => value ?? null,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

@Entity({ name: 'products' })
@Unique('uq_products_org_provider_ext', ['organizationId', 'provider', 'externalProductId'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 30 })
  provider: AffiliateProviderName;

  @Column({ name: 'external_product_id', type: 'varchar', length: 100 })
  externalProductId: string;

  @Column({ type: 'varchar', length: 500 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  category: string | null;

  @Column({ name: 'product_url', type: 'text' })
  productUrl: string;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({
    name: 'current_price',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  currentPrice: number | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency: string | null;

  /** Phần trăm hoa hồng 0-100. */
  @Column({
    name: 'commission_rate',
    type: 'numeric',
    precision: 6,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  commissionRate: number | null;

  @Column({ name: 'product_status', type: 'varchar', length: 20, default: 'ACTIVE' })
  productStatus: ProductStatus;

  @Column({ name: 'price_verified_at', type: 'timestamptz', nullable: true })
  priceVerifiedAt: Date | null;

  @Column({ name: 'commission_verified_at', type: 'timestamptz', nullable: true })
  commissionVerifiedAt: Date | null;

  /** Nguồn dữ liệu: CSV/MANUAL do người dùng cung cấp, MOCK là dữ liệu giả, API là từ nhà cung cấp. */
  @Column({ name: 'data_source', type: 'varchar', length: 20 })
  dataSource: ProductDataSource;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
