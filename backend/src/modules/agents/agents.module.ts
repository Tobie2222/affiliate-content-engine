import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AgentOfficeService } from './agent-office.service';
import { AgentsController } from './agents.controller';
import { AgentEvent } from './entities/agent-event.entity';
import { AgentTask } from './entities/agent-task.entity';
import { Agent } from './entities/agent.entity';

export const AGENT_TASKS_QUEUE = 'agent-tasks';

@Module({
  imports: [
    OrganizationsModule, // cung cấp OrgAccessGuard (kiểm tra thành viên tổ chức)
    TypeOrmModule.forFeature([Agent, AgentTask, AgentEvent]),
    // Hàng đợi cho công việc của agent. Chưa có processor ở Phase 1.
    BullModule.registerQueue({ name: AGENT_TASKS_QUEUE }),
  ],
  controllers: [AgentsController],
  providers: [AgentOfficeService, DevOnlyGuard],
  exports: [AgentOfficeService],
})
export class AgentsModule {}
