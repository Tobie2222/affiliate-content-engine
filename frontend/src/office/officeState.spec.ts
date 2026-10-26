import {
  ApiAgent,
  ApiAgentEvent,
  BUBBLE_MS,
  FEED_MAX,
  HANDOFF_MS,
  OfficeState,
  initialOfficeState,
  officeReducer,
} from './officeState';

const AGENTS: ApiAgent[] = [
  { id: '1', key: 'writer', displayName: 'Viết bài', department: 'Nội dung', status: 'IDLE', mapX: 80, mapY: 48 },
  { id: '2', key: 'qa', displayName: 'QA·QC', department: 'Kiểm duyệt', status: 'IDLE', mapX: 20, mapY: 72 },
];

function loaded(): OfficeState {
  return officeReducer(initialOfficeState, { type: 'load', agents: AGENTS });
}

let seq = 0;
function ev(partial: Partial<ApiAgentEvent> & Pick<ApiAgentEvent, 'agentKey' | 'type'>): ApiAgentEvent {
  seq++;
  return {
    id: `e${seq}`,
    targetAgentKey: null,
    message: 'thử',
    payload: null,
    createdAt: '2026-10-22T06:00:00Z',
    ...partial,
  };
}

describe('officeReducer - tải danh sách agent', () => {
  it('dựng nút agent theo thứ tự và chưa có bong bóng', () => {
    const s = loaded();
    expect(s.order).toEqual(['writer', 'qa']);
    expect(s.agents.writer.bubble).toBe(null);
    expect(s.agents.qa.status).toBe('IDLE');
  });

  it('tải lại giữ bong bóng đang hiện', () => {
    let s = loaded();
    s = officeReducer(s, { type: 'event', event: ev({ agentKey: 'writer', type: 'NOTE', message: 'xin chào' }), now: 1000 });
    s = officeReducer(s, { type: 'load', agents: AGENTS });
    expect(s.agents.writer.bubble?.text).toBe('xin chào');
  });
});

describe('officeReducer - sự kiện', () => {
  it('TASK_STARTED đưa agent sang WORKING và hiện bong bóng đúng hạn', () => {
    const s = officeReducer(loaded(), {
      type: 'event',
      event: ev({ agentKey: 'writer', type: 'TASK_STARTED', message: 'Đang viết 3 bản caption' }),
      now: 5000,
    });
    expect(s.agents.writer.status).toBe('WORKING');
    expect(s.agents.writer.bubble).toEqual({ text: 'Đang viết 3 bản caption', kind: 'TASK_STARTED', until: 5000 + BUBBLE_MS });
    expect(s.feed.length).toBe(1);
  });

  it('các loại sự kiện đặt đúng trạng thái', () => {
    const cases: Array<[ApiAgentEvent['type'], string]> = [
      ['TASK_COMPLETED', 'IDLE'],
      ['TASK_FAILED', 'ERROR'],
      ['NEEDS_APPROVAL', 'WAITING_APPROVAL'],
    ];
    for (const [type, expected] of cases) {
      const s = officeReducer(loaded(), { type: 'event', event: ev({ agentKey: 'writer', type }), now: 0 });
      expect(s.agents.writer.status).toBe(expected);
    }
  });

  it('NOTE không đổi trạng thái', () => {
    const s = officeReducer(loaded(), { type: 'event', event: ev({ agentKey: 'writer', type: 'NOTE' }), now: 0 });
    expect(s.agents.writer.status).toBe('IDLE');
  });

  it('HANDOFF: người giao rảnh, người nhận bắt đầu làm, có mũi tên bàn giao', () => {
    let s = officeReducer(loaded(), { type: 'event', event: ev({ agentKey: 'writer', type: 'TASK_STARTED' }), now: 0 });
    const handoff = ev({ agentKey: 'writer', type: 'HANDOFF', targetAgentKey: 'qa', message: 'Mang bản nháp sang QA·QC' });
    s = officeReducer(s, { type: 'event', event: handoff, now: 100 });
    expect(s.agents.writer.status).toBe('IDLE');
    expect(s.agents.qa.status).toBe('WORKING');
    expect(s.handoffs).toEqual([{ id: handoff.id, from: 'writer', to: 'qa', until: 100 + HANDOFF_MS }]);
  });

  it('STATUS_CHANGED dùng trạng thái trong payload; payload sai thì giữ nguyên', () => {
    let s = officeReducer(loaded(), {
      type: 'event',
      event: ev({ agentKey: 'writer', type: 'STATUS_CHANGED', payload: { status: 'PAUSED' } }),
      now: 0,
    });
    expect(s.agents.writer.status).toBe('PAUSED');
    s = officeReducer(s, {
      type: 'event',
      event: ev({ agentKey: 'writer', type: 'STATUS_CHANGED', payload: { status: 'HACKED' } }),
      now: 0,
    });
    expect(s.agents.writer.status).toBe('PAUSED');
  });

  it('bỏ qua agent lạ và sự kiện trùng id', () => {
    const base = loaded();
    expect(officeReducer(base, { type: 'event', event: ev({ agentKey: 'ghost', type: 'NOTE' }), now: 0 })).toBe(base);
    const e = ev({ agentKey: 'writer', type: 'NOTE' });
    const once = officeReducer(base, { type: 'event', event: e, now: 0 });
    const twice = officeReducer(once, { type: 'event', event: e, now: 1 });
    expect(twice).toBe(once);
    expect(twice.feed.length).toBe(1);
  });

  it('bảng tin giữ mới nhất ở đầu và không vượt giới hạn', () => {
    let s = loaded();
    for (let i = 0; i < FEED_MAX + 10; i++) {
      s = officeReducer(s, { type: 'event', event: ev({ agentKey: 'writer', type: 'NOTE', message: `n${i}` }), now: i });
    }
    expect(s.feed.length).toBe(FEED_MAX);
    expect(s.feed[0].text).toBe(`n${FEED_MAX + 9}`);
  });
});

describe('officeReducer - tick', () => {
  it('xóa bong bóng và mũi tên đã hết hạn', () => {
    let s = loaded();
    s = officeReducer(s, { type: 'event', event: ev({ agentKey: 'writer', type: 'HANDOFF', targetAgentKey: 'qa' }), now: 0 });
    const before = officeReducer(s, { type: 'tick', now: HANDOFF_MS - 1 });
    expect(before.handoffs.length).toBe(1);
    expect(before.agents.writer.bubble).not.toBe(null);
    const after = officeReducer(s, { type: 'tick', now: BUBBLE_MS + 1 });
    expect(after.handoffs.length).toBe(0);
    expect(after.agents.writer.bubble).toBe(null);
  });

  it('không có gì hết hạn thì trả về đúng trạng thái cũ (tránh vẽ lại thừa)', () => {
    const s = loaded();
    expect(officeReducer(s, { type: 'tick', now: 999999 })).toBe(s);
  });
});
