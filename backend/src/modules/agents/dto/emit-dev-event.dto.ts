import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AgentEventType, AgentStatus } from '../agent.types';

/** Các loại sự kiện công việc (không gồm STATUS_CHANGED, vốn do hệ thống phát). */
export const EMITTABLE_EVENT_TYPES = [
  AgentEventType.TaskStarted,
  AgentEventType.TaskCompleted,
  AgentEventType.TaskFailed,
  AgentEventType.Handoff,
  AgentEventType.NeedsApproval,
  AgentEventType.Note,
] as const;

export class EmitDevEventDto {
  @ApiProperty({ example: 'writer' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  agentKey: string;

  @ApiProperty({ enum: EMITTABLE_EVENT_TYPES })
  @IsEnum(EMITTABLE_EVENT_TYPES)
  type: (typeof EMITTABLE_EVENT_TYPES)[number];

  @ApiProperty({ example: 'Đang viết 3 bản caption' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message: string;

  @ApiPropertyOptional({ example: 'qa' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  targetAgentKey?: string;
}

/** Chỉ cho phép đặt tay hai trạng thái: chạy (IDLE) hoặc tạm dừng (PAUSED). */
export class SetAgentStatusDto {
  @ApiProperty({ enum: [AgentStatus.Idle, AgentStatus.Paused] })
  @IsIn([AgentStatus.Idle, AgentStatus.Paused])
  status: AgentStatus.Idle | AgentStatus.Paused;
}
