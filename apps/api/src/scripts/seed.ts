// Membuat akun demo + saldo uji, idempoten. Jalankan: npm run db:seed
import { randomBytes } from "node:crypto";
import { creditWallet, prisma } from "@bakulan/db";
import { registerUser } from "../modules/auth/service.js";

const DEMO_EMAIL = "demo@bakulan.test";

const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
if (existing) {
  console.log(`Akun demo sudah ada (${DEMO_EMAIL}) — tidak ada yang diubah.`);
} else {
  const password = randomBytes(9).toString("base64url");
  const { tenant } = await registerUser({ email: DEMO_EMAIL, password, businessName: "Warung Demo" });
  await creditWallet({ tenantId: tenant.id, amount: 50_000, type: "topup", referenceId: `seed-${tenant.id}` });
  console.log("Akun demo dibuat:");
  console.log(`  email    : ${DEMO_EMAIL}`);
  console.log(`  password : ${password}   (tampil sekali ini saja)`);
  console.log("  saldo    : Rp50.000 (saldo uji, bukan uang asli)");
}

await prisma.$disconnect();
