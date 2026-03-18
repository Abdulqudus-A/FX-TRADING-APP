import { Reflector } from '@nestjs/core';
import { UserRole } from '../../modules/users/entities/user.entity';

export const Roles = Reflector.createDecorator<UserRole[]>();
