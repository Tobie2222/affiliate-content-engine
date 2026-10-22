import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
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
