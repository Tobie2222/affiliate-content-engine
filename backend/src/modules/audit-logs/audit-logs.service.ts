import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  organizationId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogsService {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  /** Truyền `manager` để ghi nhật ký trong cùng transaction với thay đổi được ghi lại. */
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.logs;
    await repo.insert({
      organizationId: entry.organizationId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? null,
    });
  }
}
