import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../roles';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Công ty Tiếp thị ABC' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;
}

export class AddMemberDto {
  @ApiProperty({ description: 'Email của người ĐÃ có tài khoản' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;
}

export class UpdateOrgSettingsDto {
  @ApiPropertyOptional({
    description: 'Bật: người soạn bài không được tự duyệt bài của mình. Tắt: một người có thể vừa soạn vừa duyệt.',
  })
  @IsOptional()
  @IsBoolean()
  separationOfDuties?: boolean;
}
