import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Transaction,
  TransactionType,
  TransactionStatus,
} from './entities/transaction.entity';

export interface TransactionFilter {
  type?: TransactionType;
  status?: TransactionStatus;
  currency?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,
  ) {}

  async findForUser(
    userId: string,
    filter: TransactionFilter = {},
  ): Promise<{ data: Transaction[]; total: number; page: number; limit: number }> {
    try {
      const { type, status, currency, from, to, page = 1, limit = 20 } = filter;

      const qb = this.txRepo
        .createQueryBuilder('tx')
        .where('tx.userId = :userId', { userId })
        .orderBy('tx.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(Math.min(limit, 100));

      if (type) qb.andWhere('tx.type = :type', { type });
      if (status) qb.andWhere('tx.status = :status', { status });
      if (currency) {
        qb.andWhere(
          '(tx.fromCurrency = :currency OR tx.toCurrency = :currency)',
          { currency: currency.toUpperCase() },
        );
      }
      if (from) qb.andWhere('tx.createdAt >= :from', { from });
      if (to) qb.andWhere('tx.createdAt <= :to', { to });

      const [data, total] = await qb.getManyAndCount();

      return { data, total, page, limit };
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`findForUser failed for userId=${userId}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not retrieve transactions.');
    }
  }

  async findAllForAdmin(
    filter: TransactionFilter = {},
  ): Promise<{ data: Transaction[]; total: number; page: number; limit: number }> {
    try {
      const { type, status, currency, from, to, page = 1, limit = 50 } = filter;

      const qb = this.txRepo
        .createQueryBuilder('tx')
        .orderBy('tx.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(Math.min(limit, 100));

      if (type) qb.andWhere('tx.type = :type', { type });
      if (status) qb.andWhere('tx.status = :status', { status });
      if (currency) {
        qb.andWhere(
          '(tx.fromCurrency = :currency OR tx.toCurrency = :currency)',
          { currency: currency.toUpperCase() },
        );
      }
      if (from) qb.andWhere('tx.createdAt >= :from', { from });
      if (to) qb.andWhere('tx.createdAt <= :to', { to });

      const [data, total] = await qb.getManyAndCount();

      return { data, total, page, limit };
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`findAllForAdmin failed: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not retrieve transactions.');
    }
  }
}
