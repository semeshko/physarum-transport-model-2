/** Read-only verification. Bundle and run with the pinned Electron Node runtime;
 * a different V8 may round trigonometric derived edge lengths differently. */
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeProjectFile } from "../desktop/files";
import { performance } from "node:perf_hooks";
import { parseProject, prepareProject, canonical, createProject, serializeProject } from "../src/project/document";
import { runPhysarum } from "../src/physarum/solver";

const path = process.argv[2];
if (!path) throw new Error("Usage: electron .desktop/verify-project.mjs <project.physarum.json> (ELECTRON_RUN_AS_NODE=1)");
globalThis.fetch = async () => { throw new Error("Network forbidden during snapshot verification"); };
const text = await readFile(path, "utf8");
const started = performance.now();
if(process.argv.includes("--diagnose")) {
  const raw=JSON.parse(text), rebuilt=await createProject(raw.snapshot,raw);
  console.log("Fingerprint diagnosis",{graph:raw.graphFingerprint===rebuilt.graphFingerprint,input:raw.inputFingerprint===rebuilt.inputFingerprint,result:raw.resultFingerprint===rebuilt.resultFingerprint});
}
const doc = await parseProject(text);
const validatedMs = performance.now() - started;
let savePreparationMs:number|undefined, atomicWriteMs:number|undefined;
if(process.argv.includes("--io-benchmark")) {
  const startedSave=performance.now();
  const serialized=serializeProject(await createProject(doc.snapshot,doc));
  savePreparationMs=performance.now()-startedSave;
  const dir=await mkdtemp(join(tmpdir(),"physarum-save-benchmark-"));
  const destination=join(dir,"Квартал.physarum.json");
  await writeProjectFile(destination,serialized);
  const startedWrite=performance.now();
  await writeProjectFile(destination,serialized);
  atomicWriteMs=performance.now()-startedWrite;
}
const { graph, prepared } = prepareProject(doc.snapshot);
const beforeRun = performance.now();
const result = prepared.network ? runPhysarum(prepared.network, doc.snapshot.parameters) : null;
console.log(JSON.stringify({
  bytes: Buffer.byteLength(text), validatedMs, savePreparationMs, atomicWriteMs, repeatRunMs: performance.now() - beforeRun,
  profile: doc.snapshot.scenario.transportProfileId,
  features: doc.snapshot.dataset.featureCount, nodes: graph.nodes.length, edges: graph.edges.length,
  aoi: doc.snapshot.aoi, acquisitions: doc.snapshot.dataset.source.acquisitions,
  terminals: doc.snapshot.scenario.terminals.map(t => ({ ...t, node: graph.nodes.find(n => n.id === t.nodeId) })),
  savedIteration: doc.snapshot.result?.iteration, repeatedIteration: result?.iteration,
  exactResultEquality: doc.snapshot.result ? canonical(result) === canonical(doc.snapshot.result) : null,
  inputFingerprint: doc.inputFingerprint, graphFingerprint: doc.graphFingerprint,
}, null, 2));
if (doc.snapshot.result && canonical(result) !== canonical(doc.snapshot.result)) process.exitCode = 1;
