import { createBranchingNetwork, createChainNetwork, createGridNetwork } from "../src/benchmarks/networks";
import { assemblePressureSystem, solveHydraulics } from "../src/physarum/hydraulics";
import { solveConjugateGradient } from "../src/physarum/pressure-solver";
import { initializePhysarum, stepPhysarum } from "../src/physarum/solver";

const cases = [
  ...[100, 250, 500, 1000, 2000].map((size) => createChainNetwork(size)),
  ...[[10, 10], [16, 16], [22, 22], [32, 32], [45, 45]].map(([rows, columns]) => createGridNetwork(rows, columns)),
  ...[7, 8, 9, 10, 11].map((levels) => createBranchingNetwork(levels)),
];

for (const network of cases) {
  const conductivities = Object.fromEntries(network.edges.map((edge) => [edge.graphEdgeId, 1]));
  const memoryBefore = process.memoryUsage().heapUsed;
  const assemblyStarted = performance.now();
  const assembled = assemblePressureSystem(network, conductivities);
  const assemblyMs = performance.now() - assemblyStarted;
  const linearStarted = performance.now();
  const linear = solveConjugateGradient(assembled.sparseSystem);
  const linearSolveMs = performance.now() - linearStarted;
  const initialized = initializePhysarum(network, { maxIterations: 10 });
  const stepStarted = performance.now();
  const oneStepSimulation = stepPhysarum(network, initialized);
  const stepMs = performance.now() - stepStarted;
  let simulation = oneStepSimulation;
  const multiStarted = performance.now();
  if (network.nodes.length <= 500) for (let iteration = 1; iteration < 10 && simulation.state.terminationReason === null; iteration += 1) simulation = stepPhysarum(network, simulation);
  const tenStepMs = network.nodes.length <= 500 ? performance.now() - multiStarted + stepMs : null;
  const memoryDeltaMb = (process.memoryUsage().heapUsed - memoryBefore) / 1024 / 1024;
  const denseStarted = performance.now();
  if (network.nodes.length <= 250) solveHydraulics(network, conductivities, { method: "dense" });
  const denseSolveMs = network.nodes.length <= 250 ? performance.now() - denseStarted : null;
  console.info(JSON.stringify({ phase: "sparse-result", graph: network.graphId, nodes: network.nodes.length, edges: network.edges.length, assemblyMs: Number(assemblyMs.toFixed(2)), linearSolveMs: Number(linearSolveMs.toFixed(2)), linearIterations: linear.diagnostics.iterations, oneStepMs: Number(stepMs.toFixed(2)), stepLinearIterations: oneStepSimulation.state.diagnostics.linearSolve?.iterations ?? null, tenStepMs: tenStepMs === null ? null : Number(tenStepMs.toFixed(2)), tenStepTermination: network.nodes.length <= 500 ? simulation.state.terminationReason : null, denseSolveMs: denseSolveMs === null ? null : Number(denseSolveMs.toFixed(2)), heapDeltaMb: Number(memoryDeltaMb.toFixed(2)) }));
}
