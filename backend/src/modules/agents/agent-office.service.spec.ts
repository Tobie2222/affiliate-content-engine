import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AgentEventType, AgentStatus } from './agent.types';
import { AgentOfficeService, AgentEventView, statusAfterEvent } from './agent-office.service';
import { AgentEvent } from './entities/agent-event.entity';
import { Agent } from './entities/agent.entity';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

function makeAgent(organizationId: string, key: string, status = AgentStatus.Idle): Agent {
  return {
    id: `${organizationId}-${key}`,
    organizationId,
    key,
    displayName: key,
    department: key,
    status,
    mapX: 50,
    mapY: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function setup(seed: Agent[]) {
  const agentRepo = {
    find: jest.fn(async ({ where }: { where: { organizationId: string } }) =>
      seed.filter((a) => a.organizationId === where.organizationId),
    ),
    findOne: jest.fn(
      async ({ where }: { where: { organizationId: string; key: string } }) =>
        seed.find((a) => a.organizationId === where.organizationId && a.key === where.key) ??
        null,
    ),
    save: jest.fn(async (a: Agent) => a),
  };
  let counter = 0;
  const eventRepo = {
    create: jest.fn((x: Partial<AgentEvent>) => x as AgentEvent),
    save: jest.fn(async (x: AgentEvent) => ({
      ...x,
      id: `evt-${++counter}`,
      createdAt: new Date(),
    })),
  };
  const service = new AgentOfficeService(
    agentRepo as unknown as Repository<Agent>,
    eventRepo as unknown as Repository<AgentEvent>,
  );
  return { service, agentRepo, eventRepo };
}

describe('statusAfterEvent', () => {
  it.each([
    [AgentEventType.TaskStarted, AgentStatus.Working],
    [AgentEventType.TaskCompleted, AgentStatus.Idle],
    [AgentEventType.TaskFailed, AgentStatus.Error],
    [AgentEventType.NeedsApproval, AgentStatus.WaitingApproval],
    [AgentEventType.Handoff, AgentStatus.Idle],
    [AgentEventType.Note, null],
    [AgentEventType.StatusChanged, null],
  ])('%s -> %s', (type, expected) => {
    expect(statusAfterEvent(type)).toBe(expected);
  });
});

describe('AgentOfficeService', () => {
  it('TASK_STARTED đặt agent sang WORKING và phát sự kiện', async () => {
    const writer = makeAgent(ORG_A, 'writer');
    const { service } = setup([writer]);
    const received: AgentEventView[] = [];
    service.stream(ORG_A).subscribe((e) => received.push(e));

    const view = await service.emit({
      organizationId: ORG_A,
      agentKey: 'writer',
      type: AgentEventType.TaskStarted,
      message: 'Đang viết caption',
    });

    expect(writer.status).toBe(AgentStatus.Working);
    expect(view.agentKey).toBe('writer');
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(AgentEventType.TaskStarted);
  });

  it('luồng sự kiện chỉ gửi cho đúng tổ chức', async () => {
    const { service } = setup([makeAgent(ORG_A, 'writer'), makeAgent(ORG_B, 'writer')]);
    const receivedForB: AgentEventView[] = [];
    service.stream(ORG_B).subscribe((e) => receivedForB.push(e));

    await service.emit({
      organizationId: ORG_A,
      agentKey: 'writer',
      type: AgentEventType.Note,
      message: 'ghi chú của tổ chức A',
    });

    expect(receivedForB).toHaveLength(0);
  });

  it('HANDOFF chuyển việc: người giao IDLE, người nhận WORKING', async () => {
    const writer = makeAgent(ORG_A, 'writer', AgentStatus.Working);
    const qa = makeAgent(ORG_A, 'qa');
    const { service } = setup([writer, qa]);

    const view = await service.emit({
      organizationId: ORG_A,
      agentKey: 'writer',
      type: AgentEventType.Handoff,
      targetAgentKey: 'qa',
      message: 'Mang bản nháp sang QA·QC',
    });

    expect(writer.status).toBe(AgentStatus.Idle);
    expect(qa.status).toBe(AgentStatus.Working);
    expect(view.targetAgentKey).toBe('qa');
  });

  it('HANDOFF thiếu targetAgentKey bị từ chối', async () => {
    const { service } = setup([makeAgent(ORG_A, 'writer')]);
    await expect(
      service.emit({
        organizationId: ORG_A,
        agentKey: 'writer',
        type: AgentEventType.Handoff,
        message: 'thiếu người nhận',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('agent đang PAUSED không nhận việc mới ("dừng tự chạy")', async () => {
    const paused = makeAgent(ORG_A, 'writer', AgentStatus.Paused);
    const { service } = setup([paused]);
    await expect(
      service.emit({
        organizationId: ORG_A,
        agentKey: 'writer',
        type: AgentEventType.TaskStarted,
        message: 'thử bắt đầu',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(paused.status).toBe(AgentStatus.Paused);
  });

  it('không thể giao việc cho agent đang PAUSED', async () => {
    const writer = makeAgent(ORG_A, 'writer');
    const qa = makeAgent(ORG_A, 'qa', AgentStatus.Paused);
    const { service } = setup([writer, qa]);
    await expect(
      service.emit({
        organizationId: ORG_A,
        agentKey: 'writer',
        type: AgentEventType.Handoff,
        targetAgentKey: 'qa',
        message: 'giao cho agent đang dừng',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('agent không tồn tại hoặc thuộc tổ chức khác trả NotFound', async () => {
    const { service } = setup([makeAgent(ORG_B, 'writer')]);
    await expect(
      service.emit({
        organizationId: ORG_A,
        agentKey: 'writer',
        type: AgentEventType.Note,
        message: 'khác tổ chức',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setStatus được phép đưa agent vào PAUSED và phát STATUS_CHANGED', async () => {
    const writer = makeAgent(ORG_A, 'writer');
    const { service } = setup([writer]);
    const view = await service.setStatus(ORG_A, 'writer', AgentStatus.Paused);
    expect(writer.status).toBe(AgentStatus.Paused);
    expect(view.type).toBe(AgentEventType.StatusChanged);
    // Giao diện dựa vào payload này để cập nhật trạng thái ngay, không cần tải lại danh sách.
    expect(view.payload).toEqual({ status: AgentStatus.Paused });
  });

  it('cắt message dài quá 500 ký tự', async () => {
    const { service, eventRepo } = setup([makeAgent(ORG_A, 'writer')]);
    await service.emit({
      organizationId: ORG_A,
      agentKey: 'writer',
      type: AgentEventType.Note,
      message: 'x'.repeat(900),
    });
    const created = eventRepo.create.mock.calls[0][0] as Partial<AgentEvent>;
    expect(created.message).toHaveLength(500);
  });
});
