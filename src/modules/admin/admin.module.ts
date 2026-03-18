import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { FxModule } from '../fx/fx.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [UsersModule, FxModule, TransactionsModule],
  controllers: [AdminController],
})
export class AdminModule {}
