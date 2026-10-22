import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, Subject, filter } from 'rxjs';
import { Repository } from 'typeorm';
import { AgentEventType, AgentStatus } from './agent.types';
import { AgentEvent } from './entities/agent-event.entity';
import { Agent } from './entities/agent.entity';

export interface EmitAgentEventInput {
  organizationId: string;
  agentKey: string;
  type: Exclude<AgentEventType, AgentEventType.StatusChanged>;
  message: string;
  taskId?: string;
  /** Bắt buộc với HANDOFF: agent nhận việc. */
  targetAgentKey?: string;
  payload?: Record<string, unknown>;
}

/** Dạng sự kiện gửi xuống giao diện (không lộ id nội bộ không cần thiết). */
export interface AgentEventView {
  id: string;
  organizationId: string;
  agentKey: string;
  targetAgentKey: string | null;
  type: AgentEventType;
  message: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

/** Trạng thái agent sau một sự kiện; null nghĩa là giữ nguyên. */
export function statusAfterEvent(type: AgentEventType): AgentStatus | null {
  switch (type) {
    case AgentEventType.TaskStarted:
      return AgentStatus.Working;
    case AgentEventType.TaskCompleted:
      return AgentStatus.Idle;
    case AgentEventType.TaskFailed:
      return AgentStatus.Error;
    case AgentEventType.NeedsApproval:
      return AgentStatus.WaitingApproval;
    case AgentEventType.Handoff:
      return AgentStatus.Idle;
    default:
      return null;
  }
}

@Injectable()
export class AgentOfficeService {
  private readonly stream$ = new Subject<AgentEventView>();

  constructor(
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    @InjectRepository(AgentEvent) private readonly events: Repository<AgentEvent>,
  ) {}

  listAgents(organizationId: string): Promise<Agent[]> {
    return this.agents.find({ where: { organizationId }, order: { key: 'ASC' } });
  }

  /** Luồng sự kiện realtime của một tổ chức (dùng cho SSE). */
  stream(organizationId: string): Observable<AgentEventView> {
    return this.stream$.pipe(filter((e) => e.organizationId === organizationId));
  }

  /**
   * Ghi nhận một sự kiện công việc của agent. Agent đang PAUSED ("dừng tự chạy")
   * không được nhận hay báo công việc mới.
   */
  async emit(input: EmitAgentEventInput): Promise<AgentEventView> {
    const agent = await this.requireAgent(input.organizationId, input.agentKey);
    this.assertNotPaused(agent);

    let target: Agent | null = null;
    if (input.type === AgentEventType.Handoff) {
      if (!input.targetAgentKey) {
        throw new BadRequestException('HANDOFF cần targetAgentKey.');
      }
      target = await this.requireAgent(input.organizationId, input.targetAgentKey);
      this.assertNotPaused(target);
    }

    const next = statusAfterEvent(input.type);
    if (next) {
      agent.status = next;
      await this.agents.save(agent);
    }
    if (target) {
      target.status = AgentStatus.Working;
      await this.agents.save(target);
    }

    return this.record(agent, target, input.type, input.message, input.taskId, input.payload);
  }

  /** Đổi trạng thái thủ công (ví dụ tạm dừng/tiếp tục agent). */
  async setStatus(
    organizationId: string,
    agentKey: string,
    status: AgentStatus,
  ): Promise<AgentEventView> {
    const agent = await this.requireAgent(organizationId, agentKey);
    agent.status = status;
    await this.agents.save(agent);
    return this.record(
      agent,
      null,
      AgentEventType.StatusChanged,
      `Trạng thái chuyển sang ${status}`,
    );
  }

  private async requireAgent(organizationId: string, key: string): Promise<Agent> {
    const agent = await this.agents.findOne({ where: { organizationId, key } });
    if (!agent) {
      throw new NotFoundException(`Không tìm thấy agent "${key}".`);
    }
    return agent;
  }

  private assertNotPaused(agent: Agent): void {
    if (agent.status === AgentStatus.Paused) {
      throw new ConflictException(`Agent "${agent.key}" đang tạm dừng.`);
    }
  }

  private async record(
    agent: Agent,
    target: Agent | null,
    type: AgentEventType,
    message: string,
    taskId?: string,
    payload?: Record<string, unknown>,
  ): Promise<AgentEventView> {
    const entity = this.events.create({
      organizationId: agent.organizationId,
      agentId: agent.id,
      targetAgentId: target?.id ?? null,
      taskId: taskId ?? null,
      type,
      message: message.slice(0, 500),
      payload: payload ?? null,
    });
    const saved = await this.events.save(entity);

    const view: AgentEventView = {
      id: saved.id,
      organizationId: saved.organizationId,
      agentKey: agent.key,
      targetAgentKey: target?.key ?? null,
      type: saved.type,
      message: saved.message,
      payload: saved.payload ?? null,
      createdAt: saved.createdAt,
    };
    this.stream$.next(view);
    return view;
  }
}
