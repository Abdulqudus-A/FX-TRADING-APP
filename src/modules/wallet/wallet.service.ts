import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Decimal } from 'decimal.js';
import { Wallet } from './entities/wallet.entity';
import { WalletBalance } from './entities/wallet-balance.entity';
import {
  Transaction,
  TransactionType,
  TransactionStatus,
  TradeDirection,
} from '../transactions/entities/transaction.entity';
import { FxService } from '../fx/fx.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly spreadPct: Decimal;
  private readonly flatFee: Decimal;

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
    @InjectRepository(WalletBalance)
    private readonly balanceRepo: Repository<WalletBalance>,
    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,
    private readonly fxService: FxService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    this.spreadPct = new Decimal(
      config.get<number>('TRADE_SPREAD_PERCENT', 0.005),
    );
    this.flatFee = new Decimal(config.get<number>('TRADE_FEE_FLAT', 0));
  }

  async getBalances(userId: string) {
    try {
      const wallet = await this.walletRepo.findOne({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found.');

      const balances = await this.balanceRepo.find({
        where: { walletId: wallet.id },
        order: { currency: 'ASC' },
      });

      return {
        walletId: wallet.id,
        balances: balances.map((b) => ({
          currency: b.currency,
          balance: parseFloat(b.balance),
          lockedBalance: parseFloat(b.lockedBalance),
          available: new Decimal(b.balance).minus(b.lockedBalance).toNumber(),
        })),
      };
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`getBalances failed for userId=${userId}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not retrieve wallet balances.');
    }
  }

  async fund(userId: string, amount: number, idempotencyKey?: string) {
    try {
      if (idempotencyKey) {
        const existing = await this.txRepo.findOne({ where: { idempotencyKey } });
        if (existing) return existing;
      }

      const amountDec = new Decimal(amount);
      if (amountDec.lte(0)) throw new BadRequestException('Amount must be positive.');

      return await this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const wallet = await manager.findOne(Wallet, { where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found.');

      const balance = await manager
        .createQueryBuilder(WalletBalance, 'wb')
        .setLock('pessimistic_write')
        .where('wb.walletId = :walletId AND wb.currency = :currency', {
          walletId: wallet.id,
          currency: 'NGN',
        })
        .getOne();

      if (!balance) throw new NotFoundException('NGN balance record not found.');

      const newBalance = new Decimal(balance.balance).plus(amountDec);
      await manager.update(WalletBalance, balance.id, {
        balance: newBalance.toFixed(8),
      });

      const tx = manager.create(Transaction, {
        userId,
        type: TransactionType.FUND,
        status: TransactionStatus.COMPLETED,
        fromCurrency: 'NGN',
        toCurrency: 'NGN',
        fromAmount: amountDec.toFixed(8),
        toAmount: amountDec.toFixed(8),
        midRate: '1',
        effectiveRate: '1',
        spread: '0',
        spreadPct: '0',
        fee: '0',
        idempotencyKey: idempotencyKey,
      });
      return manager.save(tx);
      });
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`fund() failed for userId=${userId}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not process funding. Please try again.');
    }
  }

  async convert(
    userId: string,
    fromCurrency: string,
    toCurrency: string,
    amount: number,
    idempotencyKey?: string,
  ) {
    try {
      if (idempotencyKey) {
        const existing = await this.txRepo.findOne({ where: { idempotencyKey } });
        if (existing) return existing;
      }

      fromCurrency = fromCurrency.toUpperCase();
      toCurrency = toCurrency.toUpperCase();

    if (fromCurrency === toCurrency) {
      throw new BadRequestException('Source and destination currencies must differ.');
    }

    this.assertSupportedCurrency(fromCurrency);
    this.assertSupportedCurrency(toCurrency);

    const midRate = await this.fxService.getRate(fromCurrency, toCurrency);
    const midRateDec = new Decimal(midRate);
    const amountDec = new Decimal(amount);
    const toAmount = amountDec.times(midRateDec);

    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const wallet = await manager.findOne(Wallet, { where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found.');

      const fromBalance = await this.getLockedBalance(manager, wallet.id, fromCurrency);
      this.assertSufficientBalance(fromBalance, amountDec, fromCurrency);

      const newFrom = new Decimal(fromBalance.balance).minus(amountDec);
      await manager.update(WalletBalance, fromBalance.id, {
        balance: newFrom.toFixed(8),
      });

      await this.upsertBalance(manager, wallet.id, toCurrency, toAmount);

      const tx = manager.create(Transaction, {
        userId,
        type: TransactionType.CONVERT,
        status: TransactionStatus.COMPLETED,
        fromCurrency,
        toCurrency,
        fromAmount: amountDec.toFixed(8),
        toAmount: toAmount.toFixed(8),
        midRate: midRateDec.toFixed(8),
        effectiveRate: midRateDec.toFixed(8),
        spread: '0',
        spreadPct: '0',
        fee: '0',
        idempotencyKey: idempotencyKey,
      });
      return manager.save(tx);
      });
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`convert() failed for userId=${userId}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Currency conversion failed. Please try again.');
    }
  }

  async trade(
    userId: string,
    direction: TradeDirection,
    currency: string,
    amount: number,
    idempotencyKey?: string,
  ) {
    try {
      if (idempotencyKey) {
        const existing = await this.txRepo.findOne({ where: { idempotencyKey } });
        if (existing) return existing;
      }

      currency = currency.toUpperCase();
    if (currency === 'NGN') {
      throw new BadRequestException(
        'Currency for trading must be a foreign currency, not NGN.',
      );
    }
    this.assertSupportedCurrency(currency);

    // midRate: how many units of `currency` per 1 NGN
    const midRate = await this.fxService.getRate('NGN', currency);
    const midRateDec = new Decimal(midRate);
    const amountDec = new Decimal(amount);
    const spreadAmount = midRateDec.times(this.spreadPct);

    let fromCurrency: string;
    let toCurrency: string;
    let fromAmount: Decimal;
    let toAmount: Decimal;
    let effectiveRate: Decimal;

    if (direction === TradeDirection.BUY) {
      // User spends NGN to acquire foreign currency
      fromCurrency = 'NGN';
      toCurrency = currency;
      fromAmount = amountDec;
      effectiveRate = midRateDec.minus(spreadAmount); // get fewer foreign units
      if (effectiveRate.lte(0))
        throw new BadRequestException('Spread exceeds rate; trade not possible.');
      toAmount = fromAmount.times(effectiveRate).minus(this.flatFee);
      if (toAmount.lte(0)) throw new BadRequestException('Amount too small after fees.');
    } else {
      // SELL: user sells foreign currency for NGN
      fromCurrency = 'NGN';
      toCurrency = currency;
      fromCurrency = currency;
      toCurrency = 'NGN';
      fromAmount = amountDec;
      effectiveRate = new Decimal(1).div(midRateDec.plus(spreadAmount)); // get fewer NGN
      toAmount = fromAmount.times(effectiveRate).minus(this.flatFee);
      if (toAmount.lte(0)) throw new BadRequestException('Amount too small after fees.');
    }

    const spreadDec = effectiveRate.minus(midRateDec).abs();

    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const wallet = await manager.findOne(Wallet, { where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found.');

      const fromBalance = await this.getLockedBalance(manager, wallet.id, fromCurrency);
      this.assertSufficientBalance(fromBalance, fromAmount, fromCurrency);

      const newFrom = new Decimal(fromBalance.balance).minus(fromAmount);
      await manager.update(WalletBalance, fromBalance.id, {
        balance: newFrom.toFixed(8),
      });

      await this.upsertBalance(manager, wallet.id, toCurrency, toAmount);

      const tx = manager.create(Transaction, {
        userId,
        type: TransactionType.TRADE,
        status: TransactionStatus.COMPLETED,
        tradeDirection: direction,
        fromCurrency,
        toCurrency,
        fromAmount: fromAmount.toFixed(8),
        toAmount: toAmount.toFixed(8),
        midRate: midRateDec.toFixed(8),
        effectiveRate: effectiveRate.toFixed(8),
        spread: spreadDec.toFixed(8),
        spreadPct: this.spreadPct.toFixed(6),
        fee: this.flatFee.toFixed(8),
        idempotencyKey: idempotencyKey,
      });
      return manager.save(tx);
      });
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`trade() failed for userId=${userId}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Trade execution failed. Please try again.');
    }
  }

  //Helpers

  private async getLockedBalance(
    manager: any,
    walletId: string,
    currency: string,
  ): Promise<WalletBalance> {
    const balance = await manager
      .createQueryBuilder(WalletBalance, 'wb')
      .setLock('pessimistic_write')
      .where('wb.walletId = :walletId AND wb.currency = :currency', {
        walletId,
        currency,
      })
      .getOne();

    if (!balance) {
      throw new BadRequestException(
        `You do not have a ${currency} balance. Fund your wallet or convert currencies first.`,
      );
    }
    return balance;
  }

  private assertSufficientBalance(
    balance: WalletBalance,
    required: Decimal,
    currency: string,
  ): void {
    const available = new Decimal(balance.balance).minus(balance.lockedBalance);
    if (available.lt(required)) {
      throw new BadRequestException(
        `Insufficient ${currency} balance. Available: ${available.toFixed(2)}, Required: ${required.toFixed(2)}.`,
      );
    }
  }

  private async upsertBalance(
    manager: any,
    walletId: string,
    currency: string,
    addAmount: Decimal,
  ): Promise<void> {
    const existing = await manager
      .createQueryBuilder(WalletBalance, 'wb')
      .setLock('pessimistic_write')
      .where('wb.walletId = :walletId AND wb.currency = :currency', {
        walletId,
        currency,
      })
      .getOne();

    if (existing) {
      const newBal = new Decimal(existing.balance).plus(addAmount);
      await manager.update(WalletBalance, existing.id, {
        balance: newBal.toFixed(8),
      });
    } else {
      const newBalance = manager.create(WalletBalance, {
        walletId,
        currency,
        balance: addAmount.toFixed(8),
        lockedBalance: '0',
      });
      await manager.save(newBalance);
    }
  }

  private assertSupportedCurrency(currency: string): void {
    const supported = this.fxService.getSupportedCurrencies();
    if (!supported.includes(currency)) {
      throw new BadRequestException(
        `Currency ${currency} is not supported. Supported: ${supported.join(', ')}.`,
      );
    }
  }
}
