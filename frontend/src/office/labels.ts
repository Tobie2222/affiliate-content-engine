import type { AgentEventType, AgentStatus } from './officeState';

export const STATUS_LABEL: Record<AgentStatus, string> = {
  IDLE: 'Rảnh',
  WORKING: 'Đang làm',
  WAITING_APPROVAL: 'Chờ duyệt',
  ERROR: 'Gặp lỗi',
  PAUSED: 'Tạm dừng',
};

export const EVENT_LABEL: Record<AgentEventType, string> = {
  TASK_STARTED: 'Bắt đầu việc',
  TASK_COMPLETED: 'Xong việc',
  TASK_FAILED: 'Việc lỗi',
  HANDOFF: 'Bàn giao',
  NEEDS_APPROVAL: 'Cần người duyệt',
  STATUS_CHANGED: 'Đổi trạng thái',
  NOTE: 'Ghi chú',
};

/** Màu mái nhà theo từng phòng ban; agent lạ dùng màu mặc định. */
export const ROOF_COLOR: Record<string, string> = {
  director: '#2F5D8A',
  research: '#2E8B7A',
  writer: '#D9822B',
  designer: '#B5527A',
  qa: '#6B5BB5',
  publisher: '#3C8C4E',
  analyst: '#4A7FB5',
  community: '#C4574B',
};
export const DEFAULT_ROOF = '#5F7387';
