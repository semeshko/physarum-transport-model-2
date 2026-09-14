import type { PreparedEdge, PreparedNetwork } from "../scenario/types";
import { runPhysarum } from "./solver";
import { DEFAULT_PHYSARUM_PARAMETERS } from "./parameters";
import type { PhysarumParameters, PhysarumState } from "./types";

export const SENSITIVITY_MODEL_VERSION = "physarum-hill-euler-v1";
export const COST_RATIOS = [1, 1.005, 1.01, 1.025, 1.05, 1.075, 1.1, 1.15, 1.25, 1.5, 2, 3, 5] as const;
export const HILL_EXPONENTS = [1, 1.25, 1.5, 2, 3] as const;
export const HILL_K_VALUES = [0.1, 0.5, 1, 2, 5] as const;
export const TIME_STEPS = [0.025, 0.05, 0.1, 0.2, 0.4] as const;
export const INITIAL_CONDUCTIVITIES = [0.1, 0.5, 1, 2, 5] as const;
export const COST_SCALES = [1, 10, 100] as const;
export const DEMAND_MAGNITUDES = [0.1, 0.5, 1, 2, 5, 10] as const;
export type SensitivityFixtureId = "parallel" | "parallel-corridors" | "three-corridors" | "shared-trunk" | "grid" | "bottleneck";
export type CorridorDefinition = { readonly id: string; readonly edgeIds: readonly string[] };
export type SensitivityFixture = { readonly id: SensitivityFixtureId; readonly network: PreparedNetwork; readonly corridors: readonly CorridorDefinition[] };
export type DistributionMetrics = { readonly shares: Readonly<Record<string, number>>; readonly dominantShare: number; readonly normalizedEntropy: number; readonly concentration: number };
export type SensitivityObservation = { readonly label: string; readonly fixtureId: SensitivityFixtureId; readonly costs: readonly number[]; readonly sourceMagnitude: number; readonly parameters: PhysarumParameters; readonly convergence: { readonly converged: boolean; readonly reason: string | null; readonly iterations: number; readonly maxDeltaD: number; readonly kirchhoffResidual: number }; readonly flow: DistributionMetrics; readonly conductivity: DistributionMetrics; readonly activeEdgeFraction: number; readonly edgeFlows: Readonly<Record<string, number>>; readonly edgeConductivities: Readonly<Record<string, number>>; readonly runtimeMilliseconds: number | null };
export type PhysarumSensitivityReport = { readonly modelVersion: typeof SENSITIVITY_MODEL_VERSION; readonly equations: "g=D/L; Q=g*dP; dD/dt=alpha*Hill(|Q|)-mu*D; explicit-Euler"; readonly observations: readonly SensitivityObservation[] };

