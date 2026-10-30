import { Prisma } from "@prisma/client";
import { prisma } from "./client.js";

type Tx = Prisma.TransactionClient;
export type DecimalInput = string | number | Prisma.Decimal;

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly balance: string,
    public readonly needed: string,
  ) {
    super(`Insufficient balance: have ${balance}, need ${needed}`);
    this.name = "InsufficientBalanceError";
  }
}

/**
 * Kunci baris saldo tenant selama transaksi berjalan. Debit/kredit paralel untuk tenant
 * yang sama antre di sini, jadi dua pesan yang diproses bersamaan tidak bisa
 * membelanjakan rupiah yang sama dua kali.
 */
async function lockBalance(tx: Tx, tenantId: string): Promise<Prisma.Decimal> {
  await tx.$executeRaw`
    INSERT INTO wallet_balances (tenant_id, balance, updated_at)
    VALUES (${tenantId}, 0, NOW())
    ON CONFLICT (tenant_id) DO NOTHING`;
  const rows = await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`
    SELECT balance FROM wallet_balances WHERE tenant_id = ${tenantId} FOR UPDATE`;
  return new Prisma.Decimal(rows[0]!.balance);
}

export async function getBalance(tenantId: string): Promise<Prisma.Decimal> {
  const row = await prisma.walletBalance.findUnique({ where: { tenantId } });
  return row?.balance ?? new Prisma.Decimal(0);
}

export async function hasLedgerEntry(type: "topup" | "debit" | "refund", referenceId: string): Promise<boolean> {
  const row = await prisma.walletLedger.findFirst({ where: { type, referenceId }, select: { id: true } });
  return row !== null;
}

/**
 * Kredit saldo (topup/refund). Idempoten pada (type, referenceId): webhook Midtrans yang
 * dikirim ulang tidak akan menambah saldo dua kali.
 */
export async function creditWallet(params: {
  tenantId: string;
  amount: DecimalInput;
  type: "topup" | "refund";
  referenceId: string;
}): Promise<{ credited: boolean; balanceAfter: Prisma.Decimal }> {
  const amount = new Prisma.Decimal(params.amount);
  if (amount.lte(0)) throw new Error("Credit amount must be positive");

  return prisma.$transaction(async (tx) => {
    const current = await lockBalance(tx, params.tenantId);

    // Cek duplikat SETELAH lock, supaya dua webhook paralel tidak sama-sama lolos cek.
    const dup = await tx.walletLedger.findFirst({
      where: { type: params.type, referenceId: params.referenceId },
    });
    if (dup) return { credited: false, balanceAfter: current };

    const next = current.add(amount);
    await tx.walletBalance.update({ where: { tenantId: params.tenantId }, data: { balance: next } });
    await tx.walletLedger.create({
      data: {
        tenantId: params.tenantId,
        type: params.type,
        amount,
        balanceAfter: next,
        referenceId: params.referenceId,
      },
    });
    return { credited: true, balanceAfter: next };
  });
}

/**
 * Debit untuk pemakaian AI. Saldo tidak pernah negatif.
 * - allowPartial=false: lempar InsufficientBalanceError kalau saldo kurang.
 * - allowPartial=true : debit sebanyak saldo yang ada (biaya baru diketahui setelah panggilan AI,
 *   jadi saldo bisa menipis karena pesan paralel; selisihnya jadi risiko kita, bukan saldo minus).
 * Idempoten pada referenceId: job yang di-retry tidak menagih dua kali.
 */
export async function debitWallet(params: {
  tenantId: string;
  amount: DecimalInput;
  referenceId: string;
  allowPartial?: boolean;
}): Promise<{ debited: Prisma.Decimal; shortfall: Prisma.Decimal; balanceAfter: Prisma.Decimal; duplicate: boolean }> {
  const amount = new Prisma.Decimal(params.amount);
  if (amount.lt(0)) throw new Error("Debit amount must be non-negative");

  return prisma.$transaction(async (tx) => {
    const current = await lockBalance(tx, params.tenantId);

    const dup = await tx.walletLedger.findFirst({
      where: { type: "debit", referenceId: params.referenceId },
    });
    if (dup) {
      return { debited: dup.amount, shortfall: new Prisma.Decimal(0), balanceAfter: current, duplicate: true };
    }

    let toDebit = amount;
    let shortfall = new Prisma.Decimal(0);
    if (current.lt(amount)) {
      if (!params.allowPartial) throw new InsufficientBalanceError(current.toString(), amount.toString());
      toDebit = current;
      shortfall = amount.sub(current);
    }

    const next = current.sub(toDebit);
    await tx.walletBalance.update({ where: { tenantId: params.tenantId }, data: { balance: next } });
    await tx.walletLedger.create({
      data: {
        tenantId: params.tenantId,
        type: "debit",
        amount: toDebit,
        balanceAfter: next,
        referenceId: params.referenceId,
      },
    });
    return { debited: toDebit, shortfall, balanceAfter: next, duplicate: false };
  });
}
