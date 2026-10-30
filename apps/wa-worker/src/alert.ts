import { env } from "@bakulan/config";
import { logger } from "./logger.js";

/** Alert operasional ke kamu (bukan ke tenant). Tanpa konfigurasi Telegram, cukup masuk log. */
export async function sendAlert(text: string): Promise<void> {
  logger.error({ alert: true }, text);
  if (!env.ALERT_TELEGRAM_BOT_TOKEN || !env.ALERT_TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.ALERT_TELEGRAM_CHAT_ID, text: `[Bakulan WA] ${text}` }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.warn({ err }, "gagal mengirim alert Telegram");
  }
}
