import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { MailerAppService } from '../mailer/mailer.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly mailerService: MailerAppService,
    private readonly jwtService: JwtService,
  ) {}

  async register(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
  ): Promise<{ message: string }> {
    try {
      const user = await this.usersService.create(email, password, firstName, lastName);
      const otp = await this.otpService.createOtp(user.id);

      try {
        await this.mailerService.sendOtpEmail(email, otp, firstName);
      } catch (mailErr) {
        // Non-fatal: user is created; log and continue
        this.logger.error(
          `Failed to send OTP email to ${email}: ${(mailErr as Error).message}`,
        );
      }

      return {
        message:
          'Registration successful. Please check your email for a verification code.',
      };
    } catch (err) {
      if ((err as any).status) throw err; // re-throw NestJS HTTP exceptions (e.g. 409)
      this.logger.error(`Register failed for ${email}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Registration failed. Please try again.');
    }
  }

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    try {
      const user = await this.usersService.findByEmail(email);
      if (!user) {
        throw new UnauthorizedException('Invalid email or password.');
      }

      const isValid = await this.usersService.validatePassword(user, password);
      if (!isValid) {
        throw new UnauthorizedException('Invalid email or password.');
      }

      if (!user.isActive) {
        throw new ForbiddenException('Your account has been deactivated.');
      }

      if (!user.isVerified) {
        throw new ForbiddenException(
          'Email not verified. Please verify your email before logging in.',
        );
      }

      const accessToken = this.signToken(user);
      return { accessToken };
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`Login failed for ${email}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Login failed. Please try again.');
    }
  }

  async verifyOtp(email: string, code: string): Promise<{ message: string }> {
    try {
      const user = await this.usersService.findByEmail(email);
      if (!user) {
        throw new NotFoundException('User not found.');
      }

      await this.otpService.verifyOtp(user.id, code);
      await this.usersService.markVerified(user.id);

      return { message: 'Email verified successfully. You can now log in.' };
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`OTP verification failed for ${email}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Verification failed. Please try again.');
    }
  }

  async resendOtp(email: string): Promise<{ message: string }> {
    try {
      const user = await this.usersService.findByEmail(email);
      if (!user) {
        return { message: 'If this email is registered, a new OTP has been sent.' };
      }

      if (user.isVerified) {
        return { message: 'This account is already verified.' };
      }

      const otp = await this.otpService.createOtp(user.id);

      try {
        await this.mailerService.sendOtpEmail(email, otp, user.firstName);
      } catch (mailErr) {
        this.logger.error(
          `Failed to resend OTP email to ${email}: ${(mailErr as Error).message}`,
        );
      }

      return { message: 'If this email is registered, a new OTP has been sent.' };
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`ResendOtp failed for ${email}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not resend OTP. Please try again.');
    }
  }

  private signToken(user: User): string {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }
}
