import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { Wallet } from './wallet.entity';

@Entity('wallet_balances')
@Unique(['walletId', 'currency'])
@Index(['walletId'])
export class WalletBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  walletId: string;

  @Column({ length: 3 })
  currency: string; // ISO 4217 e.g. NGN, USD, EUR

  @Column({ type: 'decimal', precision: 20, scale: 8, default: '0' })
  balance: string; // stored as string to preserve precision (use Decimal.js for math)

  @Column({ type: 'decimal', precision: 20, scale: 8, default: '0' })
  lockedBalance: string; // reserved for pending operations

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'walletId' })
  wallet: Wallet;
}
