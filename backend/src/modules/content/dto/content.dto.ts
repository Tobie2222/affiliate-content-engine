import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ContentStatus } from '../content-state-machine';

export const DEFAULT_DISCLOSURE = 'Mình nhận hoa hồng nếu bạn mua qua link này.';

export class CreatePostDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty({ description: 'Link affiliate của đúng sản phẩm này.' })
  @IsUUID()
  affiliateLinkId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mediaAssetId?: string;

  @ApiProperty({ description: 'Nội dung bài. Không đặt link ở đây; hệ thống tự thêm link affiliate vào cuối bài.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;

  @ApiPropertyOptional({ default: DEFAULT_DISCLOSURE })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  disclosureText?: string;
}

export class GeneratePostsDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty()
  @IsUUID()
  affiliateLinkId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mediaAssetId?: string;

  @ApiPropertyOptional({ enum: ['FRIENDLY', 'INFORMATIVE', 'CONCISE'], default: 'FRIENDLY' })
  @IsOptional()
  @IsIn(['FRIENDLY', 'INFORMATIVE', 'CONCISE'])
  tone?: 'FRIENDLY' | 'INFORMATIVE' | 'CONCISE';

  @ApiPropertyOptional({ default: 2, minimum: 1, maximum: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  count?: number;
}

export class UpdatePostDto {
  @ApiProperty({ description: 'Phiên bản bạn đang sửa; sai phiên bản nghĩa là có người đã sửa trước.' })
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  disclosureText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  affiliateLinkId?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null để gỡ media khỏi bài.' })
  @IsOptional()
  @IsUUID()
  mediaAssetId?: string | null;
}

export class ReviewPostDto {
  @ApiProperty({ enum: ['APPROVE', 'REQUEST_CHANGES', 'REJECT'] })
  @IsIn(['APPROVE', 'REQUEST_CHANGES', 'REJECT'])
  decision: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

  @ApiProperty({ description: 'Phiên bản nội dung bạn đã xem. Phải trùng phiên bản hiện tại.' })
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ description: 'Bắt buộc (tối thiểu 5 ký tự) khi từ chối hoặc yêu cầu sửa.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListPostsQuery {
  @ApiPropertyOptional({ enum: Object.values(ContentStatus) })
  @IsOptional()
  @IsIn(Object.values(ContentStatus))
  status?: ContentStatus;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
