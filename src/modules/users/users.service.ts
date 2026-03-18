import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Wallet } from '../wallet/entities/wallet.entity';
import { WalletBalance } from '../wallet/entities/wallet-balance.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
    @InjectRepository(WalletBalance)
    private readonly walletBalanceRepo: Repository<WalletBalance>,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
  ): Promise<User> {
    try {
      const existing = await this.userRepo.findOne({ where: { email } });
      if (existing) {
        throw new ConflictException('An account with this email already exists.');
      }

      const passwordHash = await bcrypt.hash(password, 12);

      return await this.dataSource.transaction(async (manager) => {
        // Create user
        const user = manager.create(User, {
          email,
          passwordHash,
          firstName,
          lastName,
          isVerified: false,
        });
        const savedUser = await manager.save(user);

        // Create wallet
        const wallet = manager.create(Wallet, { userId: savedUser.id });
        const savedWallet = await manager.save(wallet);

        // Create initial NGN balance at 0
        const balance = manager.create(WalletBalance, {
          walletId: savedWallet.id,
          currency: 'NGN',
          balance: '0',
          lockedBalance: '0',
        });
        await manager.save(balance);

        return savedUser;
      });
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`Failed to create user ${email}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not create account. Please try again.');
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  async findByIdOrFail(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  async markVerified(userId: string): Promise<void> {
    try {
      await this.userRepo.update(userId, { isVerified: true });
    } catch (err) {
      this.logger.error(`Failed to mark user ${userId} as verified: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not verify account. Please try again.');
    }
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, user.passwordHash);
    } catch (err) {
      this.logger.error(`Password validation error for ${user.email}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Authentication error. Please try again.');
    }
  }

  async setActive(userId: string, isActive: boolean): Promise<void> {
    try {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found.');
      await this.userRepo.update(userId, { isActive });
    } catch (err) {
      if ((err as any).status) throw err;
      this.logger.error(`Failed to update status for user ${userId}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not update user status.');
    }
  }

  async findAll(): Promise<User[]> {
    try {
      return await this.userRepo.find({ order: { createdAt: 'DESC' } });
    } catch (err) {
      this.logger.error(`Failed to fetch users: ${(err as Error).message}`);
      throw new InternalServerErrorException('Could not retrieve users.');
    }
  }
}
