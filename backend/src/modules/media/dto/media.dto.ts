import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ASSET_LICENSE_STATUSES, LICENSE_TYPES } from '../license-policy';

export class CreateMediaAssetDto {
  @ApiProperty({ enum: ['IMAGE', 'VIDEO'] })
  @IsIn(['IMAGE', 'VIDEO'])
  mediaType: 'IMAGE' | 'VIDEO';

  @ApiProperty({ example: 'Ảnh bình giữ nhiệt trên bàn làm việc' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({
    example: 'https://cdn.example.com/anh/binh-giu-nhiet.jpg',
    description: 'Địa chỉ https công khai nơi media đang được lưu. Giai đoạn này hệ thống chưa lưu file.',
  })
  @IsString()
  @MaxLength(2048)
  sourceUrl: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class CreateMediaLicenseDto {
  @ApiProperty({ enum: LICENSE_TYPES })
  @IsIn([...LICENSE_TYPES])
  licenseType: (typeof LICENSE_TYPES)[number];

  @ApiPropertyOptional({ description: 'Tên tác giả / bên cấp phép.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  licensorName?: string;

  @ApiPropertyOptional({ description: 'Link https tới trang nêu giấy phép hoặc bằng chứng.' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  proofUrl?: string;

  @ApiPropertyOptional({ description: 'Ghi chú bằng chứng: số hóa đơn, mã hợp đồng, cách bạn tạo ra media...' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  proofNote?: string;

  @ApiPropertyOptional({ description: 'Dòng ghi nguồn sẽ kèm khi đăng (bắt buộc với CC_BY).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  attributionText?: string;

  @ApiProperty({ description: 'Giấy phép có cho phép dùng thương mại (nội dung affiliate) không. Phải khai báo rõ.' })
  @IsBoolean()
  commercialUseAllowed: boolean;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'YYYY-MM-DD (giờ Việt Nam) hoặc ngày giờ ISO có múi giờ.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  validFrom?: string;

  @ApiPropertyOptional({ example: '2027-10-31', description: 'Bỏ trống nếu giấy phép không hết hạn.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  validUntil?: string;
}

export class ReviewLicenseDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  decision: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({ description: 'Bắt buộc (tối thiểu 5 ký tự) khi từ chối.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListMediaQuery {
  @ApiPropertyOptional({ enum: ASSET_LICENSE_STATUSES })
  @IsOptional()
  @IsIn([...ASSET_LICENSE_STATUSES])
  licenseStatus?: (typeof ASSET_LICENSE_STATUSES)[number];

  @ApiPropertyOptional({ enum: ['IMAGE', 'VIDEO'] })
  @IsOptional()
  @IsIn(['IMAGE', 'VIDEO'])
  mediaType?: 'IMAGE' | 'VIDEO';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'true = gồm cả media đã lưu trữ.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeArchived?: boolean;

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
