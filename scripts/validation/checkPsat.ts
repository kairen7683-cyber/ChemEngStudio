// Verifies PSAT_DIPPR101: normal boiling point (±0.5 K) and a second literature Psat point.
// Run: npx.cmd tsx scripts/validation/checkPsat.ts
import { PSAT_DIPPR101, dippr101Pa } from '../../lib/calculations/data/pureComponentDatabank';
import type { SimCompKey } from '../../lib/calculations/flowsheetSolver';

// Reference: [Tb (K) at 101.325 kPa, T2 (K), Psat(T2) kPa, source]
const REF: Partial<Record<SimCompKey, [number, number, number, string]>> = {
  H2O: [373.124, 298.15, 3.1699, 'IAPWS-95'],
  MeOH: [337.69, 298.15, 16.94, 'NIST WebBook / CRC'],
  EtOH: [351.44, 298.15, 7.87, 'NIST WebBook / CRC'],
  IPA: [355.39, 298.15, 6.05, 'CRC Handbook'],
  Acetone: [329.22, 298.15, 30.8, 'CRC Handbook'],
  AceticAcid: [391.05, 298.15, 2.07, 'CRC Handbook'],
  EtOAc: [350.26, 298.15, 12.6, 'CRC Handbook'],
  CHCl3: [334.33, 298.15, 26.2, 'CRC Handbook'],
  Benzene: [353.24, 298.15, 12.69, 'CRC Handbook'],
  Toluene: [383.78, 298.15, 3.79, 'CRC Handbook'],
  pXylene: [411.51, 298.15, 1.19, 'CRC Handbook'],
  nC6H14: [341.88, 298.15, 20.2, 'CRC Handbook'],
  nC7H16: [371.58, 298.15, 6.09, 'CRC Handbook'],
  CH4: [111.67, 150.0, 1041.0, 'NIST WebBook (Setzmann-Wagner)'],
  C2H6: [184.57, 250.0, 1301.0, 'NIST WebBook'],
  C2H4: [169.38, 250.0, 2335.0, 'NIST WebBook (approx.)'],
  C3H8: [231.04, 298.15, 952.0, 'NIST WebBook'],
  C3H6: [225.46, 298.15, 1155.0, 'NIST WebBook'],
  nC4H10: [272.66, 298.15, 243.0, 'NIST WebBook'],
  NH3: [239.82, 298.15, 1003.0, 'NIST WebBook'],
  H2: [20.37, 30.0, 803.0, 'NIST WebBook (normal H2)'],
  N2: [77.35, 100.0, 778.0, 'NIST WebBook'],
  O2: [90.19, 120.0, 1022.0, 'NIST WebBook'],
  CO: [81.64, 100.0, 540.0, 'NIST WebBook (approx.)'],
  Cl2: [239.11, 298.15, 777.0, 'CRC Handbook'],
  HCl: [188.15, 298.15, 4730.0, 'CRC Handbook'],
  CO2: [216.58, 298.15, 6434.0, 'NIST (T1 = triple point, P = 517.95 kPa)'],
  Glycerol: [561.0, 500.0, 16.05, 'CRC Tb (decomp.); 2nd point Cammenga et al. (1977) / Perry DIPPR-801'],
};

function tbFromModel(c: SimCompKey, Ptarget: number): number {
  const e = PSAT_DIPPR101[c]!;
  let lo = e.TminK;
  let hi = e.TmaxK;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (dippr101Pa(c, mid, false) > Ptarget) hi = mid; else lo = mid;
  }
  return 0.5 * (lo + hi);
}

let fails = 0;
const rows: string[] = [];
for (const c of Object.keys(PSAT_DIPPR101) as SimCompKey[]) {
  const ref = REF[c];
  if (!ref) { rows.push(`${c.padEnd(10)} (no reference)`); continue; }
  const [tb, t2, p2, src] = ref;
  const isCO2 = c === 'CO2';
  const tbModel = tbFromModel(c, isCO2 ? 517950 : 101325);
  const p2Model = dippr101Pa(c, t2, false) / 1000;
  const dTb = tbModel - tb;
  const dP2 = (p2Model / p2 - 1) * 100;
  const ok = Math.abs(dTb) <= 0.5 && Math.abs(dP2) <= 3.0;
  if (!ok) fails++;
  rows.push(`${c.padEnd(10)} Tb_ref=${tb.toFixed(2)} Tb_mod=${tbModel.toFixed(2)} dTb=${dTb.toFixed(2)}K | P(${t2})ref=${p2} mod=${p2Model.toFixed(3)} dev=${dP2.toFixed(2)}% ${ok ? 'OK' : 'FAIL'}  [${src}]`);
}
console.log(rows.join('\n'));
console.log(`\nFAILS: ${fails}`);
