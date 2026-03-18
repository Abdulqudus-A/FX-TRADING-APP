import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '483920' })
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits.' })
  code: string;
}
