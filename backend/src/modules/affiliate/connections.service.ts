import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AffiliateConnection } from './entities/affiliate-connection.entity';
import { OFFICIAL_SHOPEE_UNAVAILABLE_MESSAGE } from './providers/official-shopee.provider';
import { SHOPEE_PROVIDER, ShopeeProvider } from './providers/shopee-provider.types';

@Injectable()
export class ConnectionsService {
  constructor(
    @InjectRepository(AffiliateConnection)
    private readonly connections: Repository<AffiliateConnection>,
    @Inject(SHOPEE_PROVIDER) private readonly provider: ShopeeProvider,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * Tạo kết nối. Hiện chỉ có chế độ MOCK (dữ liệu giả). Kết nối thật cần tích hợp Shopee chính thức
   * và kho lưu bí mật, chưa được triển khai.
   */
  async create(organizationId: string, actorId: string): Promise<AffiliateConnection> {
    if (this.provider.mode === 'official') {
      throw new NotImplementedException(OFFICIAL_SHOPEE_UNAVAILABLE_MESSAGE);
    }
    const connection = await this.connections.save(
      this.connections.create({
        organizationId,
        provider: 'SHOPEE',
        externalAccountId: null,
        connectionStatus: 'MOCK',
        credentialReference: null,
        lastSyncedAt: null,
      }),
    );
    await this.audit.record({
      organizationId,
      actorId,
      action: 'affiliate_connection.created',
      entityType: 'affiliate_connection',
      entityId: connection.id,
      metadata: { provider: 'SHOPEE', status: 'MOCK' },
    });
    return connection;
  }

  list(organizationId: string): Promise<AffiliateConnection[]> {
    return this.connections.find({ where: { organizationId }, order: { createdAt: 'ASC' } });
  }

  /** Lấy kết nối THUỘC ĐÚNG tổ chức và đang dùng được. */
  async requireUsable(organizationId: string, connectionId: string): Promise<AffiliateConnection> {
    const connection = await this.connections.findOne({
      where: { id: connectionId, organizationId },
    });
    if (!connection) {
      throw new NotFoundException('Không tìm thấy kết nối affiliate.');
    }
    if (connection.connectionStatus !== 'MOCK' && connection.connectionStatus !== 'ACTIVE') {
      throw new ConflictException(`Kết nối đang ở trạng thái ${connection.connectionStatus}.`);
    }
    return connection;
  }

  async markSynced(connectionId: string): Promise<void> {
    await this.connections.update({ id: connectionId }, { lastSyncedAt: new Date() });
  }
}
