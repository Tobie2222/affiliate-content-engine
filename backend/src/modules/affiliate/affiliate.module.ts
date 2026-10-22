import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AffiliateLinksService } from './affiliate-links.service';
import {
  AffiliateConnectionsController,
  AffiliateLinksController,
  ProductsController,
} from './affiliate.controllers';
import { ConnectionsService } from './connections.service';
import { AffiliateConnection } from './entities/affiliate-connection.entity';
import { AffiliateLink } from './entities/affiliate-link.entity';
import { Product } from './entities/product.entity';
import { MockShopeeProvider } from './providers/mock-shopee.provider';
import { OfficialShopeeProviderUnavailable } from './providers/official-shopee.provider';
import { SHOPEE_PROVIDER, ShopeeProvider } from './providers/shopee-provider.types';
import { ProductsService } from './products.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AffiliateConnection, Product, AffiliateLink]),
    OrganizationsModule, // cung cấp OrgAccessGuard
    AuditLogsModule,
  ],
  controllers: [AffiliateConnectionsController, ProductsController, AffiliateLinksController],
  providers: [
    {
      // SHOPEE_PROVIDER=mock (mặc định) dùng dữ liệu giả; official hiện báo "chưa triển khai".
      provide: SHOPEE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ShopeeProvider =>
        config.get<string>('SHOPEE_PROVIDER') === 'official'
          ? new OfficialShopeeProviderUnavailable()
          : new MockShopeeProvider(),
    },
    ConnectionsService,
    ProductsService,
    AffiliateLinksService,
  ],
  exports: [ProductsService, AffiliateLinksService],
})
export class AffiliateModule {}
