import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateSocialAccountDto {
  @ApiProperty({ example: 'ten.tai.khoan' })
  @IsString()
  @MinLength(1)
  @MaxLength(61)
  handle: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName: string;
}

export class SchedulePostDto {
  @ApiProperty()
  @IsUUID()
  socialAccountId: string;

  @ApiProperty({ description: 'Thời điểm đăng (ISO 8601, có múi giờ). Phải sau hiện tại ít nhất 2 phút.' })
  @IsDateString()
  scheduledFor: string;

  @ApiProperty({ description: 'Phiên bản nội dung bạn đang xem. Phải trùng phiên bản hiện tại của bài.' })
  @IsInt()
  @Min(1)
  expectedVersion: number;
}

export class RetryPublishDto {
  @ApiPropertyOptional({ description: 'Thời điểm đăng lại (ISO 8601). Bỏ trống = càng sớm càng tốt.' })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;

  @ApiPropertyOptional({
    description: 'Bắt buộc khi kết quả lần trước không rõ: xác nhận bạn đã kiểm tra trên Threads và bài CHƯA được đăng.',
  })
  @IsOptional()
  @IsBoolean()
  confirmNotPublished?: boolean;
}
