import { pino } from "pino";
import { env } from "@bakulan/config";

export const logger = pino({ level: env.LOG_LEVEL, base: { service: "ai-worker" } });
