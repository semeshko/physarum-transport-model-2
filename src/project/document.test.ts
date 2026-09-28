import {describe,it,expect,vi} from "vitest";
import {setTerminal,setEdgePenalty} from "../scenario/scenario";
import {runPhysarum} from "../physarum/solver";
import {createProject,parseProject,serializeProject,prepareProject,scientificInput,fingerprint,MAX_PROJECT_BYTES} from "./document";
import {snapshot} from "./fixtures";
const identity={id:"test-project",name:"Квартал Львів — тест",createdAt:"2026-09-28T00:00:00Z"};
describe("project document v1",()=>{
  it("round-trips anchors, properties, graph IDs, non-default parameters and a completed result; reruns identically without refetch",async()=>{
    const s=snapshot(),g=prepareProject(s).graph,edge=g.edges[0];
    s.scenario=setTerminal(setTerminal(s.scenario,"source",edge.fromNodeId),"sink",edge.toNodeId);
    s.scenario=setEdgePenalty(s.scenario,edge.id,1.2);
    const network=prepareProject(s).prepared.network!;
    s.result=runPhysarum(network,s.parameters);
    const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("offline"));
    try{
      const doc=await createProject(s,identity),restored=await parseProject(serializeProject(doc));
      expect(restored.snapshot).toEqual(s);
      expect(restored.snapshot.dataset.features.some(f=>f.lineTopology?.vertexAnchors.length)).toBe(true);
      expect(prepareProject(restored.snapshot).graph.nodes).toEqual(g.nodes);
      expect(runPhysarum(prepareProject(restored.snapshot).prepared.network!,restored.snapshot.parameters)).toEqual(s.result);
      expect(fetch).not.toHaveBeenCalled();
    }finally{fetch.mockRestore();}
  });
  it("does not include camera or visibility in scientific input",async()=>{
    const s=snapshot();const moved={...s,camera:{...s.camera,zoom:15},costVisible:true};
    expect(await fingerprint(scientificInput(s))).toBe(await fingerprint(scientificInput(moved)));
  });
  it("rejects corruption, unknown schema and modified analytical input",async()=>{
    const doc=await createProject(snapshot(),identity);
    await expect(parseProject("{broken")).rejects.toThrow("JSON");
    await expect(parseProject(JSON.stringify({...doc,schemaVersion:99}))).rejects.toThrow("версія");
    doc.snapshot.parameters.hillK=2;
    await expect(parseProject(JSON.stringify(doc))).rejects.toThrow("суми");
  });
  it("rejects invalid references, missing parameters and broken ordered anchors",async()=>{
    const s=snapshot();s.scenario=setTerminal(s.scenario,"source","unknown-node");
    await expect(createProject(s,identity)).rejects.toThrow("вузли");
    const doc=await createProject(snapshot(),identity);
    const value=JSON.parse(JSON.stringify(doc));delete value.snapshot.parameters.hillK;
    await expect(parseProject(JSON.stringify(value))).rejects.toThrow();
    const invalid=JSON.parse(JSON.stringify(doc));invalid.snapshot.dataset.features[0].lineTopology.vertexAnchors[0].pop();
    await expect(parseProject(JSON.stringify(invalid))).rejects.toThrow();
  });
  it("rejects excessive size/depth and dangerous object keys",async()=>{
    await expect(parseProject(" ".repeat(MAX_PROJECT_BYTES+1))).rejects.toThrow("завеликий");
    await expect(parseProject('['.repeat(50)+'0'+']'.repeat(50))).rejects.toThrow("вкладеності");
    await expect(parseProject('{"__proto__":{}}')).rejects.toThrow("Заборонене");
  });
});
