import * as Joi from 'joi';

export const validationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  // JWT
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),

  // Mailer
  GMAIL_USER: Joi.string().email().required(),
  GMAIL_APP_PASSWORD: Joi.string().required(),

  // FX
  FX_API_KEY: Joi.string().required(),
  FX_API_BASE_URL: Joi.string()
    .uri()
    .default('https://v6.exchangerate-api.com/v6'),
  FX_CACHE_TTL_SECONDS: Joi.number().default(300),
  SUPPORTED_CURRENCIES: Joi.string().default('USD,EUR,GBP,CAD,JPY'),

  // Trade
  TRADE_SPREAD_PCT: Joi.number().min(0).max(0.1).default(0.005),
  INITIAL_NGN_BALANCE: Joi.number().min(0).default(0),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  // Throttle
  THROTTLE_TTL_SHORT: Joi.number().default(1000),
  THROTTLE_LIMIT_SHORT: Joi.number().default(5),
  THROTTLE_TTL_MEDIUM: Joi.number().default(60000),
  THROTTLE_LIMIT_MEDIUM: Joi.number().default(100),
});
