import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

export enum AppRole {
  Api = 'api',
  Worker = 'worker',
  All = 'all',
}

/** "mock" = dữ liệu giả để dev/test, KHÔNG phải tích hợp thật. */
export enum ProviderMode {
  Mock = 'mock',
  Official = 'official',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsEnum(AppRole)
  APP_ROLE: AppRole = AppRole.All;

  @IsString()
  @MinLength(1)
  DB_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  @MinLength(1)
  DB_USER: string;

  @IsString()
  @MinLength(8)
  DB_PASSWORD: string;

  @IsString()
  @MinLength(1)
  DB_NAME: string;

  @IsString()
  @MinLength(1)
  REDIS_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  /** Khóa ký access token JWT. Tối thiểu 32 ký tự. */
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsInt()
  @Min(60)
  @Max(86400)
  JWT_ACCESS_TTL_SECONDS: number = 900;

  @IsInt()
  @Min(1)
  @Max(365)
  REFRESH_TTL_DAYS: number = 30;

  /** Danh sách origin được phép (CORS), cách nhau bằng dấu phẩy. Để trống = không cho origin nào. */
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsEnum(ProviderMode)
  LLM_PROVIDER: ProviderMode = ProviderMode.Mock;

  @IsEnum(ProviderMode)
  SHOPEE_PROVIDER: ProviderMode = ProviderMode.Mock;

  @IsEnum(ProviderMode)
  THREADS_PROVIDER: ProviderMode = ProviderMode.Mock;
}

const PLACEHOLDER_MARKER = 'CHANGE_ME';

/**
 * Kiểm tra biến môi trường khi khởi động. Thông báo lỗi chỉ nêu tên biến,
 * không in giá trị để tránh lộ bí mật vào log.
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.keys(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Cấu hình môi trường không hợp lệ -> ${details}`);
  }

  if (validated.NODE_ENV === NodeEnv.Production) {
    const secrets: Array<[string, string | undefined]> = [
      ['DB_PASSWORD', validated.DB_PASSWORD],
      ['REDIS_PASSWORD', validated.REDIS_PASSWORD],
      ['JWT_ACCESS_SECRET', validated.JWT_ACCESS_SECRET],
    ];
    const bad = secrets
      .filter(([, v]) => !v || v.includes(PLACEHOLDER_MARKER))
      .map(([k]) => k);
    if (bad.length > 0) {
      throw new Error(
        `Production không được dùng giá trị mẫu/rỗng cho: ${bad.join(', ')}`,
      );
    }
  }

  return validated;
}
