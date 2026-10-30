import { describe, expect, it } from "vitest";
import { PERSONA_GUARDRAILS } from "@bakulan/shared-types";
import { buildMessages } from "./build.js";

describe("buildMessages", () => {
  it("menempelkan guardrail ke system prompt", () => {
    const [system] = buildMessages("Kamu admin toko.", [{ direction: "in", content: "halo" }]);
    expect(system!.role).toBe("system");
    expect(system!.content.startsWith("Kamu admin toko.")).toBe(true);
    expect(system!.content.endsWith(PERSONA_GUARDRAILS)).toBe(true);
  });

  it("memetakan in->user dan out->assistant", () => {
    const msgs = buildMessages("sys", [
      { direction: "in", content: "ada tas?" },
      { direction: "out", content: "ada kak" },
      { direction: "in", content: "harga?" },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("menggabungkan pesan pelanggan beruntun", () => {
    const msgs = buildMessages("sys", [
      { direction: "in", content: "halo" },
      { direction: "in", content: "ada tas coklat?" },
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.content).toBe("halo\nada tas coklat?");
  });

  it("membuang balasan bot di awal jendela riwayat", () => {
    const msgs = buildMessages("sys", [
      { direction: "out", content: "balasan lama" },
      { direction: "in", content: "pertanyaan baru" },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("riwayat kosong hanya berisi system prompt", () => {
    expect(buildMessages("sys", [])).toHaveLength(1);
  });
});
