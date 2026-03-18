import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsOptional, IsString, IsUUID } from 'class-validator';

export class FundWalletDto {
  @ApiProperty({ example: 50000, description: 'Amount in NGN to fund' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({
    example: 'c2a77a2a-8c4f-4d58-a6b4-843f0a02cdd4',
    description: 'Optional idempotency key (UUID) to prevent duplicate operations',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}
