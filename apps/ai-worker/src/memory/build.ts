import { PERSONA_GUARDRAILS, type AIRouterMessage } from "@bakulan/shared-types";

export interface HistoryItem {
  direction: "in" | "out";
  content: string;
}

/**
 * Menyusun pesan untuk LLM: system prompt persona + aturan tetap, lalu riwayat percakapan
 * (pelanggan = user, bot/pemilik = assistant). Pesan berurutan dari peran yang sama digabung
 * (pelanggan sering mengirim beberapa pesan beruntun; sebagian provider menolak peran berulang).
 */
export function buildMessages(systemPrompt: string, history: HistoryItem[]): AIRouterMessage[] {
  const out: AIRouterMessage[] = [{ role: "system", content: systemPrompt.trim() + PERSONA_GUARDRAILS }];

  for (const item of history) {
    const role = item.direction === "in" ? "user" : "assistant";
    const last = out[out.length - 1]!;
    if (last.role === role && out.length > 1) last.content += `\n${item.content}`;
    else out.push({ role, content: item.content });
  }

  // Jendela riwayat bisa dimulai dari balasan bot; percakapan harus dibuka oleh pelanggan.
  while (out[1]?.role === "assistant") out.splice(1, 1);
  return out;
}