function edge(id: string, fromNodeId: string, toNodeId: string, cost: number): PreparedEdge { return { graphEdgeId: id, fromNodeId, toNodeId, lengthMeters: cost, profileCostSeconds: cost, penaltyMultiplier: 1, effectiveCost: cost }; }
function network(id: SensitivityFixtureId, nodes: readonly string[], edges: readonly PreparedEdge[], source = "s", sink = "t", magnitude = 1): PreparedNetwork { return { graphId: `sensitivity-${id}`, scenarioId: `sensitivity-${id}`, nodes: nodes.map((nodeId, index) => ({ id: nodeId, position: [index, 0] })), edges, terminals: [{ id: "source", role: "source", nodeId: source, magnitude }, { id: "sink", role: "sink", nodeId: sink, magnitude }], activeEdgeCount: edges.length, blockedEdgeCount: 0, sourceSinkConnected: true }; }
export function createSensitivityFixture(id: SensitivityFixtureId, ratio = 1.1, magnitude = 1, costScale = 1): SensitivityFixture {
  const c = (value: number) => value * costScale;
  if (id === "parallel") return { id, network: network(id, ["s","t"], [edge("cheap","s","t",c(1)), edge("alternative","s","t",c(ratio))], "s", "t", magnitude), corridors: [{ id:"cheap", edgeIds:["cheap"] }, { id:"alternative", edgeIds:["alternative"] }] };
  if (id === "parallel-corridors") return { id, network: network(id,["s","a","b","t"],[edge("cheap-1","s","a",c(1)),edge("cheap-2","a","t",c(1)),edge("alternative-1","s","b",c(ratio)),edge("alternative-2","b","t",c(ratio))],"s","t",magnitude), corridors:[{id:"cheap",edgeIds:["cheap-1","cheap-2"]},{id:"alternative",edgeIds:["alternative-1","alternative-2"]}] };
  if (id === "three-corridors") return { id, network: network(id,["s","a","b","c","t"],[edge("a1","s","a",c(1)),edge("a2","a","t",c(1)),edge("b1","s","b",c(ratio)),edge("b2","b","t",c(ratio)),edge("c1","s","c",c(ratio*1.1)),edge("c2","c","t",c(ratio*1.1))],"s","t",magnitude), corridors:[{id:"cheap",edgeIds:["a1","a2"]},{id:"middle",edgeIds:["b1","b2"]},{id:"costly",edgeIds:["c1","c2"]}] };
  if (id === "shared-trunk") return { id, network: network(id,["s","x","a","b","y","t"],[edge("trunk-in","s","x",c(1)),edge("a1","x","a",c(1)),edge("a2","a","y",c(1)),edge("b1","x","b",c(ratio)),edge("b2","b","y",c(ratio)),edge("trunk-out","y","t",c(1))],"s","t",magnitude), corridors:[{id:"cheap",edgeIds:["a1","a2"]},{id:"alternative",edgeIds:["b1","b2"]}] };
  if (id === "grid") return { id, network: network(id,["s","a","b","c","d","t"],[edge("sa","s","a",c(1)),edge("sb","s","b",c(1)),edge("ac","a","c",c(1)),edge("ad","a","d",c(ratio)),edge("bc","b","c",c(ratio)),edge("bd","b","d",c(1)),edge("ct","c","t",c(1)),edge("dt","d","t",c(1))],"s","t",magnitude), corridors:[{id:"upper",edgeIds:["sa","ac","ct"]},{id:"lower",edgeIds:["sb","bd","dt"]}] };
  return { id, network: network(id,["s","a","b","x","t"],[edge("a1","s","a",c(1)),edge("a2","a","x",c(1)),edge("b1","s","b",c(ratio)),edge("b2","b","x",c(ratio)),edge("bottleneck","x","t",c(1))],"s","t",magnitude), corridors:[{id:"cheap",edgeIds:["a1","a2"]},{id:"alternative",edgeIds:["b1","b2"]}] };
}
export function normalizedDistribution(values: Readonly<Record<string, number>>): DistributionMetrics {
  const entries = Object.entries(values).map(([id,value]) => [id, Math.abs(value)] as const); const total = entries.reduce((sum,[,value])=>sum+value,0); const shares = Object.fromEntries(entries.map(([id,value])=>[id,total ? value/total : 0])); const probabilities = Object.values(shares); const entropy = probabilities.reduce((sum,p)=>p>0?sum-p*Math.log(p):sum,0); const normalizedEntropy = probabilities.length > 1 ? entropy/Math.log(probabilities.length) : probabilities.length ? 0 : 0; return { shares, dominantShare: Math.max(0,...probabilities), normalizedEntropy, concentration: 1-normalizedEntropy };
}
function corridorValues(state: PhysarumState, corridors: readonly CorridorDefinition[], kind: "flow"|"conductivity"): Record<string,number> { const source = kind === "flow" ? state.edgeFlows : state.edgeConductivities; return Object.fromEntries(corridors.map((corridor)=>[corridor.id,corridor.edgeIds.reduce((sum,id)=>sum+Math.abs(source[id]??0),0)/corridor.edgeIds.length])); }
export function observeSensitivity(fixture: SensitivityFixture, overrides: Partial<PhysarumParameters> = {}, label: string = fixture.id): SensitivityObservation {
  const parameters = { ...DEFAULT_PHYSARUM_PARAMETERS, ...overrides }; const before = JSON.stringify(fixture.network); const state = runPhysarum(fixture.network, overrides); if (JSON.stringify(fixture.network)!==before) throw new Error("Physarum sensitivity run mutated PreparedNetwork.");
  const flow = normalizedDistribution(corridorValues(state,fixture.corridors,"flow")), conductivity = normalizedDistribution(corridorValues(state,fixture.corridors,"conductivity")); const threshold = parameters.minimumConductivity*10;
  return { label, fixtureId: fixture.id, costs: fixture.network.edges.map((item)=>item.effectiveCost), sourceMagnitude: fixture.network.terminals[0]?.magnitude??0, parameters, convergence:{converged:state.converged,reason:state.terminationReason,iterations:state.iteration,maxDeltaD:state.diagnostics.maxDeltaD,kirchhoffResidual:state.diagnostics.maximumKirchhoffResidual}, flow, conductivity, activeEdgeFraction:Object.values(state.edgeConductivities).filter((value)=>value>threshold).length/fixture.network.edges.length, edgeFlows:{...state.edgeFlows}, edgeConductivities:{...state.edgeConductivities}, runtimeMilliseconds:null };
}
export function createSensitivityReport(): PhysarumSensitivityReport {
  const robust = { maxIterations: 2000, convergenceTolerance: 1e-8 };
  const observations: SensitivityObservation[] = [];
  for (const ratio of COST_RATIOS) observations.push(observeSensitivity(createSensitivityFixture("parallel-corridors",ratio),robust,`cost-ratio:${ratio}`));
  for (const hillExponent of HILL_EXPONENTS) observations.push(observeSensitivity(createSensitivityFixture("parallel-corridors"),{...robust,hillExponent},`n:${hillExponent}`));
  for (const hillK of HILL_K_VALUES) observations.push(observeSensitivity(createSensitivityFixture("parallel-corridors"),{...robust,hillK},`K:${hillK}`));
  for (const adaptationRate of [0.5,1,2]) observations.push(observeSensitivity(createSensitivityFixture("parallel-corridors"),{...robust,adaptationRate,decayRate:1},`alpha/mu:${adaptationRate}`));
  for (const rate of [0.5,2]) observations.push(observeSensitivity(createSensitivityFixture("parallel-corridors"),{...robust,adaptationRate:rate,decayRate:rate,timeStep:0.2/rate},`common-rate:${rate}`));
  for (const timeStep of TIME_STEPS) observations.push(observeSensitivity(createSensitivityFixture("parallel-corridors"),{...robust,timeStep},`dt:${timeStep}`));
  for (const initialConductivity of INITIAL_CONDUCTIVITIES) observations.push(observeSensitivity(createSensitivityFixture("parallel-corridors"),{...robust,initialConductivity},`D0:${initialConductivity}`));
  for (const costScale of COST_SCALES) observations.push(observeSensitivity(createSensitivityFixture("parallel-corridors",1.1,1,costScale),robust,`cost-scale:${costScale}`));
  for (const magnitude of DEMAND_MAGNITUDES) observations.push(observeSensitivity(createSensitivityFixture("parallel-corridors",1.1,magnitude),robust,`demand:${magnitude}`));
  for (const id of ["parallel","three-corridors","shared-trunk","grid","bottleneck"] as const) observations.push(observeSensitivity(createSensitivityFixture(id),robust,`fixture:${id}`));
  return { modelVersion:SENSITIVITY_MODEL_VERSION,equations:"g=D/L; Q=g*dP; dD/dt=alpha*Hill(|Q|)-mu*D; explicit-Euler",observations };
}
export function serializeSensitivityReport(report: PhysarumSensitivityReport): string { return JSON.stringify(report,null,2); }
