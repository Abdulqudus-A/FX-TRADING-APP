import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailerAppService {
  private readonly logger = new Logger(MailerAppService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendOtpEmail(
    to: string,
    otpCode: string,
    firstName?: string,
  ): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to,
        subject: 'Your FX Trading App verification code',
        template: 'otp',
        context: {
          otpCode,
          firstName: firstName ?? '',
        },
      });
      this.logger.log(`OTP email sent to ${to}`);
    } catch (err) {
      this.logger.error(`Failed to send OTP email to ${to}: ${(err as Error).message}`);
      // Do not throw — we don't want mailer failures to block registration
    }
  }
}
