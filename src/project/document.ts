import { z } from "zod";
import { ingestGeoJSON } from "../gis/ingest";
import { buildTransportGraph, DEFAULT_SNAP_TOLERANCE_DEGREES } from "../graph/build";
import { applyTransportProfile } from "../transport-profile/profile";
import { applyGeneralizedCosts } from "../transport-cost/model";
import { applySpatialConstraints, createSpatialConstraintSet } from "../spatial-constraints/model";
import { prepareNetwork } from "../scenario/prepare";
import type { GISDataset, GISBounds } from "../gis/types";
import type { AnalysisScenario } from "../scenario/types";
import type { PhysarumState } from "../physarum/types";
import type { OSMImportSummary } from "../osm/types";

export const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
export const ALGORITHM_VERSION = "analyze-2a099f1";
export const GRAPH_VERSION = "anchored-2a099f1";
const str = z.string().max(4096);
const id = z.string().min(1).max(256);
const num = z.number().finite();
const positive = num.positive();
const count = z.number().int().min(0).max(1_000_000);
const bounds = z.tuple([num.min(-180).max(180), num.min(-90).max(90), num.min(-180).max(180), num.min(-90).max(90)]).refine(([w,s,e,n]) => w <= e && s <= n);
export const cameraSchema = z.object({ center: z.tuple([num.min(-180).max(180),num.min(-90).max(90)]), zoom:num.min(0).max(24), bearing:num.min(-360).max(360), pitch:num.min(0).max(85) }).strict();
export type ProjectCamera = z.infer<typeof cameraSchema>;
export const INITIAL_CAMERA: ProjectCamera = { center:[24.0316,49.8429],zoom:12,bearing:0,pitch:0 };
const acquisition = z.object({endpoint:str.nullable(),fetchedAt:str.nullable(),receivedAt:str,snapshotTimestamp:str.nullable(),cached:z.boolean().nullable()}).strict();
const datasetSchema = z.object({
  id, name:str, source:z.object({kind:z.enum(["bundled","file","osm"]),name:str,acquisitions:z.record(str,acquisition).optional()}).strict(),
  crs:z.literal("EPSG:4326"), featureCount:count, features:z.array(z.unknown()).max(20000), bounds:bounds.nullable(),
  geometryTypes:z.array(z.enum(["Point","LineString","MultiLineString","Polygon","MultiPolygon"])),
  categoryCounts:z.object({road:count,path:count,building:count,water:count,railway:count,green:count,unknown:count}).strict(),warnings:z.array(str).max(20000),
}).strict().transform((value, ctx): GISDataset => {
  try {
    const original = value.features as GISDataset["features"];
    const checked = ingestGeoJSON({type:"FeatureCollection",features:original.map(f => ({...f,type:"Feature"}))},{name:value.name,source:value.source});
    if (canonical(checked.features) !== canonical(original) || value.featureCount !== checked.featureCount || canonical(value.categoryCounts) !== canonical(checked.categoryCounts) || canonical(value.bounds) !== canonical(checked.bounds) || canonical(value.geometryTypes) !== canonical(checked.geometryTypes)) throw new Error("GIS metadata mismatch");
    return {...value,features:checked.features};
  } catch { ctx.addIssue({code:"custom",message:"Некоректні геометрії, anchors або метадані GIS."}); return z.NEVER; }
});
const scenarioSchema = z.object({id,name:str,transportProfileId:z.enum(["pedestrian","bicycle","motor"]),
  terminals:z.array(z.object({id,role:z.enum(["source","sink"]),nodeId:id,magnitude:positive}).strict()).max(1000),
  edgeConstraints:z.array(z.object({id,edgeId:id,blocked:z.boolean(),penaltyMultiplier:num.min(1)}).strict()).max(100000),
  costModel:z.object({kind:z.literal("profile-time-seconds")}).strict(),
}).strict();
const parametersSchema = z.object({initialConductivity:positive,adaptationRate:positive,decayRate:positive,hillK:positive,hillExponent:positive,timeStep:positive,maxIterations:z.number().int().positive().max(100000),convergenceTolerance:positive,minimumConductivity:positive,demandScaleKappa:positive.optional()}).strict();
const linearSolve = z.object({method:z.enum(["dense","conjugate-gradient"]),iterations:count,converged:z.boolean(),residualNorm:num,tolerance:num,failureReason:str.nullable()}).strict();
const resultSchema = z.object({networkGraphId:id,scenarioId:id,iteration:count,nodePressures:z.record(id,num),edgeConductivities:z.record(id,positive),edgeFlows:z.record(id,num),
  diagnostics:z.object({iteration:count,maxDeltaD:num,totalAbsoluteFlow:num,sourceFlowBalanceError:num,sinkFlowBalanceError:num,maximumKirchhoffResidual:num,linearSolve:linearSolve.nullable()}).strict(),
  scale:z.object({mode:z.enum(["absolute","demandNormalized"]),qRef:num.min(0),effectiveHillK:positive}).strict(),converged:z.boolean(),terminationReason:z.enum(["converged","maxIterations"]),error:z.null(),
}).strict();
const summarySchema:z.ZodType<OSMImportSummary> = z.object({bounds,wayCount:count,skippedElementCount:count,missingTopologyWayCount:count,urbanFeatureCount:count,urbanPolygonCount:count,urbanStatus:z.enum(["loaded","empty","partial","unavailable"]),urbanContextWarning:str.nullable(),transportProvenance:acquisition,contextProvenance:acquisition.nullable(),fetchMilliseconds:num.min(0),adapterMilliseconds:num.min(0),warnings:z.array(str)}).strict();
export const snapshotSchema = z.object({
  dataset:datasetSchema, aoi:bounds.nullable(), osmSummary:summarySchema.nullable(), allowIncompleteContext:z.boolean(),
  scenario:scenarioSchema, parameters:parametersSchema,
  spatialPolicy:z.object({buildings:z.boolean(),water:z.boolean(),green:z.boolean(),greenMultiplier:num.min(1)}).strict(),
  camera:cameraSchema, projection:z.enum(["mercator","globe"]),
  visibility:z.object({roadsPaths:z.boolean(),buildings:z.boolean(),water:z.boolean(),green:z.boolean()}).strict(),
  graphVisibility:z.object({edges:z.boolean(),nodes:z.boolean()}).strict(),costVisible:z.boolean(),spatialVisible:z.boolean(),
  result:resultSchema.nullable(),
}).strict();
export type ProjectSnapshot = Omit<z.infer<typeof snapshotSchema>,"scenario"|"result"|"aoi"> & {scenario:AnalysisScenario;result:PhysarumState|null;aoi:GISBounds|null};
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const documentSchema = z.object({format:z.literal("physarum-project"),schemaVersion:z.literal(1),id,name:str.min(1),appVersion:z.literal("0.1.0"),createdAt:str, savedAt:str,mode:z.literal("analyze"),crs:z.literal("EPSG:4326"),algorithmVersion:z.literal(ALGORITHM_VERSION),graphVersion:z.literal(GRAPH_VERSION),snapTolerance:z.literal(DEFAULT_SNAP_TOLERANCE_DEGREES),snapshot:snapshotSchema,graphFingerprint:hashSchema,inputFingerprint:hashSchema,resultFingerprint:hashSchema.nullable()}).strict();
export type ProjectDocument = z.infer<typeof documentSchema>;

