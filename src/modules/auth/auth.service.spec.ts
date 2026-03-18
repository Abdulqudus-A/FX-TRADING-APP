import { Test, TestingModule } from '@nestjs/testing';
import {
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { MailerAppService } from '../mailer/mailer.service';
import { User, UserRole } from '../users/entities/user.entity';

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: '$2b$12$hash',
    role: UserRole.USER,
    isVerified: true,
    isActive: true,
    firstName: 'John',
    lastName: 'Doe',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  const usersServiceMock = {
    create: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
    markVerified: jest.fn(),
    validatePassword: jest.fn(),
  };
  const otpServiceMock = {
    createOtp: jest.fn(),
    verifyOtp: jest.fn(),
  };
  const mailerMock = {
    sendOtpEmail: jest.fn().mockResolvedValue(undefined),
  };
  const jwtServiceMock = {
    sign: jest.fn().mockReturnValue('signed-jwt-token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersServiceMock },
        { provide: OtpService, useValue: otpServiceMock },
        { provide: MailerAppService, useValue: mailerMock },
        { provide: JwtService, useValue: jwtServiceMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // ── register ─────────────────────────────────────────────────────────────────

  describe('register', () => {
    it('creates a user, generates OTP, sends email, and returns success message', async () => {
      const user = makeUser({ isVerified: false });
      usersServiceMock.create.mockResolvedValue(user);
      otpServiceMock.createOtp.mockResolvedValue('483920');

      const result = await service.register('test@example.com', 'Password1!', 'John');

      expect(usersServiceMock.create).toHaveBeenCalledWith(
        'test@example.com',
        'Password1!',
        'John',
        undefined,
      );
      expect(otpServiceMock.createOtp).toHaveBeenCalledWith('user-1');
      expect(mailerMock.sendOtpEmail).toHaveBeenCalledWith(
        'test@example.com',
        '483920',
        'John',
      );
      expect(result.message).toContain('verification code');
    });

    it('propagates ConflictException if email already exists', async () => {
      usersServiceMock.create.mockRejectedValue(
        new ConflictException('Email already registered'),
      );

      await expect(
        service.register('existing@example.com', 'Password1!'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── login ────────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns a signed JWT for valid, verified, active credentials', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(makeUser());
      usersServiceMock.validatePassword.mockResolvedValue(true);

      const result = await service.login('test@example.com', 'Password1!');

      expect(result.accessToken).toBe('signed-jwt-token');
      expect(jwtServiceMock.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', email: 'test@example.com' }),
      );
    });

    it('throws UnauthorizedException when user is not found', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);

      await expect(
        service.login('noone@example.com', 'Password1!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(makeUser());
      usersServiceMock.validatePassword.mockResolvedValue(false);

      await expect(
        service.login('test@example.com', 'WrongPassword!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException when account is not verified', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(
        makeUser({ isVerified: false }),
      );
      usersServiceMock.validatePassword.mockResolvedValue(true);

      await expect(
        service.login('test@example.com', 'Password1!'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when account is inactive', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(
        makeUser({ isActive: false }),
      );
      usersServiceMock.validatePassword.mockResolvedValue(true);

      await expect(
        service.login('test@example.com', 'Password1!'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not reveal whether the email exists (same error for wrong email or password)', async () => {
      // User not found
      usersServiceMock.findByEmail.mockResolvedValue(null);
      const err1 = await service.login('a@a.com', 'pass').catch((e) => e);

      // User found but wrong password
      usersServiceMock.findByEmail.mockResolvedValue(makeUser());
      usersServiceMock.validatePassword.mockResolvedValue(false);
      const err2 = await service.login('a@a.com', 'pass').catch((e) => e);

      expect(err1).toBeInstanceOf(UnauthorizedException);
      expect(err2).toBeInstanceOf(UnauthorizedException);
      expect(err1.message).toBe(err2.message);
    });
  });

  // ── verifyOtp ─────────────────────────────────────────────────────────────────

  describe('verifyOtp', () => {
    it('verifies OTP and marks user as verified', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(makeUser({ isVerified: false }));
      otpServiceMock.verifyOtp.mockResolvedValue(undefined);

      const result = await service.verifyOtp('test@example.com', '483920');

      expect(otpServiceMock.verifyOtp).toHaveBeenCalledWith('user-1', '483920');
      expect(usersServiceMock.markVerified).toHaveBeenCalledWith('user-1');
      expect(result.message).toContain('verified');
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);

      await expect(
        service.verifyOtp('ghost@example.com', '123456'),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates UnauthorizedException from OtpService on wrong code', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(makeUser());
      otpServiceMock.verifyOtp.mockRejectedValue(
        new UnauthorizedException('Invalid OTP code.'),
      );

      await expect(
        service.verifyOtp('test@example.com', '000000'),
      ).rejects.toThrow(UnauthorizedException);

      // markVerified must NOT be called if OTP check fails
      expect(usersServiceMock.markVerified).not.toHaveBeenCalled();
    });
  });

  // ── resendOtp ────────────────────────────────────────────────────────────────

  describe('resendOtp', () => {
    it('returns a generic message when email is not registered (prevents enumeration)', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(null);

      const result = await service.resendOtp('ghost@example.com');

      expect(result.message).toContain('If this email is registered');
      expect(otpServiceMock.createOtp).not.toHaveBeenCalled();
    });

    it('returns a message indicating already verified when user is already verified', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(makeUser({ isVerified: true }));

      const result = await service.resendOtp('test@example.com');

      expect(result.message).toContain('already verified');
      expect(otpServiceMock.createOtp).not.toHaveBeenCalled();
    });

    it('creates and sends a new OTP for an unverified user', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(
        makeUser({ isVerified: false }),
      );
      otpServiceMock.createOtp.mockResolvedValue('112233');

      await service.resendOtp('test@example.com');

      expect(otpServiceMock.createOtp).toHaveBeenCalledWith('user-1');
      expect(mailerMock.sendOtpEmail).toHaveBeenCalledWith(
        'test@example.com',
        '112233',
        'John',
      );
    });
  });
});
