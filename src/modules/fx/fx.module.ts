import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { FxRateHistory } from './entities/fx-rate-history.entity';
import { FxService } from './fx.service';
import { FxController } from './fx.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([FxRateHistory]),
    HttpModule,
    ConfigModule,
  ],
  providers: [FxService],
  controllers: [FxController],
  exports: [FxService],
})
export class FxModule {}