/** Stable JSON, not object insertion order. No network or platform imports. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter(k => (value as Record<string,unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function fingerprint(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes),b => b.toString(16).padStart(2,"0")).join("");
}
export function scientificInput(s:ProjectSnapshot) { return {dataset:{id:s.dataset.id,crs:s.dataset.crs,features:s.dataset.features},scenario:s.scenario,parameters:s.parameters,spatialPolicy:s.spatialPolicy,algorithmVersion:ALGORITHM_VERSION,graphVersion:GRAPH_VERSION,snapTolerance:DEFAULT_SNAP_TOLERANCE_DEGREES}; }
export function prepareProject(s: ProjectSnapshot) {
  const graph = buildTransportGraph(s.dataset);
  const nodeIds = new Set(graph.nodes.map(n=>n.id)), edgeIds = new Set(graph.edges.map(e=>e.id));
  if (s.scenario.terminals.some(t=>!nodeIds.has(t.nodeId)) || s.scenario.edgeConstraints.some(e=>!edgeIds.has(e.edgeId))) throw new Error("Проєкт містить посилання на відсутні вузли або ребра.");
  if (new Set(s.scenario.terminals.map(t=>t.id)).size !== s.scenario.terminals.length || new Set(s.scenario.edgeConstraints.map(t=>t.edgeId)).size !== s.scenario.edgeConstraints.length) throw new Error("Дубльовані термінали або обмеження.");
  const profiled = applyTransportProfile(graph,s.scenario.transportProfileId);
  const costed = applyGeneralizedCosts(profiled);
  const spatial = applySpatialConstraints(costed,createSpatialConstraintSet(s.dataset),s.spatialPolicy);
  const prepared = prepareNetwork(graph,s.scenario,profiled,costed,spatial);
  if(s.result) {
    const r=s.result, n=prepared.network;
    const sameKeys=(record:Readonly<Record<string,number>>,keys:string[])=>canonical(Object.keys(record).sort())===canonical(keys.sort());
    if(!n || r.networkGraphId!==graph.id || r.scenarioId!==s.scenario.id || !sameKeys(r.edgeFlows,n.edges.map(e=>e.graphEdgeId)) || !sameKeys(r.edgeConductivities,n.edges.map(e=>e.graphEdgeId)) || !sameKeys(r.nodePressures,n.nodes.map(v=>v.id)) || r.iteration!==r.diagnostics.iteration || r.iteration>s.parameters.maxIterations || r.converged !== (r.terminationReason==="converged")) throw new Error("Результат не відповідає мережі або сценарію.");
  }
  return {graph,prepared};
}
export function inspectJSON(value:unknown,depth=0,budget={remaining:2_000_000}):void {
  if(depth>48 || --budget.remaining<0) throw new Error("Проєкт перевищує ліміт вкладеності або кількості об’єктів.");
  if(typeof value === "number" && !Number.isFinite(value)) throw new Error("Некоректне число у проєкті.");
  if(value && typeof value==="object") for(const [key,item] of Object.entries(value)) { if(["__proto__","constructor","prototype"].includes(key)) throw new Error("Заборонене поле у проєкті."); inspectJSON(item,depth+1,budget); }
}
export async function createProject(snapshot:ProjectSnapshot,identity:{id:string;name:string;createdAt:string}):Promise<ProjectDocument> {
  inspectJSON(snapshot);
  const s=snapshotSchema.parse(snapshot);
  const {graph}=prepareProject(s);
  const inputFingerprint=await fingerprint(scientificInput(s));
  return {...identity,format:"physarum-project",schemaVersion:1,appVersion:"0.1.0",savedAt:new Date().toISOString(),mode:"analyze",crs:"EPSG:4326",algorithmVersion:ALGORITHM_VERSION,graphVersion:GRAPH_VERSION,snapTolerance:DEFAULT_SNAP_TOLERANCE_DEGREES,snapshot:s,graphFingerprint:await fingerprint({nodes:graph.nodes,edges:graph.edges}),inputFingerprint,resultFingerprint:s.result ? await fingerprint({inputFingerprint,state:s.result}):null};
}
export async function parseProject(text:string):Promise<ProjectDocument> {
  if(new TextEncoder().encode(text).length>MAX_PROJECT_BYTES) throw new Error("Проєкт завеликий: максимум 32 МіБ.");
  let value:unknown;
  try { value=JSON.parse(text); } catch { throw new Error("Пошкоджений файл: некоректний JSON."); }
  inspectJSON(value);
  const parsed=documentSchema.safeParse(value);
  if(!parsed.success) throw new Error("Несумісна версія або некоректний документ Analyze. Автоматична міграція не виконується.");
  const doc=parsed.data;
  const rebuilt=await createProject(doc.snapshot,doc);
  if(doc.graphFingerprint!==rebuilt.graphFingerprint || doc.inputFingerprint!==rebuilt.inputFingerprint || doc.resultFingerprint!==rebuilt.resultFingerprint) throw new Error("Контрольні суми або версія мережі не збігаються. Проєкт не відкрито.");
  return doc;
}
export function serializeProject(doc:ProjectDocument):string { const text=JSON.stringify(doc); if(new TextEncoder().encode(text).length>MAX_PROJECT_BYTES) throw new Error("Проєкт завеликий: максимум 32 МіБ."); return text; }
