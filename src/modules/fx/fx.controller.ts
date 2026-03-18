import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FxService } from './fx.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('fx')
@Controller('fx')
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('rates')
  @Public()
  @ApiOperation({
    summary: 'Get current FX rates for all supported currency pairs (base: NGN)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns rates from NGN to all supported currencies',
  })
  @ApiResponse({ status: 503, description: 'FX provider temporarily unavailable' })
  async getRates() {
    const rates = await this.fxService.getRates();
    const supported = this.fxService.getSupportedCurrencies();
    return {
      baseCurrency: 'NGN',
      rates,
      supportedCurrencies: supported,
      note: 'Rates are from NGN to the listed currencies. To convert inverse, divide 1 by the rate.',
    };
  }
}
