import {describe,it,expect,vi} from "vitest";
import {ProjectController} from "./controller";
import type {DesktopBridge} from "./bridge";
import {createProject,serializeProject} from "./document";
import {snapshot} from "./fixtures";
function setup(){
  let state=snapshot();
  const bridge:DesktopBridge={open:vi.fn(async()=>null),activate:vi.fn(async()=>crypto.randomUUID()),save:vi.fn(async()=>({name:"file"})),confirmUnsaved:vi.fn(async()=>"cancel" as const),changed:vi.fn(),close:vi.fn(async()=>{}),onCommand:()=>()=>{},getBasemapKey:async()=>"",setBasemapKey:async()=>{}};
  const commit=vi.fn(doc=>{state=doc?.snapshot??snapshot();});
  const controller=new ProjectController(bridge,()=>state,commit,()=>{});
  return {bridge,controller,commit,change:()=>{state={...state,costVisible:!state.costVisible};}};
}
describe("project transaction coordinator",()=>{
  it("cancelled and corrupt Open do not commit or cancel current runtime",async()=>{
    const s=setup();await s.controller.initialize();await s.controller.execute("open");expect(s.commit).not.toHaveBeenCalled();
    vi.mocked(s.bridge.open).mockResolvedValue({ticket:"t",text:"broken"});
    await expect(s.controller.execute("open")).rejects.toThrow();expect(s.commit).not.toHaveBeenCalled();
  });
  it("cancelled save and failed write prevent Close and leave dirty state",async()=>{
    const s=setup();await s.controller.initialize();s.change();
    vi.mocked(s.bridge.confirmUnsaved).mockResolvedValue("save");vi.mocked(s.bridge.save).mockResolvedValue(null);
    await s.controller.execute("close");expect(s.bridge.close).not.toHaveBeenCalled();expect(s.controller.dirty).toBe(true);
    vi.mocked(s.bridge.save).mockRejectedValue(new Error("disk full"));
    await expect(s.controller.execute("close")).rejects.toThrow("disk full");expect(s.bridge.close).not.toHaveBeenCalled();
  });
  it("serializes commands and keeps edits made during asynchronous save dirty",async()=>{
    const s=setup();await s.controller.initialize();s.change();
    let finish!:(value:{name:string})=>void;
    vi.mocked(s.bridge.save).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const saving=s.controller.execute("save");
    await vi.waitFor(()=>expect(s.bridge.save).toHaveBeenCalled());
    s.change();await s.controller.execute("new");expect(s.commit).not.toHaveBeenCalled();finish({name:"file"});await saving;expect(s.controller.dirty).toBe(true);
  });
  it("cancel/discard and successful save protect replacement",async()=>{
    const s=setup();await s.controller.initialize();s.change();await s.controller.execute("new");expect(s.commit).not.toHaveBeenCalled();
    vi.mocked(s.bridge.confirmUnsaved).mockResolvedValue("discard");await s.controller.execute("new");expect(s.commit).toHaveBeenCalledTimes(1);expect(s.controller.dirty).toBe(false);
    s.change();await s.controller.execute("saveAs");expect(s.controller.dirty).toBe(false);
  });
  it("validates and prepares the complete project before committing Open",async()=>{
    const s=setup();await s.controller.initialize();
    const doc=await createProject(snapshot(),{id:"saved",name:"Львів",createdAt:"2026-09-28"});
    vi.mocked(s.bridge.open).mockResolvedValue({ticket:"chosen",text:serializeProject(doc)});
    await s.controller.execute("open");expect(s.controller.identity.id).toBe("saved");expect(s.controller.dirty).toBe(false);expect(s.commit).toHaveBeenCalledTimes(1);
  });
});
