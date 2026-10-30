import type { AIProviderName, AIRouterMessage, AIRouterResponse } from "@bakulan/shared-types";

// DeepSeek dan Qwen (Dashscope compatible-mode) sama-sama memakai format OpenAI chat completions,
// jadi satu adapter cukup. Menambah provider baru = tambah satu ProviderConfig.

export interface ProviderConfig {
  name: AIProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

// Cadangan kalau provider tidak mengirim blok usage (estimasi kasar untuk teks Indonesia).
const estimateTokens = (text: string) => Math.ceil(text.length / 3);

const REQUEST_TIMEOUT_MS = 25_000;

export async function complete(
  cfg: ProviderConfig,
  messages: AIRouterMessage[],
  opts: { maxTokens: number; temperature?: number },
): Promise<AIRouterResponse> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature ?? 0.6,
      stream: false,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    // Potong body error; jangan pernah ikut mencetak header (berisi API key).
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`${cfg.name} HTTP ${res.status}: ${detail}`);
  }

  const json = (await res.json()) as ChatCompletionResponse;
  const text = json.choices?.[0]?.message?.content?.trim() ?? "";
  return {
    text,
    promptTokens: json.usage?.prompt_tokens ?? estimateTokens(messages.map((m) => m.content).join("\n")),
    completionTokens: json.usage?.completion_tokens ?? estimateTokens(text),
    provider: cfg.name,
  };
}
