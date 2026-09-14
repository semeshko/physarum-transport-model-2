import { createSensitivityReport } from "../src/physarum/sensitivity";

const started=performance.now(); const report=createSensitivityReport(); const elapsed=performance.now()-started;
console.log("Physarum sensitivity calibration (Hill-Euler v1)");
console.table(report.observations.map((item)=>({experiment:item.label,converged:item.convergence.converged,iterations:item.convergence.iterations,cheapShare:Number((item.flow.shares.cheap??item.flow.dominantShare).toFixed(6)),entropy:Number(item.flow.normalizedEntropy.toFixed(6)),activeFraction:Number(item.activeEdgeFraction.toFixed(3)),maxDeltaD:item.convergence.maxDeltaD.toExponential(2),kirchhoff:item.convergence.kirchhoffResidual.toExponential(2)})));
console.log(`observations=${report.observations.length} elapsedMs=${elapsed.toFixed(2)} deterministicReportRuntime=null`);
