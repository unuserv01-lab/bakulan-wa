export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const randomBetween = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/** messageTimestamp Baileys bisa number atau objek Long (protobuf). */
export function toSeconds(ts: unknown): number {
  if (typeof ts === "number") return ts;
  if (ts && typeof (ts as { toNumber?: () => number }).toNumber === "function") {
    return (ts as { toNumber: () => number }).toNumber();
  }
  return 0;
}
