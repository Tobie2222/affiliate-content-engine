import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from '../agents/entities/agent.entity';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { User } from '../auth/entities/user.entity';
import { Organization } from './entities/organization.entity';
import { OrganizationMember } from './entities/organization-member.entity';
import { OrgAccessGuard } from './org-access.guard';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization, OrganizationMember, User, Agent]),
    AuditLogsModule,
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrgAccessGuard],
  exports: [OrgAccessGuard, TypeOrmModule],
})
export class OrganizationsModule {}
