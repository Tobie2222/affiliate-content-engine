import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateConnectionDto {
  @ApiProperty({ enum: ['SHOPEE'] })
  @IsIn(['SHOPEE'])
  provider: 'SHOPEE';
}

export class CreateProductDto {
  @ApiProperty({ example: 'SP001' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  externalProductId: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name: string;

  @ApiProperty({ example: 'https://shopee.vn/product/123/456' })
  @IsString()
  @MaxLength(2048)
  productUrl: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Bỏ trống nếu chưa biết (khác với 0).' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: 'VND', description: 'Bắt buộc khi có price.' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ description: 'Phần trăm hoa hồng 0-100. Bỏ trống nếu chưa biết.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate?: number;
}

export class ImportProductsDto {
  @ApiProperty({
    description:
      'Nội dung CSV. Cột bắt buộc: external_product_id, name, product_url. ' +
      'Cột tùy chọn: description, category, image_url, price, currency, commission_rate.',
  })
  @IsString()
  @MinLength(1)
  // Giới hạn theo ký tự để nằm dưới mức 100kb mặc định của bộ đọc JSON (tiếng Việt có dấu tốn nhiều byte).
  @MaxLength(50_000)
  csv: string;

  @ApiPropertyOptional({ description: 'true = chỉ kiểm tra, không ghi vào database.' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class SyncProductsDto {
  @ApiProperty()
  @IsUUID()
  connectionId: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ListProductsQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

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

export class CreateLinkDto {
  @ApiProperty({ example: 'https://s.shopee.vn/AbCdEf' })
  @IsString()
  @MaxLength(2048)
  affiliateUrl: string;

  @ApiPropertyOptional({
    description: 'Mã theo dõi (sub_id) bạn đã đặt khi tạo link trên Shopee, để gắn đơn hàng đúng bài. Không trùng link khác.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,50}$/, { message: 'subId chỉ gồm chữ, số, "-" và "_" (tối đa 50 ký tự).' })
  subId?: string;
}

export class GenerateLinkDto {
  @ApiProperty()
  @IsUUID()
  connectionId: string;

  @ApiPropertyOptional({ description: 'Mã theo dõi (chữ, số, gạch ngang/dưới), tối đa 50 ký tự.' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,50}$/, { message: 'subId chỉ gồm chữ, số, "-" và "_" (tối đa 50 ký tự).' })
  subId?: string;
}
