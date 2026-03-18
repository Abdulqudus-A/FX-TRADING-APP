import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth('access-token')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('trades')
  @ApiOperation({
    summary: 'Get trade volume aggregated by currency pair and day',
  })
  @ApiQuery({ name: 'currency', required: false, example: 'USD' })
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-12-31' })
  @ApiResponse({ status: 200, description: 'Aggregated trade volume' })
  getTradeVolume(
    @Query('currency') currency?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getTradeVolume(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      currency,
    );
  }

  @Get('fx-trends')
  @ApiOperation({ summary: 'Get historical FX rate data for a currency pair' })
  @ApiQuery({ name: 'fromCurrency', required: true, example: 'NGN' })
  @ApiQuery({ name: 'toCurrency', required: true, example: 'USD' })
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-12-31' })
  @ApiQuery({ name: 'limit', required: false, example: 100 })
  @ApiResponse({ status: 200, description: 'FX rate history for the pair' })
  getFxTrends(
    @Query('fromCurrency') fromCurrency: string = 'NGN',
    @Query('toCurrency') toCurrency: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: number,
  ) {
    return this.analyticsService.getFxTrend(
      fromCurrency,
      toCurrency,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      limit ? Number(limit) : 100,
    );
  }
}
