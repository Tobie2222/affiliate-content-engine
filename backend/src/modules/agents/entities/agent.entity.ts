import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { AgentStatus } from '../agent.types';

@Entity({ name: 'agents' })
@Unique('uq_agents_org_key', ['organizationId', 'key'])
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 50 })
  key: string;

  @Column({ name: 'display_name', type: 'varchar', length: 100 })
  displayName: string;

  @Column({ type: 'varchar', length: 100 })
  department: string;

  @Column({ type: 'varchar', length: 20, default: AgentStatus.Idle })
  status: AgentStatus;

  @Column({ name: 'map_x', type: 'int', default: 50 })
  mapX: number;

  @Column({ name: 'map_y', type: 'int', default: 50 })
  mapY: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
