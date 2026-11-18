import { solveFlowsheet } from '../../lib/calculations/flowsheetSolver';
import { createInitialHierarchySheets } from '../../lib/calculations/fullPlantHierarchy';
import { createInitialHcl1AHierarchySheets } from '../../lib/calculations/hcl1AHierarchy';
import { createInitialEchHierarchySheets } from '../../lib/calculations/echPlantHierarchy';
import { createInitialCmsHierarchySheets } from '../../lib/calculations/cmsPlantHierarchy';
import { createInitialMdiHierarchySheets } from '../../lib/calculations/mdiPlantHierarchy';

const all: Record<string, any> = {};
for (const [p, s] of [
  ['electrolysis', createInitialHierarchySheets()],
  ['hcl1A', createInitialHcl1AHierarchySheets()],
  ['ech', createInitialEchHierarchySheets()],
  ['cms', createInitialCmsHierarchySheets()],
  ['mdi', createInitialMdiHierarchySheets()],
] as const) {
  for (const [k, v] of Object.entries(s)) all[`${p}/${k}`] = v;
}
const ids = process.argv.slice(2);
for (const id of ids) {
  const sh = all[id];
  const r = solveFlowsheet(sh.simDefs, sh.flowEdges);
  const b = r.balance;
  console.log(`\n### ${id}  massImb=${b.massImbalanceKgH} E=${b.energyResidualKW} kW (${b.energyResidualPct}%)  feedH=${b.feedEnthalpyKW} prodH=${b.productEnthalpyKW} Q=${b.unitHeatDutyKW} W=${b.unitPowerKW}`);
  for (const u of b.unroutedOutlets) console.log(`  OUT ${u.tag} [${u.port}] ${u.label}: ${u.totalMassKgH} kg/h ${u.tempC}C ${u.compositionLabel}`);
  for (const u of b.makeupInlets) console.log(`  IN  ${u.tag} [${u.port}] ${u.label}: ${u.totalMassKgH} kg/h`);
  for (const u of b.unitEnergyResiduals) {
    const ur = r.units.find(x => x.nodeId === u.nodeId)!;
    console.log(`  E  ${u.tag} (${ur.unitType}) res=${u.residualKW} kW  Q=${(ur.externalHeatKcalH! / 859.845).toFixed(1)} kW W=${ur.shaftPowerKW}`);
  }
  for (const u of b.unitMassImbalances) console.log(`  M  ${u.tag} ${u.imbalanceKgH}`);
}
