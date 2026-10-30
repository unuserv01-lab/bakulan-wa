import { prisma } from "@bakulan/db";
import type { HistoryItem } from "./build.js";

/** N pesan terakhir dari satu percakapan (per kontak), urut dari yang terlama. */
export async function loadHistory(waSessionId: string, contactJid: string, limit: number): Promise<HistoryItem[]> {
  const rows = await prisma.message.findMany({
    where: { waSessionId, contactJid },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { direction: true, content: true },
  });
  return rows.reverse();
}
