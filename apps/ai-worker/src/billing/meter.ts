// Fungsi murni (tanpa env/DB) supaya mudah dites.

export interface Pricing {
  /** Harga modal per 1 juta token input (USD). */
  inUsdPerM: number;
  /** Harga modal per 1 juta token output (USD). */
  outUsdPerM: number;
  usdIdr: number;
  /** Pengali margin: tenant ditagih modal x margin. */
  margin: number;
}

/** Biaya yang ditagihkan ke tenant, dalam rupiah, dibulatkan 2 desimal. */
export function computeCostIDR(usage: { promptTokens: number; completionTokens: number }, p: Pricing): number {
  const usd = (usage.promptTokens * p.inUsdPerM + usage.completionTokens * p.outUsdPerM) / 1_000_000;
  const idr = usd * p.usdIdr * p.margin;
  return Math.round(idr * 100) / 100;
}
