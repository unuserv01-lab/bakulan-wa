import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Dev: cari .env dengan naik dari cwd (jadi `npm run dev` dari folder app mana pun tetap ketemu .env root).
// Prod/Docker: env sudah di-inject; dotenv tidak menimpa variabel yang sudah ada.
function findEnvFile(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const envFile = findEnvFile(process.cwd());
if (envFile) loadDotenv({ path: envFile });

// z.coerce.boolean() menganggap string "false" sebagai true — jangan dipakai untuk env.
const boolish = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const sessionKey = z
  .string()
  .refine(
    (v) => Buffer.from(v, "base64").length === 32,
    "SESSION_ENCRYPTION_KEY harus 32 byte base64 (openssl rand -base64 32)",
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET minimal 32 karakter"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  SESSION_ENCRYPTION_KEY: sessionKey,

  AI_DEFAULT_PROVIDER: z.enum(["deepseek", "qwen"]).default("deepseek"),
  DEEPSEEK_API_KEY: z.string().default(""),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  DEEPSEEK_PRICE_IN_USD_PER_M: z.coerce.number().nonnegative().default(0.28),
  DEEPSEEK_PRICE_OUT_USD_PER_M: z.coerce.number().nonnegative().default(0.42),
  DASHSCOPE_API_KEY: z.string().default(""),
  DASHSCOPE_BASE_URL: z.string().default("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
  QWEN_MODEL: z.string().default("qwen-plus"),
  QWEN_PRICE_IN_USD_PER_M: z.coerce.number().nonnegative().default(0.4),
  QWEN_PRICE_OUT_USD_PER_M: z.coerce.number().nonnegative().default(1.2),
  AI_USD_IDR_RATE: z.coerce.number().positive().default(17900),
  AI_BILLING_MARGIN_MULTIPLIER: z.coerce.number().min(1).default(1.75),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(400),

  MEMORY_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
  MIN_BALANCE_TO_REPLY_IDR: z.coerce.number().nonnegative().default(50),
  MAX_MESSAGE_AGE_SECONDS: z.coerce.number().int().positive().default(600),
  HANDOVER_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  MIDTRANS_SERVER_KEY: z.string().default(""),
  MIDTRANS_CLIENT_KEY: z.string().default(""),
  MIDTRANS_IS_PRODUCTION: boolish,
  TOPUP_MIN_IDR: z.coerce.number().int().positive().default(10000),
  TOPUP_MAX_IDR: z.coerce.number().int().positive().default(5000000),

  ALERT_TELEGRAM_BOT_TOKEN: z.string().default(""),
  ALERT_TELEGRAM_CHAT_ID: z.string().default(""),

  API_PORT: z.coerce.number().int().default(3001),
  WA_WORKER_HEALTH_PORT: z.coerce.number().int().default(3002),
  AI_WORKER_HEALTH_PORT: z.coerce.number().int().default(3003),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Environment variable tidak valid:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  throw new Error("Invalid environment variables — lihat detail di atas");
}

export const env = parsed.data;
export type Env = typeof env;
