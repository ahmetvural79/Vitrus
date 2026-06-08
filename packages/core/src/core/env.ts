// src/core/env.ts
// Marka geçişi geriye-uyumu (GlassBox/Vitrus → Vitrus): kod artık VITRUS_* env adlarını okur; eski
// GLASSBOX_*/LUCIDEX_* adları HÂLÂ çalışsın diye normalize eder — VITRUS_X tanımlı değilse karşılık gelen
// GLASSBOX_X / LUCIDEX_X değerini ona kopyalar. Böylece eski .env'ler kırılmadan çalışmaya devam eder.

export function normalizeEnv(
  env: Record<string, string | undefined> = process.env
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  for (const [k, v] of Object.entries(env)) {
    if (v == null) continue;
    const m = /^(GLASSBOX|LUCIDEX)_(.+)$/.exec(k);
    if (!m) continue;
    const canonical = `VITRUS_${m[2]}`;
    if (out[canonical] == null) out[canonical] = v;
  }
  return out;
}
