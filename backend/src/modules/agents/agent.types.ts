export enum AgentStatus {
  Idle = 'IDLE',
  Working = 'WORKING',
  WaitingApproval = 'WAITING_APPROVAL',
  Error = 'ERROR',
  Paused = 'PAUSED',
}

export enum AgentTaskStatus {
  Pending = 'PENDING',
  Running = 'RUNNING',
  WaitingApproval = 'WAITING_APPROVAL',
  Done = 'DONE',
  Failed = 'FAILED',
  Cancelled = 'CANCELLED',
}

export enum AgentEventType {
  TaskStarted = 'TASK_STARTED',
  TaskCompleted = 'TASK_COMPLETED',
  TaskFailed = 'TASK_FAILED',
  Handoff = 'HANDOFF',
  NeedsApproval = 'NEEDS_APPROVAL',
  StatusChanged = 'STATUS_CHANGED',
  Note = 'NOTE',
}

export interface DefaultAgentDefinition {
  key: string;
  displayName: string;
  department: string;
  /** Vị trí trên bản đồ văn phòng, theo phần trăm (0-100). */
  mapX: number;
  mapY: number;
}

/**
 * Danh sách agent mặc định của mỗi tổ chức. Mỗi agent là "vỏ bọc" quanh một
 * năng lực có sẵn (service/processor), không phải thực thể tự do.
 * Agent KHÔNG có quyền duyệt hay đăng bài; xem docs/PHASE0.md, mục 3.
 */
export const DEFAULT_AGENTS: ReadonlyArray<DefaultAgentDefinition> = [
  { key: 'director', displayName: 'Giám đốc', department: 'Điều phối', mapX: 50, mapY: 42 },
  { key: 'research', displayName: 'Nghiên cứu', department: 'Nghiên cứu sản phẩm', mapX: 72, mapY: 22 },
  { key: 'writer', displayName: 'Viết bài', department: 'Nội dung', mapX: 80, mapY: 48 },
  { key: 'designer', displayName: 'Thiết kế', department: 'Media & thiết kế', mapX: 66, mapY: 72 },
  { key: 'qa', displayName: 'QA·QC', department: 'Kiểm duyệt chất lượng', mapX: 20, mapY: 72 },
  { key: 'publisher', displayName: 'Đăng bài', department: 'Phát hành', mapX: 42, mapY: 74 },
  { key: 'analyst', displayName: 'Đo số liệu', department: 'Phân tích', mapX: 28, mapY: 28 },
  { key: 'community', displayName: 'Trả lời comment', department: 'Cộng đồng', mapX: 14, mapY: 46 },
];
