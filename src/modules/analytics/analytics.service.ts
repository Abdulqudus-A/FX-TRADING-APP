import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction, TransactionType } from '../transactions/entities/transaction.entity';
import { FxRateHistory } from '../fx/entities/fx-rate-history.entity';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,
    @InjectRepository(FxRateHistory)
    private readonly fxHistoryRepo: Repository<FxRateHistory>,
  ) {}

  /**
   * Trade volume aggregated by currency pair and day.
   */
  async getTradeVolume(
    from?: Date,
    to?: Date,
    currency?: string,
  ): Promise<any[]> {
    try {
      const qb = this.txRepo
        .createQueryBuilder('tx')
        .select("DATE_TRUNC('day', tx.createdAt)", 'day')
        .addSelect('tx.fromCurrency', 'fromCurrency')
        .addSelect('tx.toCurrency', 'toCurrency')
        .addSelect('COUNT(*)', 'tradeCount')
        .addSelect('SUM(CAST(tx.fromAmount AS NUMERIC))', 'totalFromAmount')
        .addSelect('SUM(CAST(tx.toAmount AS NUMERIC))', 'totalToAmount')
        .where('tx.type IN (:...types)', {
          types: [TransactionType.TRADE, TransactionType.CONVERT],
        })
        .groupBy("DATE_TRUNC('day', tx.createdAt), tx.fromCurrency, tx.toCurrency")
        .orderBy("DATE_TRUNC('day', tx.createdAt)", 'DESC');

      if (from) qb.andWhere('tx.createdAt >= :from', { from });
      if (to) qb.andWhere('tx.createdAt <= :to', { to });
      if (currency) {
        qb.andWhere(
          '(tx.fromCurrency = :currency OR tx.toCurrency = :currency)',
          { currency: currency.toUpperCase() },
        );
      }

      return await qb.getRawMany();
    } catch (err) {
      this.logger.error(`getTradeVolume failed: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not retrieve trade analytics.');
    }
  }

  /**
   * FX rate trend for a currency pair over a time range.
   */
  async getFxTrend(
    fromCurrency: string,
    toCurrency: string,
    from?: Date,
    to?: Date,
    limit = 100,
  ): Promise<FxRateHistory[]> {
    try {
      const qb = this.fxHistoryRepo
        .createQueryBuilder('h')
        .where('h.fromCurrency = :from AND h.toCurrency = :to', {
          from: fromCurrency.toUpperCase(),
          to: toCurrency.toUpperCase(),
        })
        .orderBy('h.createdAt', 'DESC')
        .take(Math.min(limit, 500));

      if (from) qb.andWhere('h.createdAt >= :from', { from });
      if (to) qb.andWhere('h.createdAt <= :to', { to });

      return await qb.getMany();
    } catch (err) {
      this.logger.error(`getFxTrend failed for ${fromCurrency}→${toCurrency}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not retrieve FX trend data.');
    }
  }
}
