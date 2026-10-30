import { env } from "@bakulan/config";
import { AI_PROVIDERS, type AIProviderName, type AIRouterMessage, type AIRouterResponse } from "@bakulan/shared-types";
import { complete, type ProviderConfig } from "./openaiCompat.js";
import type { Pricing } from "../billing/meter.js";

function providerConfig(name: AIProviderName): ProviderConfig | undefined {
  if (name === "deepseek") {
    return env.DEEPSEEK_API_KEY
      ? { name, baseUrl: env.DEEPSEEK_BASE_URL, apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL }
      : undefined;
  }
  return env.DASHSCOPE_API_KEY
    ? { name, baseUrl: env.DASHSCOPE_BASE_URL, apiKey: env.DASHSCOPE_API_KEY, model: env.QWEN_MODEL }
    : undefined;
}

export function pricingFor(name: AIProviderName): Pricing {
  return {
    inUsdPerM: name === "deepseek" ? env.DEEPSEEK_PRICE_IN_USD_PER_M : env.QWEN_PRICE_IN_USD_PER_M,
    outUsdPerM: name === "deepseek" ? env.DEEPSEEK_PRICE_OUT_USD_PER_M : env.QWEN_PRICE_OUT_USD_PER_M,
    usdIdr: env.AI_USD_IDR_RATE,
    margin: env.AI_BILLING_MARGIN_MULTIPLIER,
  };
}

const isProvider = (v: string | undefined): v is AIProviderName => AI_PROVIDERS.includes(v as AIProviderName);

/**
 * Satu-satunya pintu ke LLM. Urutan: provider pilihan persona -> default env -> sisanya.
 * Hanya provider yang API key-nya terisi yang dicoba; kalau yang pertama gagal, lanjut ke berikutnya.
 */
export async function route(preferred: string | undefined, messages: AIRouterMessage[]): Promise<AIRouterResponse> {
  const order: AIProviderName[] = [];
  const add = (n: AIProviderName) => {
    if (!order.includes(n)) order.push(n);
  };
  if (isProvider(preferred)) add(preferred);
  add(env.AI_DEFAULT_PROVIDER);
  for (const n of AI_PROVIDERS) add(n);

  const candidates = order.map(providerConfig).filter((c): c is ProviderConfig => c !== undefined);
  if (candidates.length === 0) throw new Error("Tidak ada AI provider yang dikonfigurasi (isi API key di .env)");

  let lastError: unknown;
  for (const cfg of candidates) {
    try {
      return await complete(cfg, messages, { maxTokens: env.AI_MAX_OUTPUT_TOKENS });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
