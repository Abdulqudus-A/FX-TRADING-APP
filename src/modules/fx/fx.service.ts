import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  OnModuleInit,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { FxRateHistory } from './entities/fx-rate-history.entity';

const RATES_CACHE_KEY = 'fx:rates:NGN';

interface ExchangeRateApiResponse {
  result: string;
  base_code: string;
  conversion_rates: Record<string, number>;
  time_last_update_unix: number;
  'error-type'?: string;
}

@Injectable()
export class FxService implements OnModuleInit {
  private readonly logger = new Logger(FxService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly supportedCurrencies: string[];

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    @InjectRepository(FxRateHistory)
    private readonly fxHistoryRepo: Repository<FxRateHistory>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {
    this.apiKey = config.get<string>('FX_API_KEY') as string;
    this.baseUrl = config.get<string>('FX_API_BASE_URL', 'https://v6.exchangerate-api.com/v6');
    this.cacheTtlMs = config.get<number>('FX_CACHE_TTL_SECONDS', 300) * 1000;
    const raw = config.get<string>('SUPPORTED_CURRENCIES', 'USD,EUR,GBP,CAD,JPY');
    this.supportedCurrencies = raw.split(',').map((c) => c.trim().toUpperCase());
  }

  async onModuleInit() {
    // Pre-warm cache on startup
    await this.refreshRates();
  }

  /**
   * Fetch and cache rates from provider. Runs on schedule and at startup.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async refreshRates(): Promise<void> {
    try {
      const url = `${this.baseUrl}/${this.apiKey}/latest/NGN`;
      const { data } = await firstValueFrom(
        this.httpService.get<ExchangeRateApiResponse>(url, { timeout: 10000 }),
      );

      if (data.result !== 'success') {
        throw new Error(`Provider error: ${data['error-type'] ?? 'unknown'}`);
      }

      // Filter to only supported currencies
      const rates: Record<string, number> = {};
      for (const currency of this.supportedCurrencies) {
        if (data.conversion_rates[currency]) {
          rates[currency] = data.conversion_rates[currency];
        }
      }
      // Also keep NGN → NGN = 1
      rates['NGN'] = 1;

      await this.cacheManager.set(RATES_CACHE_KEY, rates, this.cacheTtlMs);
      this.logger.log(`FX rates refreshed for ${Object.keys(rates).length} currencies`);

      // Persist snapshot to history table
      await this.persistSnapshot(rates);
    } catch (err) {
      this.logger.error(`Failed to refresh FX rates: ${(err as Error).message}`);
    }
  }

  /**
   * Get all rates from NGN. Falls back to cache then DB on provider failure.
   */
  async getRates(): Promise<Record<string, number>> {
    const cached = await this.cacheManager.get<Record<string, number>>(RATES_CACHE_KEY);
    if (cached) return cached;

    // Fallback: try fetching fresh
    try {
      await this.refreshRates();
      const fresh = await this.cacheManager.get<Record<string, number>>(RATES_CACHE_KEY);
      if (fresh) return fresh;
    } catch {
      // ignore, will try DB next
    }

    // Fallback: last DB snapshot per currency pair
    const dbRates = await this.getLatestRatesFromDb();
    if (Object.keys(dbRates).length > 0) {
      this.logger.warn('Serving FX rates from DB fallback (provider unreachable)');
      return dbRates;
    }

    throw new ServiceUnavailableException(
      'FX rates are temporarily unavailable. Please try again shortly.',
    );
  }

  /**
   * Get rate for a specific currency pair (NGN base).
   * fromCurrency and toCurrency can be any supported currencies.
   */
  async getRate(fromCurrency: string, toCurrency: string): Promise<number> {
    if (fromCurrency === toCurrency) return 1;

    const rates = await this.getRates();

    if (fromCurrency === 'NGN') {
      const rate = rates[toCurrency];
      if (!rate) throw new ServiceUnavailableException(`No rate available for NGN → ${toCurrency}`);
      return rate;
    }

    if (toCurrency === 'NGN') {
      const fromRate = rates[fromCurrency];
      if (!fromRate) throw new ServiceUnavailableException(`No rate available for ${fromCurrency} → NGN`);
      return 1 / fromRate;
    }

    // Cross rate via NGN: fromCurrency → NGN → toCurrency
    const fromRate = rates[fromCurrency];
    const toRate = rates[toCurrency];
    if (!fromRate || !toRate) {
      throw new ServiceUnavailableException(
        `No rate available for ${fromCurrency} → ${toCurrency}`,
      );
    }
    return toRate / fromRate;
  }

  getSupportedCurrencies(): string[] {
    return ['NGN', ...this.supportedCurrencies];
  }

  private async persistSnapshot(rates: Record<string, number>): Promise<void> {
    try {
      const entries = Object.entries(rates)
        .filter(([currency]) => currency !== 'NGN')
        .map(([currency, rate]) => {
          return this.fxHistoryRepo.create({
            fromCurrency: 'NGN',
            toCurrency: currency,
            rate: rate.toString(),
            source: 'provider',
          });
        });
      await this.fxHistoryRepo.save(entries, { chunk: 50 });
    } catch (err) {
      this.logger.error(`Failed to persist FX rate snapshot: ${(err as Error).message}`);
    }
  }

  private async getLatestRatesFromDb(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const currency of this.supportedCurrencies) {
      const row = await this.fxHistoryRepo.findOne({
        where: { fromCurrency: 'NGN', toCurrency: currency },
        order: { createdAt: 'DESC' },
      });
      if (row) {
        result[currency] = parseFloat(row.rate);
      }
    }
    result['NGN'] = 1;
    return result;
  }

  async saveAdminOverrideRate(
    fromCurrency: string,
    toCurrency: string,
    rate: number,
  ): Promise<FxRateHistory> {
    const entry = this.fxHistoryRepo.create({
      fromCurrency: fromCurrency.toUpperCase(),
      toCurrency: toCurrency.toUpperCase(),
      rate: rate.toString(),
      source: 'admin_override',
    });
    return this.fxHistoryRepo.save(entry);
  }

  async getRateHistory(
    fromCurrency: string,
    toCurrency: string,
    from?: Date,
    to?: Date,
  ): Promise<FxRateHistory[]> {
    const qb = this.fxHistoryRepo
      .createQueryBuilder('h')
      .where('h.fromCurrency = :from AND h.toCurrency = :to', {
        from: fromCurrency.toUpperCase(),
        to: toCurrency.toUpperCase(),
      })
      .orderBy('h.createdAt', 'DESC')
      .take(200);

    if (from) qb.andWhere('h.createdAt >= :from', { from });
    if (to) qb.andWhere('h.createdAt <= :to', { to });

    return qb.getMany();
  }
}
