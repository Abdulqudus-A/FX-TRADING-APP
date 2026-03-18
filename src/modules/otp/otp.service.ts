import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Otp } from './entities/otp.entity';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';

const OTP_EXPIRY_MINUTES = 10;
const OTP_BCRYPT_ROUNDS = 10;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectRepository(Otp)
    private readonly otpRepo: Repository<Otp>,
  ) {}

  async createOtp(userId: string): Promise<string> {
    try {
      // Invalidate all previous unused OTPs for this user
      await this.otpRepo.update({ userId, isUsed: false }, { isUsed: true });

      // Generate cryptographically random 6-digit code
      const code = randomInt(100000, 999999).toString();
      const hashedCode = await bcrypt.hash(code, OTP_BCRYPT_ROUNDS);

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

      const otp = this.otpRepo.create({
        userId,
        code: hashedCode,
        expiresAt,
        isUsed: false,
      });
      await this.otpRepo.save(otp);

      this.logger.warn(`[DEV] OTP for userId=${userId} → ${code}`);

      return code; // Return plain code to be sent by email
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`Failed to create OTP for userId=${userId}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not generate OTP. Please try again.');
    }
  }

  async verifyOtp(userId: string, plainCode: string): Promise<void> {
    try {
      const now = new Date();

      const otps = await this.otpRepo.find({
        where: {
          userId,
          isUsed: false,
          expiresAt: MoreThan(now),
        },
        order: { createdAt: 'DESC' },
      });

      if (!otps.length) {
        throw new BadRequestException('No valid OTP found. Please request a new one.');
      }

      // Check against the most recent valid OTP
      const latestOtp = otps[0];
      const isMatch = await bcrypt.compare(plainCode, latestOtp.code);

      if (!isMatch) {
        throw new UnauthorizedException('Invalid OTP code.');
      }

      // Mark as used
      await this.otpRepo.update(latestOtp.id, { isUsed: true });
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`OTP verification error for userId=${userId}: ${(err as Error).message}`);
      throw new InternalServerErrorException('OTP verification failed. Please try again.');
    }
  }
}
