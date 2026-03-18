import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { of, throwError } from 'rxjs';
import { FxService } from './fx.service';
import { FxRateHistory } from './entities/fx-rate-history.entity';

const MOCK_RATES = { USD: 0.00064, EUR: 0.00059, GBP: 0.00051, GBP_: 0.00051, CAD: 0.00088, JPY: 0.096, NGN: 1 };

const mockProviderResponse = (rates: Record<string, number> = MOCK_RATES) => ({
  data: {
    result: 'success',
    base_code: 'NGN',
    conversion_rates: rates,
    time_last_update_unix: Date.now() / 1000,
  },
});

describe('FxService', () => {
  let service: FxService;

  const httpServiceMock = { get: jest.fn() };
  const fxHistoryRepoMock = {
    findOne: jest.fn(),
    create: jest.fn().mockImplementation((data) => data),
    save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
  };
  const cacheMock = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const configServiceMock = {
    get: jest.fn((key: string, def?: any) => {
      const map: Record<string, any> = {
        FX_API_KEY: 'test-api-key',
        FX_API_BASE_URL: 'https://v6.exchangerate-api.com/v6',
        FX_CACHE_TTL_SECONDS: 300,
        SUPPORTED_CURRENCIES: 'USD,EUR,GBP,CAD,JPY',
      };
      return map[key] ?? def;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FxService,
        { provide: HttpService, useValue: httpServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: getRepositoryToken(FxRateHistory), useValue: fxHistoryRepoMock },
        { provide: CACHE_MANAGER, useValue: cacheMock },
      ],
    }).compile();

    service = module.get<FxService>(FxService);

    jest.clearAllMocks();
    // Prevent onModuleInit from firing during most tests
    jest.spyOn(service, 'refreshRates').mockResolvedValue(undefined);
  });

  // ── getRates ─────────────────────────────────────────────────────────────────

  describe('getRates', () => {
    it('returns cached rates when Redis has data (fast path)', async () => {
      cacheMock.get.mockResolvedValue(MOCK_RATES);

      const result = await service.getRates();

      expect(result).toEqual(MOCK_RATES);
      expect(httpServiceMock.get).not.toHaveBeenCalled();
    });

    it('fetches fresh rates when cache is empty', async () => {
      cacheMock.get
        .mockResolvedValueOnce(null) // initial cache miss
        .mockResolvedValueOnce(MOCK_RATES); // after refreshRates populates it

      // Allow real refreshRates to run
      jest.spyOn(service, 'refreshRates').mockRestore();
      httpServiceMock.get.mockReturnValue(of(mockProviderResponse()));
      fxHistoryRepoMock.save.mockResolvedValue([]);

      const result = await service.getRates();

      expect(result).toHaveProperty('USD');
      expect(result['NGN']).toBe(1);
    });

    it('falls back to DB when provider is unreachable and cache is empty', async () => {
      cacheMock.get.mockResolvedValue(null);

      // refreshRates fails (provider down)
      jest.spyOn(service, 'refreshRates').mockRestore();
      httpServiceMock.get.mockReturnValue(
        throwError(() => new Error('Network error')),
      );

      // DB has last known rates
      fxHistoryRepoMock.findOne.mockImplementation(({ where }: any) => {
        const rateMap: Record<string, string> = {
          USD: '0.00064',
          EUR: '0.00059',
          GBP: '0.00051',
          CAD: '0.00088',
          JPY: '0.096',
        };
        return Promise.resolve({ rate: rateMap[where.toCurrency] ?? null });
      });

      const result = await service.getRates();

      expect(result).toHaveProperty('USD');
      expect(result).toHaveProperty('NGN', 1);
    });

    it('serves {NGN:1} from DB fallback when all currency rows are null', async () => {
      cacheMock.get.mockResolvedValue(null);

      jest.spyOn(service, 'refreshRates').mockRestore();
      httpServiceMock.get.mockReturnValue(
        throwError(() => new Error('Network error')),
      );

      // All DB rows missing — only NGN:1 built-in default remains
      fxHistoryRepoMock.findOne.mockResolvedValue(null);

      const result = await service.getRates();
      expect(result).toEqual({ NGN: 1 });
    });
  });

  // ── getRate ──────────────────────────────────────────────────────────────────

  describe('getRate', () => {
    beforeEach(() => {
      cacheMock.get.mockResolvedValue(MOCK_RATES);
    });

    it('returns 1 when from and to currencies are the same', async () => {
      const rate = await service.getRate('NGN', 'NGN');
      expect(rate).toBe(1);
    });

    it('returns direct rate for NGN → USD', async () => {
      const rate = await service.getRate('NGN', 'USD');
      expect(rate).toBe(0.00064);
    });

    it('returns inverse rate for USD → NGN', async () => {
      const rate = await service.getRate('USD', 'NGN');
      // 1 / 0.00064 ≈ 1562.5
      expect(rate).toBeCloseTo(1562.5, 1);
    });

    it('computes cross rate for USD → EUR via NGN', async () => {
      // EUR/NGN = 0.00059, USD/NGN = 0.00064
      // USD → EUR rate = 0.00059 / 0.00064 ≈ 0.921875
      const rate = await service.getRate('USD', 'EUR');
      expect(rate).toBeCloseTo(0.00059 / 0.00064, 5);
    });

    it('throws ServiceUnavailableException for unsupported target currency', async () => {
      await expect(service.getRate('NGN', 'XYZ')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ── refreshRates ──────────────────────────────────────────────────────────────

  describe('refreshRates', () => {
    beforeEach(() => {
      // Restore the real implementation for these tests
      jest.spyOn(service, 'refreshRates').mockRestore();
    });

    it('sets Redis cache with filtered supported currencies after successful fetch', async () => {
      httpServiceMock.get.mockReturnValue(of(mockProviderResponse()));
      fxHistoryRepoMock.save.mockResolvedValue([]);

      await service.refreshRates();

      expect(cacheMock.set).toHaveBeenCalledWith(
        'fx:rates:NGN',
        expect.objectContaining({ USD: expect.any(Number), NGN: 1 }),
        300000, // 300s × 1000ms
      );
    });

    it('saves a snapshot to FxRateHistory after successful fetch', async () => {
      httpServiceMock.get.mockReturnValue(of(mockProviderResponse()));
      fxHistoryRepoMock.save.mockResolvedValue([]);

      await service.refreshRates();

      expect(fxHistoryRepoMock.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ fromCurrency: 'NGN', source: 'provider' }),
        ]),
        expect.objectContaining({ chunk: 50 }),
      );
    });

    it('does not throw when provider returns an error result (logs instead)', async () => {
      httpServiceMock.get.mockReturnValue(
        of({ data: { result: 'error', 'error-type': 'invalid-key' } }),
      );

      // Should not throw — errors are logged internally
      await expect(service.refreshRates()).resolves.not.toThrow();
      expect(cacheMock.set).not.toHaveBeenCalled();
    });

    it('does not throw on network error (logs instead)', async () => {
      httpServiceMock.get.mockReturnValue(
        throwError(() => new Error('ECONNREFUSED')),
      );

      await expect(service.refreshRates()).resolves.not.toThrow();
    });
  });

  // ── getSupportedCurrencies ────────────────────────────────────────────────────

  describe('getSupportedCurrencies', () => {
    it('always includes NGN as the first element', () => {
      const currencies = service.getSupportedCurrencies();
      expect(currencies[0]).toBe('NGN');
    });

    it('includes all configured SUPPORTED_CURRENCIES', () => {
      const currencies = service.getSupportedCurrencies();
      expect(currencies).toContain('USD');
      expect(currencies).toContain('EUR');
      expect(currencies).toContain('GBP');
    });
  });

  // ── saveAdminOverrideRate ────────────────────────────────────────────────────

  describe('saveAdminOverrideRate', () => {
    it('saves an FxRateHistory record with source=admin_override', async () => {
      const savedEntry = {
        id: 'rate-1',
        fromCurrency: 'NGN',
        toCurrency: 'USD',
        rate: '0.0007',
        source: 'admin_override',
      };
      fxHistoryRepoMock.save.mockResolvedValue(savedEntry);

      const result = await service.saveAdminOverrideRate('NGN', 'USD', 0.0007);

      expect(fxHistoryRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fromCurrency: 'NGN',
          toCurrency: 'USD',
          rate: '0.0007',
          source: 'admin_override',
        }),
      );
      expect(result.source).toBe('admin_override');
    });
  });
});
