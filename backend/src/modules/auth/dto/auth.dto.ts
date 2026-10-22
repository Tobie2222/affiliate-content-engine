import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'ban@example.com' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ minLength: 10, description: 'Tối thiểu 10 ký tự' })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken: string;
}
