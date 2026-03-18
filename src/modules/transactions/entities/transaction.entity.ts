import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum TransactionType {
  FUND = 'FUND',
  CONVERT = 'CONVERT',
  TRADE = 'TRADE',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum TradeDirection {
  BUY = 'BUY',   // User buys foreign currency with NGN
  SELL = 'SELL', // User sells foreign currency for NGN
}

@Entity('transactions')
@Index(['userId', 'createdAt'])
@Index(['idempotencyKey'], { unique: true, sparse: true })
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ type: 'enum', enum: TradeDirection, nullable: true })
  tradeDirection: TradeDirection | null;

  @Column({ length: 3 })
  fromCurrency: string;

  @Column({ length: 3 })
  toCurrency: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  fromAmount: string;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  toAmount: string;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  midRate: string; // Mid-market rate from provider

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  effectiveRate: string; // Rate actually applied (midRate for convert, bid/ask for trade)

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  spread: string; // Absolute spread: effectiveRate - midRate

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  spreadPct: string; // e.g. 0.005 = 0.5%

  @Column({ type: 'decimal', precision: 20, scale: 8, default: '0' })
  fee: string; // Flat fee charged (0 for MVP)

  @Column({ nullable: true, unique: false })
  idempotencyKey: string; // Client-provided UUID for deduplication

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
