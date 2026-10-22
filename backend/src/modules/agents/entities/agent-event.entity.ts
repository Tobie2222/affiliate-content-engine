import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AgentEventType } from '../agent.types';

/** Nhật ký sự kiện cho giao diện văn phòng. Chỉ thêm, không sửa. */
@Entity({ name: 'agent_events' })
export class AgentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @Column({ name: 'target_agent_id', type: 'uuid', nullable: true })
  targetAgentId: string | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @Column({ type: 'varchar', length: 30 })
  type: AgentEventType;

  @Column({ type: 'varchar', length: 500 })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
