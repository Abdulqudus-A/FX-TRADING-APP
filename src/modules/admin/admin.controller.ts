import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { FxService } from '../fx/fx.service';
import { TransactionsService } from '../transactions/transactions.service';
import { RateOverrideDto } from './dto/rate-override.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Roles([UserRole.ADMIN])
@Controller('admin')
export class AdminController {
  constructor(
    private readonly usersService: UsersService,
    private readonly fxService: FxService,
    private readonly txService: TransactionsService,
  ) {}

  @Get('users')
  @ApiOperation({ summary: '[Admin] List all users' })
  @ApiResponse({ status: 200 })
  getAllUsers() {
    return this.usersService.findAll();
  }

  @Patch('users/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Activate or deactivate a user account' })
  async updateUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    await this.usersService.setActive(id, dto.isActive ?? true);
    return { message: `User ${id} status updated.` };
  }

  @Post('fx/rate-override')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Manually override an FX rate (stored in history)' })
  async overrideRate(@Body() dto: RateOverrideDto) {
    const entry = await this.fxService.saveAdminOverrideRate(
      dto.fromCurrency,
      dto.toCurrency,
      dto.rate,
    );
    return { message: 'Rate override recorded.', entry };
  }

  @Get('transactions')
  @ApiOperation({ summary: '[Admin] View all transactions (paginated)' })
  getAllTransactions(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('currency') currency?: string,
  ) {
    return this.txService.findAllForAdmin({
      page: Number(page),
      limit: Number(limit),
      currency,
    });
  }
}
