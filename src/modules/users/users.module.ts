import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { Wallet } from '../wallet/entities/wallet.entity';
import { WalletBalance } from '../wallet/entities/wallet-balance.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Wallet, WalletBalance])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
