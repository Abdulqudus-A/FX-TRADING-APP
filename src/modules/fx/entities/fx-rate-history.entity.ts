import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('fx_rate_history')
@Index(['fromCurrency', 'toCurrency', 'createdAt'])
export class FxRateHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 3 })
  fromCurrency: string;

  @Column({ length: 3 })
  toCurrency: string;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  rate: string; // Mid-market rate

  @Column({ length: 50, nullable: true })
  source: string; // 'provider' | 'admin_override'

  @CreateDateColumn()
  createdAt: Date;
}
