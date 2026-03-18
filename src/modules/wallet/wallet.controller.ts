import {
  Controller,
  Get,
  Post,
  Body,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { FundWalletDto } from './dto/fund-wallet.dto';
import { ConvertCurrencyDto } from './dto/convert-currency.dto';
import { TradeDto } from './dto/trade.dto';

@ApiTags('wallet')
@ApiBearerAuth('access-token')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Get all wallet balances for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Wallet balances returned' })
  getBalances(@Request() req: any) {
    return this.walletService.getBalances(req.user.id);
  }

  @Post('fund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fund wallet with NGN' })
  @ApiResponse({ status: 200, description: 'Wallet funded successfully' })
  fund(@Request() req: any, @Body() dto: FundWalletDto) {
    return this.walletService.fund(req.user.id, dto.amount, dto.idempotencyKey);
  }

  @Post('convert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Convert between currencies at mid-market rate (no spread)',
  })
  @ApiResponse({ status: 200, description: 'Conversion successful' })
  @ApiResponse({ status: 400, description: 'Insufficient balance or unsupported currency' })
  convert(@Request() req: any, @Body() dto: ConvertCurrencyDto) {
    return this.walletService.convert(
      req.user.id,
      dto.fromCurrency,
      dto.toCurrency,
      dto.amount,
      dto.idempotencyKey,
    );
  }

  @Post('trade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trade NGN ↔ foreign currency with spread applied (market order)',
  })
  @ApiResponse({ status: 200, description: 'Trade executed successfully' })
  @ApiResponse({ status: 400, description: 'Insufficient balance or unsupported currency' })
  trade(@Request() req: any, @Body() dto: TradeDto) {
    return this.walletService.trade(
      req.user.id,
      dto.direction,
      dto.currency,
      dto.amount,
      dto.idempotencyKey,
    );
  }
}
