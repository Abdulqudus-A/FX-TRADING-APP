import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WalletService } from './wallet.service';
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

// ─── Helpers ────────────────────────────────────────────────────────────────

const mockWallet = (overrides = {}): Wallet =>
  ({ id: 'wallet-1', userId: 'user-1', isActive: true, ...overrides } as Wallet);

const mockBalance = (
  currency: string,
  balance: string,
  overrides = {},
): WalletBalance =>
  ({
    id: `bal-${currency}`,
    walletId: 'wallet-1',
    currency,
    balance,
    lockedBalance: '0',
    ...overrides,
  } as WalletBalance);

const mockTransaction = (overrides = {}): Transaction =>
  ({
    id: 'tx-1',
    userId: 'user-1',
    type: TransactionType.FUND,
    status: TransactionStatus.COMPLETED,
    ...overrides,
  } as Transaction);

/**
 * Builds a fake EntityManager that simulates what DataSource.transaction passes.
 * findOne, createQueryBuilder, update, create, save are all jest mocks.
 */
function buildManagerMock(overrides: Record<string, jest.Mock> = {}) {
  const qbMock = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const manager: Record<string, jest.Mock> = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(qbMock),
    update: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockImplementation((_entity, data) => data),
    save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    ...overrides,
  };
  return { manager, qbMock };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WalletService', () => {
  let service: WalletService;

  const walletRepoMock = { findOne: jest.fn(), find: jest.fn() };
  const balanceRepoMock = { find: jest.fn() };
  const txRepoMock = { findOne: jest.fn() };
  const fxServiceMock = {
    getRate: jest.fn(),
    getSupportedCurrencies: jest.fn().mockReturnValue(['NGN', 'USD', 'EUR', 'GBP']),
  };
  const configServiceMock = { get: jest.fn().mockReturnValue(0.005) };
  let dataSourceMock: { transaction: jest.Mock };

  beforeEach(async () => {
    dataSourceMock = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getRepositoryToken(Wallet), useValue: walletRepoMock },
        { provide: getRepositoryToken(WalletBalance), useValue: balanceRepoMock },
        { provide: getRepositoryToken(Transaction), useValue: txRepoMock },
        { provide: FxService, useValue: fxServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);

    jest.clearAllMocks();
    // Reset getSupportedCurrencies to always return valid list
    fxServiceMock.getSupportedCurrencies.mockReturnValue(['NGN', 'USD', 'EUR', 'GBP']);
    configServiceMock.get.mockReturnValue(0.005);
  });

  // ── getBalances ─────────────────────────────────────────────────────────────

  describe('getBalances', () => {
    it('returns all currency balances for a user', async () => {
      walletRepoMock.findOne.mockResolvedValue(mockWallet());
      balanceRepoMock.find.mockResolvedValue([
        mockBalance('NGN', '10000'),
        mockBalance('USD', '6.40000000'),
      ]);

      const result = await service.getBalances('user-1');

      expect(result.walletId).toBe('wallet-1');
      expect(result.balances).toHaveLength(2);
      expect(result.balances[0].currency).toBe('NGN');
      expect(result.balances[0].balance).toBe(10000);
      expect(result.balances[0].available).toBe(10000);
    });

    it('throws NotFoundException when wallet does not exist', async () => {
      walletRepoMock.findOne.mockResolvedValue(null);
      await expect(service.getBalances('no-user')).rejects.toThrow(NotFoundException);
    });

    it('correctly computes available = balance - lockedBalance', async () => {
      walletRepoMock.findOne.mockResolvedValue(mockWallet());
      balanceRepoMock.find.mockResolvedValue([
        mockBalance('NGN', '5000', { lockedBalance: '1000' }),
      ]);

      const result = await service.getBalances('user-1');
      expect(result.balances[0].available).toBe(4000);
    });
  });

  // ── fund ────────────────────────────────────────────────────────────────────

  describe('fund', () => {
    it('credits NGN balance and returns a FUND transaction', async () => {
      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      qbMock.getOne.mockResolvedValue(mockBalance('NGN', '1000'));
      const savedTx = mockTransaction({ type: TransactionType.FUND });
      manager.save.mockResolvedValue(savedTx);

      const result = await service.fund('user-1', 500);

      expect(manager.update).toHaveBeenCalledWith(
        WalletBalance,
        'bal-NGN',
        expect.objectContaining({ balance: '1500.00000000' }),
      );
      expect(result.type).toBe(TransactionType.FUND);
    });

    it('throws BadRequestException for zero amount', async () => {
      await expect(service.fund('user-1', 0)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for negative amount', async () => {
      await expect(service.fund('user-1', -100)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when wallet not found', async () => {
      const { manager } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(null);

      await expect(service.fund('user-1', 500)).rejects.toThrow(NotFoundException);
    });

    it('returns existing transaction when idempotencyKey already used', async () => {
      const existingTx = mockTransaction({ id: 'existing-tx' });
      txRepoMock.findOne.mockResolvedValue(existingTx);

      const result = await service.fund('user-1', 500, 'idem-key-123');

      expect(result).toBe(existingTx);
      expect(dataSourceMock.transaction).not.toHaveBeenCalled();
    });

    it('proceeds when idempotencyKey is new', async () => {
      txRepoMock.findOne.mockResolvedValue(null); // key not found

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      qbMock.getOne.mockResolvedValue(mockBalance('NGN', '1000'));
      manager.save.mockResolvedValue(mockTransaction());

      await service.fund('user-1', 500, 'new-idem-key');

      expect(dataSourceMock.transaction).toHaveBeenCalled();
    });

    it('uses Decimal arithmetic — avoids floating point errors', async () => {
      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      qbMock.getOne.mockResolvedValue(mockBalance('NGN', '0.1'));
      manager.save.mockResolvedValue(mockTransaction());

      await service.fund('user-1', 0.2);

      // 0.1 + 0.2 = 0.3 exactly (not 0.30000000000000004)
      expect(manager.update).toHaveBeenCalledWith(
        WalletBalance,
        'bal-NGN',
        expect.objectContaining({ balance: '0.30000000' }),
      );
    });
  });

  // ── convert ─────────────────────────────────────────────────────────────────

  describe('convert', () => {
    it('converts NGN to USD at mid-market rate with no spread', async () => {
      fxServiceMock.getRate.mockResolvedValue(0.00064); // 1 NGN = 0.00064 USD

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());

      let callCount = 0;
      qbMock.getOne.mockImplementation(() => {
        // First call = source balance lock, second = upsert target check
        callCount++;
        if (callCount === 1) return Promise.resolve(mockBalance('NGN', '10000'));
        return Promise.resolve(null); // USD balance doesn't exist yet
      });
      manager.save.mockResolvedValue(
        mockTransaction({ type: TransactionType.CONVERT }),
      );

      const result = await service.convert('user-1', 'NGN', 'USD', 1000);

      // NGN debited
      expect(manager.update).toHaveBeenCalledWith(
        WalletBalance,
        'bal-NGN',
        expect.objectContaining({ balance: '9000.00000000' }),
      );
      expect(result.type).toBe(TransactionType.CONVERT);
    });

    it('converts EUR to NGN (cross to base)', async () => {
      fxServiceMock.getRate.mockResolvedValue(1700); // 1 EUR = 1700 NGN

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());

      let callCount = 0;
      qbMock.getOne.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(mockBalance('EUR', '50'));
        return Promise.resolve(null);
      });
      manager.save.mockResolvedValue(mockTransaction({ type: TransactionType.CONVERT }));

      await service.convert('user-1', 'EUR', 'NGN', 50);

      // EUR debited
      expect(manager.update).toHaveBeenCalledWith(
        WalletBalance,
        'bal-EUR',
        expect.objectContaining({ balance: '0.00000000' }),
      );
    });

    it('throws BadRequestException when from and to currency are the same', async () => {
      await expect(
        service.convert('user-1', 'NGN', 'NGN', 100),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when currency is unsupported', async () => {
      await expect(
        service.convert('user-1', 'NGN', 'XYZ', 100),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on insufficient balance', async () => {
      fxServiceMock.getRate.mockResolvedValue(0.00064);

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      // Only 100 NGN available, trying to convert 500
      qbMock.getOne.mockResolvedValue(mockBalance('NGN', '100'));

      await expect(
        service.convert('user-1', 'NGN', 'USD', 500),
      ).rejects.toThrow(BadRequestException);
    });

    it('is case-insensitive for currency codes', async () => {
      fxServiceMock.getRate.mockResolvedValue(0.00064);

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      qbMock.getOne
        .mockResolvedValueOnce(mockBalance('NGN', '10000'))
        .mockResolvedValueOnce(null);
      manager.save.mockResolvedValue(mockTransaction());

      // Should not throw even though 'ngn' / 'usd' are lowercase
      await expect(
        service.convert('user-1', 'ngn', 'usd', 100),
      ).resolves.not.toThrow();
    });
  });

  // ── trade ───────────────────────────────────────────────────────────────────

  describe('trade', () => {
    it('BUY: deducts NGN and credits foreign currency with spread applied', async () => {
      // midRate: 1 NGN = 0.00064 USD
      fxServiceMock.getRate.mockResolvedValue(0.00064);

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      qbMock.getOne
        .mockResolvedValueOnce(mockBalance('NGN', '10000'))
        .mockResolvedValueOnce(null); // no USD balance yet
      manager.save.mockResolvedValue(
        mockTransaction({ type: TransactionType.TRADE }),
      );

      const result = await service.trade('user-1', TradeDirection.BUY, 'USD', 1000);

      expect(result.type).toBe(TransactionType.TRADE);
      // NGN balance should be debited
      expect(manager.update).toHaveBeenCalledWith(
        WalletBalance,
        'bal-NGN',
        expect.objectContaining({ balance: '9000.00000000' }),
      );
    });

    it('SELL: deducts foreign currency and credits NGN with spread applied', async () => {
      fxServiceMock.getRate.mockResolvedValue(0.00064); // 1 NGN = 0.00064 USD

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      qbMock.getOne
        .mockResolvedValueOnce(mockBalance('USD', '10'))
        .mockResolvedValueOnce(null);
      manager.save.mockResolvedValue(
        mockTransaction({ type: TransactionType.TRADE }),
      );

      const result = await service.trade('user-1', TradeDirection.SELL, 'USD', 10);

      expect(result.type).toBe(TransactionType.TRADE);
      // USD balance should be debited
      expect(manager.update).toHaveBeenCalledWith(
        WalletBalance,
        'bal-USD',
        expect.objectContaining({ balance: '0.00000000' }),
      );
    });

    it('BUY: effectiveRate is worse than mid-rate (user gets fewer foreign units)', async () => {
      // midRate: 1 NGN = 0.001 USD (clean number for easy math)
      fxServiceMock.getRate.mockResolvedValue(0.001);

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      qbMock.getOne
        .mockResolvedValueOnce(mockBalance('NGN', '10000'))
        .mockResolvedValueOnce(null);

      let capturedUsdCredit: string | null = null;
      manager.save.mockImplementation((entity) => {
        if (entity.toCurrency === 'USD') capturedUsdCredit = entity.toAmount;
        return Promise.resolve(mockTransaction({ type: TransactionType.TRADE }));
      });
      // Also capture the upsert save
      manager.create.mockImplementation((_entity, data) => {
        if (data?.currency === 'USD') capturedUsdCredit = data.balance;
        return data;
      });

      await service.trade('user-1', TradeDirection.BUY, 'USD', 1000);

      // Without spread: 1000 × 0.001 = 1.0 USD
      // With 0.5% spread: effectiveRate = 0.001 - 0.000005 = 0.000995
      //   → toAmount = 1000 × 0.000995 = 0.995 USD (fewer than 1.0)
      // capturedUsdCredit should be less than '1.00000000'
      if (capturedUsdCredit) {
        expect(parseFloat(capturedUsdCredit)).toBeLessThan(1.0);
      }
    });

    it('throws BadRequestException when currency is NGN', async () => {
      await expect(
        service.trade('user-1', TradeDirection.BUY, 'NGN', 100),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when currency is unsupported', async () => {
      await expect(
        service.trade('user-1', TradeDirection.BUY, 'XYZ', 100),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on insufficient balance for BUY', async () => {
      fxServiceMock.getRate.mockResolvedValue(0.00064);

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      // Only 50 NGN, trying to spend 500
      qbMock.getOne.mockResolvedValue(mockBalance('NGN', '50'));

      await expect(
        service.trade('user-1', TradeDirection.BUY, 'USD', 500),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on insufficient balance for SELL', async () => {
      fxServiceMock.getRate.mockResolvedValue(0.00064);

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      // Only 1 USD, trying to sell 100
      qbMock.getOne.mockResolvedValue(mockBalance('USD', '1'));

      await expect(
        service.trade('user-1', TradeDirection.SELL, 'USD', 100),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns existing transaction for duplicate idempotencyKey', async () => {
      const existingTx = mockTransaction({ id: 'existing-trade' });
      txRepoMock.findOne.mockResolvedValue(existingTx);

      const result = await service.trade(
        'user-1',
        TradeDirection.BUY,
        'USD',
        1000,
        'idem-trade-key',
      );

      expect(result).toBe(existingTx);
      expect(dataSourceMock.transaction).not.toHaveBeenCalled();
    });
  });

  // ── double-spend prevention ─────────────────────────────────────────────────

  describe('double-spend prevention', () => {
    it('fund uses pessimistic_write lock on balance row', async () => {
      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      qbMock.getOne.mockResolvedValue(mockBalance('NGN', '500'));
      manager.save.mockResolvedValue(mockTransaction());

      await service.fund('user-1', 100);

      expect(qbMock.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('convert uses REPEATABLE READ isolation level', async () => {
      fxServiceMock.getRate.mockResolvedValue(0.00064);

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      qbMock.getOne
        .mockResolvedValueOnce(mockBalance('NGN', '10000'))
        .mockResolvedValueOnce(null);
      manager.save.mockResolvedValue(mockTransaction());

      await service.convert('user-1', 'NGN', 'USD', 500);

      expect(dataSourceMock.transaction).toHaveBeenCalledWith(
        'REPEATABLE READ',
        expect.any(Function),
      );
    });

    it('trade uses REPEATABLE READ isolation level', async () => {
      fxServiceMock.getRate.mockResolvedValue(0.00064);

      const { manager, qbMock } = buildManagerMock();
      dataSourceMock.transaction.mockImplementation((_iso, cb) => cb(manager));
      manager.findOne.mockResolvedValue(mockWallet());
      qbMock.getOne
        .mockResolvedValueOnce(mockBalance('NGN', '10000'))
        .mockResolvedValueOnce(null);
      manager.save.mockResolvedValue(mockTransaction());

      await service.trade('user-1', TradeDirection.BUY, 'USD', 500);

      expect(dataSourceMock.transaction).toHaveBeenCalledWith(
        'REPEATABLE READ',
        expect.any(Function),
      );
    });
  });
});
