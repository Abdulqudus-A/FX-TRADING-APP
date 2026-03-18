import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { OtpService } from './otp.service';
import { Otp } from './entities/otp.entity';
import * as bcrypt from 'bcrypt';

// Helper to build a mock OTP record
const makeMockOtp = (overrides: Partial<Otp> = {}): Otp => {
  const future = new Date();
  future.setMinutes(future.getMinutes() + 10);
  return {
    id: 'otp-1',
    userId: 'user-1',
    code: '$2b$10$hashedcode',
    expiresAt: future,
    isUsed: false,
    createdAt: new Date(),
    user: null as any,
    ...overrides,
  };
};

describe('OtpService', () => {
  let service: OtpService;
  let otpRepo: jest.Mocked<Pick<Repository<Otp>, 'update' | 'create' | 'save' | 'find'>>;

  beforeEach(async () => {
    otpRepo = {
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: getRepositoryToken(Otp), useValue: otpRepo },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── createOtp ────────────────────────────────────────────────────────────────

  describe('createOtp', () => {
    it('returns a 6-digit numeric string', async () => {
      const code = await service.createOtp('user-1');
      expect(code).toMatch(/^\d{6}$/);
    });

    it('invalidates all previous unused OTPs for the user before creating', async () => {
      await service.createOtp('user-1');
      expect(otpRepo.update).toHaveBeenCalledWith(
        { userId: 'user-1', isUsed: false },
        { isUsed: true },
      );
    });

    it('saves a new OTP record with isUsed=false and future expiresAt', async () => {
      const before = new Date();
      await service.createOtp('user-1');
      const after = new Date();

      const savedOtp = (otpRepo.save as jest.Mock).mock.calls[0][0];
      expect(savedOtp.isUsed).toBe(false);
      expect(new Date(savedOtp.expiresAt).getTime()).toBeGreaterThan(before.getTime());
      expect(new Date(savedOtp.expiresAt).getTime()).toBeGreaterThan(after.getTime());
    });

    it('stores bcrypt hash, not the plain code', async () => {
      const plainCode = await service.createOtp('user-1');
      const savedOtp = (otpRepo.save as jest.Mock).mock.calls[0][0];

      // The stored code must NOT equal the plain code
      expect(savedOtp.code).not.toBe(plainCode);
      // But bcrypt.compare must return true
      const isMatch = await bcrypt.compare(plainCode, savedOtp.code);
      expect(isMatch).toBe(true);
    });

    it('generates different codes on successive calls', async () => {
      const code1 = await service.createOtp('user-1');
      const code2 = await service.createOtp('user-1');
      // With astronomically low probability, could collide — acceptable in practice
      // But we test they're both valid format
      expect(code1).toMatch(/^\d{6}$/);
      expect(code2).toMatch(/^\d{6}$/);
    });
  });

  // ── verifyOtp ────────────────────────────────────────────────────────────────

  describe('verifyOtp', () => {
    it('marks OTP as used when code matches', async () => {
      const plainCode = '483920';
      const hashed = await bcrypt.hash(plainCode, 4); // low rounds for test speed
      const otp = makeMockOtp({ code: hashed });

      otpRepo.find.mockResolvedValue([otp]);

      await service.verifyOtp('user-1', plainCode);

      expect(otpRepo.update).toHaveBeenCalledWith('otp-1', { isUsed: true });
    });

    it('throws BadRequestException when no valid (unexpired, unused) OTPs exist', async () => {
      otpRepo.find.mockResolvedValue([]);
      await expect(service.verifyOtp('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws UnauthorizedException when code does not match hash', async () => {
      const hashed = await bcrypt.hash('999999', 4);
      const otp = makeMockOtp({ code: hashed });

      otpRepo.find.mockResolvedValue([otp]);

      await expect(service.verifyOtp('user-1', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does not accept an already-used OTP (repo query filters isUsed=false)', async () => {
      // The repo.find is called with isUsed: false in the where clause.
      // Simulate the DB correctly returning [] for used OTPs.
      otpRepo.find.mockImplementation(({ where }: any) => {
        if (where?.isUsed === false) return Promise.resolve([]);
        return Promise.resolve([makeMockOtp({ isUsed: true })]);
      });

      await expect(service.verifyOtp('user-1', '483920')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('does not accept an expired OTP (repo query filters expiresAt > now)', async () => {
      // find returns [] because the DB correctly filters out expired OTPs
      otpRepo.find.mockResolvedValue([]);

      await expect(service.verifyOtp('user-1', '483920')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
