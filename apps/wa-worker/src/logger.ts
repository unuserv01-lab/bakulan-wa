import { pino } from "pino";
import { env } from "@bakulan/config";

export const logger = pino({ level: env.LOG_LEVEL, base: { service: "wa-worker" } });

// Baileys sangat berisik di level info/debug — cukup warn ke atas.
export const baileysLogger = logger.child({ module: "baileys" }, { level: "warn" });
