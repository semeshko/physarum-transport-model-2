import { describe, expect, it } from "vitest";
import sampleUrban from "../data/sample-urban.json";
import { ingestGeoJSON } from "../gis/ingest";
import { buildTransportGraph } from "../graph/build";
import { prepareNetwork } from "../scenario/prepare";
import { createEmptyScenario, setTerminal } from "../scenario/scenario";
import type { PreparedNetwork } from "../scenario/types";
import { runPhysarum } from "./solver";

function chain(size: number): PreparedNetwork {
  const nodes = Array.from({ length: size }, (_, index) => ({ id: `n-${index.toString().padStart(3, "0")}`, position: [index, 0] as const }));
  const edges = nodes.slice(0, -1).map((node, index) => ({ graphEdgeId: `e-${index}`, fromNodeId: node.id, toNodeId: nodes[index + 1].id, lengthMeters: 1, penaltyMultiplier: 1, effectiveCost: 1 }));
  return { graphId: `chain-${size}`, scenarioId: "benchmark", nodes, edges, terminals: [{ id: "source", role: "source", nodeId: nodes[0].id, magnitude: 1 }, { id: "sink", role: "sink", nodeId: nodes[nodes.length - 1].id, magnitude: 1 }], activeEdgeCount: edges.length, blockedEdgeCount: 0, sourceSinkConnected: true };
}

function measure(label: string, network: PreparedNetwork) {
  const started = performance.now();
  const result = runPhysarum(network);
  const duration = performance.now() - started;
  console.info(`physarum-performance ${label} nodes=${network.nodes.length} edges=${network.edges.length} iterations=${result.iteration} reason=${result.terminationReason} durationMs=${duration.toFixed(2)}`);
  expect(result.terminationReason).toBe("converged");
  expect(duration).toBeLessThan(5_000);
}

describe("Physarum deterministic performance measurements", () => {
  it("measures tiny, current urban, and moderate networks", () => {
    measure("tiny", chain(2));
    const dataset = ingestGeoJSON(sampleUrban, { name: "sample-urban.json", source: { kind: "bundled", name: "sample-urban.json" } });
    const graph = buildTransportGraph(dataset);
    const terminalEdge = graph.edges[0];
    const scenario = setTerminal(setTerminal(createEmptyScenario(), "source", terminalEdge.fromNodeId), "sink", terminalEdge.toNodeId);
    const prepared = prepareNetwork(graph, scenario).network;
    expect(prepared).not.toBeNull();
    measure("urban", prepared!);
    measure("moderate-chain", chain(40));
  });
});
