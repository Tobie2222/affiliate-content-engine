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

  @ApiPropertyOptional({ description: 'Token truy cập Threads. Chỉ dùng khi hệ thống ở chế độ Threads thật; không bao giờ được trả lại.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessToken?: string;
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

export class MarkPublishedDto {
  @ApiProperty({ example: 'https://www.threads.net/@ten.tai.khoan/post/AbCdEfGh1', description: 'Link bài đã đăng trên Threads.' })
  @IsString()
  @MaxLength(500)
  permalink: string;

  @ApiPropertyOptional({ description: 'Thời điểm bài lên Threads (ISO 8601). Bỏ trống = bây giờ.' })
  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  @ApiProperty({ description: 'Bắt buộc true: bạn đã mở Threads và thấy bài này đang hiển thị.' })
  @IsBoolean()
  confirmPublishedOnThreads: boolean;
}

export class RetryCommentDto {
  @ApiPropertyOptional({
    description: 'Bắt buộc khi lần đăng comment trước không rõ kết quả: xác nhận bạn đã kiểm tra trên Threads và comment CHƯA có.',
  })
  @IsOptional()
  @IsBoolean()
  confirmNotPosted?: boolean;

  @ApiPropertyOptional({ description: 'Comment thực ra đã có trên Threads: ghi nhận đã đăng, không đăng lại.' })
  @IsOptional()
  @IsBoolean()
  alreadyPosted?: boolean;
}
