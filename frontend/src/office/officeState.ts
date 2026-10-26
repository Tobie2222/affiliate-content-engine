export type AgentStatus = 'IDLE' | 'WORKING' | 'WAITING_APPROVAL' | 'ERROR' | 'PAUSED';

export type AgentEventType =
  | 'TASK_STARTED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'HANDOFF'
  | 'NEEDS_APPROVAL'
  | 'STATUS_CHANGED'
  | 'NOTE';

export interface ApiAgent {
  id: string;
  key: string;
  displayName: string;
  department: string;
  status: AgentStatus;
  mapX: number;
  mapY: number;
}

export interface ApiAgentEvent {
  id: string;
  agentKey: string;
  targetAgentKey: string | null;
  type: AgentEventType;
  message: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface Bubble {
  text: string;
  kind: AgentEventType;
  /** Thời điểm (ms) bong bóng biến mất. */
  until: number;
}

export interface AgentNode {
  key: string;
  displayName: string;
  department: string;
  status: AgentStatus;
  mapX: number;
  mapY: number;
  bubble: Bubble | null;
}

export interface Handoff {
  id: string;
  from: string;
  to: string;
  until: number;
}

export interface FeedItem {
  id: string;
  at: string;
  agentKey: string;
  targetAgentKey: string | null;
  type: AgentEventType;
  text: string;
}

export interface OfficeState {
  agents: Record<string, AgentNode>;
  /** Thứ tự hiển thị ổn định. */
  order: string[];
  handoffs: Handoff[];
  /** Mới nhất ở đầu. */
  feed: FeedItem[];
}

export type OfficeAction =
  | { type: 'load'; agents: ApiAgent[] }
  | { type: 'event'; event: ApiAgentEvent; now: number }
  | { type: 'tick'; now: number };

export const BUBBLE_MS = 9000;
export const HANDOFF_MS = 4500;
export const FEED_MAX = 40;

export const initialOfficeState: OfficeState = { agents: {}, order: [], handoffs: [], feed: [] };

const STATUSES: ReadonlyArray<AgentStatus> = ['IDLE', 'WORKING', 'WAITING_APPROVAL', 'ERROR', 'PAUSED'];

export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === 'string' && (STATUSES as ReadonlyArray<string>).includes(value);
}

/** Phản chiếu logic của máy chủ (statusAfterEvent) để giao diện cập nhật ngay không cần tải lại. */
function statusAfter(type: AgentEventType, payload: ApiAgentEvent['payload']): AgentStatus | null {
  switch (type) {
    case 'TASK_STARTED':
      return 'WORKING';
    case 'TASK_COMPLETED':
    case 'HANDOFF':
      return 'IDLE';
    case 'TASK_FAILED':
      return 'ERROR';
    case 'NEEDS_APPROVAL':
      return 'WAITING_APPROVAL';
    case 'STATUS_CHANGED':
      return isAgentStatus(payload?.status) ? payload.status : null;
    default:
      return null;
  }
}

export function officeReducer(state: OfficeState, action: OfficeAction): OfficeState {
  switch (action.type) {
    case 'load': {
      const agents: Record<string, AgentNode> = {};
      const order: string[] = [];
      for (const a of action.agents) {
        agents[a.key] = {
          key: a.key,
          displayName: a.displayName,
          department: a.department,
          status: a.status,
          mapX: a.mapX,
          mapY: a.mapY,
          bubble: state.agents[a.key]?.bubble ?? null,
        };
        order.push(a.key);
      }
      return { ...state, agents, order };
    }

    case 'event': {
      const { event, now } = action;
      const source = state.agents[event.agentKey];
      if (!source || state.feed.some((f) => f.id === event.id)) {
        return state; // agent lạ hoặc sự kiện đã xử lý
      }

      const agents = { ...state.agents };
      const nextStatus = statusAfter(event.type, event.payload);
      agents[source.key] = {
        ...source,
        status: nextStatus ?? source.status,
        bubble: { text: event.message, kind: event.type, until: now + BUBBLE_MS },
      };

      let handoffs = state.handoffs;
      const target = event.targetAgentKey ? state.agents[event.targetAgentKey] : undefined;
      if (event.type === 'HANDOFF' && target) {
        agents[target.key] = { ...target, status: 'WORKING' };
        handoffs = [
          ...state.handoffs,
          { id: event.id, from: source.key, to: target.key, until: now + HANDOFF_MS },
        ];
      }

      const feed: FeedItem[] = [
        {
          id: event.id,
          at: event.createdAt,
          agentKey: event.agentKey,
          targetAgentKey: event.targetAgentKey,
          type: event.type,
          text: event.message,
        },
        ...state.feed,
      ].slice(0, FEED_MAX);

      return { ...state, agents, handoffs, feed };
    }

    case 'tick': {
      const { now } = action;
      let changed = false;
      const agents: Record<string, AgentNode> = {};
      for (const key of Object.keys(state.agents)) {
        const node = state.agents[key];
        if (node.bubble && node.bubble.until <= now) {
          agents[key] = { ...node, bubble: null };
          changed = true;
        } else {
          agents[key] = node;
        }
      }
      const handoffs = state.handoffs.filter((h) => h.until > now);
      if (handoffs.length !== state.handoffs.length) {
        changed = true;
      }
      return changed ? { ...state, agents, handoffs } : state;
    }

    default:
      return state;
  }
}
