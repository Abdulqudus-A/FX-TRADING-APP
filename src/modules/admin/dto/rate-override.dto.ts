import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsPositive, Length } from 'class-validator';

export class RateOverrideDto {
  @ApiProperty({ example: 'NGN' })
  @IsString()
  @Length(3, 3)
  fromCurrency: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  toCurrency: string;

  @ApiProperty({ example: 0.00062, description: 'Rate from fromCurrency to toCurrency' })
  @IsNumber()
  @IsPositive()
  rate: number;
}
