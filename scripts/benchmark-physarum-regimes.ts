import { createSensitivityReport } from "../src/physarum/sensitivity";

// Task 17 regime benchmark: readable matrices for the n-transition study,
// the kappa study, and legacy-vs-normalized demand scaling - split out from
// the general sensitivity report so the scientifically load-bearing results
// aren't buried among the broader parameter sweep.

const report = createSensitivityReport();

function row(item: (typeof report.observations)[number]) {
  return {
    experiment: item.label,
    scaleMode: item.scaleMode,
    qRef: Number(item.qRef.toFixed(4)),
    effectiveK: Number(item.effectiveHillK.toFixed(4)),
    converged: item.convergence.converged,
    iterations: item.convergence.iterations,
    dominantShare: Number((item.flow.shares.cheap ?? item.flow.dominantShare).toFixed(6)),
    entropy: Number(item.flow.normalizedEntropy.toFixed(6)),
    concentration: Number(item.flow.concentration.toFixed(6)),
  };
}

console.log(`Physarum regime study (${report.modelVersion})`);

console.log("\n== N-regime fine transition sweep (n=1 distributed -> n>1 winner-takes-all), across 4 topologies ==");
console.table(report.observations.filter((item) => item.label.startsWith("n-fine:")).map(row));

console.log("\n== Kappa study at legacy selective n=2 (Analyze candidate) ==");
console.table(report.observations.filter((item) => item.label.startsWith("kappa:")).map(row));

console.log("\n== Kappa study at exploratory n=1.05 (Design candidate), across 4 topologies ==");
console.table(report.observations.filter((item) => item.label.startsWith("kappa-at-design-n:")).map(row));

console.log("\n== Legacy fixed-K vs demand-normalized K under uniform demand scaling ==");
console.table(
  report.observations
    .filter((item) => item.label.startsWith("demand:") || item.label.startsWith("demand-normalized:"))
    .map(row),
);

console.log(`\nobservations=${report.observations.length}`);
