import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RecordMetricsDto {
  @ApiPropertyOptional({ description: 'Bỏ trống = chưa biết (khác 0).' })
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000)
  views?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000)
  likes?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000)
  replies?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000)
  reposts?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000)
  quotes?: number;

  @ApiPropertyOptional({ description: 'Thời điểm bạn xem số liệu (ISO 8601). Bỏ trống = bây giờ.' })
  @IsOptional() @IsDateString()
  capturedAt?: string;
}

export class ImportConversionsDto {
  @ApiProperty({
    description:
      'CSV. Cột bắt buộc: order_id, product_id (mã sản phẩm Shopee), order_time, status (pending|completed|cancelled). ' +
      'Tùy chọn: commission, currency (bắt buộc nếu có commission), sub_id.',
  })
  @IsString() @MinLength(1) @MaxLength(50_000)
  csv: string;

  @ApiPropertyOptional({ description: 'true = chỉ kiểm tra, không ghi.' })
  @IsOptional() @IsBoolean()
  dryRun?: boolean;
}

export class ReportQuery {
  @ApiPropertyOptional({ description: 'Từ ngày (ISO 8601). Mặc định 30 ngày trước.' })
  @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Đến ngày, không gồm mốc này. Mặc định bây giờ.' })
  @IsOptional() @IsDateString()
  to?: string;
}
