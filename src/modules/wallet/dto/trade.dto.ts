import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsPositive,
  IsEnum,
  IsOptional,
  IsUUID,
  Length,
} from 'class-validator';
import { TradeDirection } from '../../../modules/transactions/entities/transaction.entity';

export class TradeDto {
  @ApiProperty({
    enum: TradeDirection,
    example: TradeDirection.BUY,
    description: 'BUY = spend NGN to acquire foreign currency. SELL = sell foreign currency for NGN.',
  })
  @IsEnum(TradeDirection)
  direction: TradeDirection;

  @ApiProperty({
    example: 'USD',
    description: 'The foreign currency being bought or sold (3-letter ISO code)',
  })
  @IsString()
  @Length(3, 3)
  currency: string;

  @ApiProperty({
    example: 1000,
    description:
      'Amount to trade. For BUY: amount of NGN to spend. For SELL: amount of foreign currency to sell.',
  })
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
