import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  IsUUID,
  Length,
} from 'class-validator';

export class ConvertCurrencyDto {
  @ApiProperty({ example: 'NGN', description: 'Currency to convert from (3-letter ISO code)' })
  @IsString()
  @Length(3, 3)
  fromCurrency: string;

  @ApiProperty({ example: 'USD', description: 'Currency to convert to (3-letter ISO code)' })
  @IsString()
  @Length(3, 3)
  toCurrency: string;

  @ApiProperty({ example: 1000, description: 'Amount of fromCurrency to convert' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({
    example: 'c2a77a2a-8c4f-4d58-a6b4-843f0a02cdd4',
    description: 'Optional idempotency key (UUID)',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}
