/**
 * Lightweight admin seed — connects directly to PostgreSQL via pg,
 * no full NestJS app boot (avoids FX API calls, Redis, SMTP init, etc.)
 */
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@fxtrading.dev';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345!';
const ADMIN_FIRST_NAME = 'Super';
const ADMIN_LAST_NAME = 'Admin';

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'fx_trading',
    entities: [resolve(__dirname, '../../**/*.entity{.ts,.js}')],
    synchronize: false,
    logging: false,
  });

  await ds.initialize();
  console.log('[AdminSeed] DB connected');

  try {
    const userRepo = ds.getRepository('users');
    const walletRepo = ds.getRepository('wallets');
    const balanceRepo = ds.getRepository('wallet_balances');

    const existing = await ds.query(
      `SELECT id, role FROM users WHERE email = $1 LIMIT 1`,
      [ADMIN_EMAIL],
    );

    if (existing.length > 0) {
      const { id, role } = existing[0];
      if (role === 'ADMIN') {
        console.log(`[AdminSeed] Admin already exists: ${ADMIN_EMAIL}`);
      } else {
        await ds.query(
          `UPDATE users SET role = 'ADMIN', "isVerified" = true WHERE id = $1`,
          [id],
        );
        console.log(`[AdminSeed] Promoted to admin: ${ADMIN_EMAIL}`);
      }
    } else {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

      // Insert user
      const [user] = await ds.query(
        `INSERT INTO users("firstName","lastName",email,"passwordHash",role,"isVerified","isActive")
         VALUES($1,$2,$3,$4,'ADMIN',true,true) RETURNING id`,
        [ADMIN_FIRST_NAME, ADMIN_LAST_NAME, ADMIN_EMAIL, passwordHash],
      );

      // Insert wallet
      const [wallet] = await ds.query(
        `INSERT INTO wallets("userId") VALUES($1) RETURNING id`,
        [user.id],
      );

      // Insert NGN balance of 0
      await ds.query(
        `INSERT INTO wallet_balances("walletId",currency,balance) VALUES($1,'NGN','0')`,
        [wallet.id],
      );

      console.log(`[AdminSeed] Admin created: ${ADMIN_EMAIL}`);
    }
  } finally {
    await ds.destroy();
    console.log('[AdminSeed] Done.');
  }
}

seed().catch((err) => {
  console.error('[AdminSeed] Failed:', err.message);
  process.exit(1);
});
