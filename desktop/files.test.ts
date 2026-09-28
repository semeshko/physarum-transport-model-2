import {describe,it,expect} from "vitest";
import {mkdtemp,readFile,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {writeProjectFile,readProjectFile,SerializedOperations,projectPath,fileError} from "./files";
import {trustedFrame,allowedExternal,validSession} from "./security";
import {ready,unusedPort} from "./backend";
const text=JSON.stringify({format:"physarum-project",schemaVersion:1,mode:"analyze"});
describe("desktop file boundary",()=>{
  it("explains permission and disk failures without exposing paths",()=>{
    expect(fileError({code:"EPERM",path:"private"}).message).toContain("Немає доступу");
    expect(fileError({code:"ENOSPC"}).message).toContain("Недостатньо місця");
    expect(fileError({code:"ENOENT"}).message).toContain("не знайдено");
  });
  it("atomically replaces a Cyrillic path and preserves the prior file on failed rename",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"Physarum — тест ")),path=join(dir,"Квартал Львів — тест.physarum.json");
    await writeProjectFile(path,text);expect(await readProjectFile(path)).toBe(text);
    await expect(writeProjectFile(path,text+" ",async()=>{throw new Error("EPERM");})).rejects.toThrow("EPERM");
    expect(await readFile(path,"utf8")).toBe(text);expect(await readdir(dir)).toEqual(["Квартал Львів — тест.physarum.json"]);
    await writeProjectFile(path,text+" ");expect(await readFile(path,"utf8")).toBe(text+" ");
  });
  it("does not accept arbitrary relative files or executable extensions",()=>{expect(()=>projectPath("file.exe")).toThrow();expect(()=>projectPath("C:\\temp\\code.exe")).toThrow();});
  it("serializes writes after success and failure",async()=>{const queue=new SerializedOperations(),events:number[]=[];const a=queue.run(async()=>{events.push(1);throw new Error("fail");});const b=queue.run(async()=>{events.push(2);});await expect(a).rejects.toThrow();await b;expect(events).toEqual([1,2]);});
  it("rejects untrusted IPC frames, origins, sessions and external links",()=>{
    expect(trustedFrame("http://127.0.0.1:4123/","http://127.0.0.1:4123",true)).toBe(true);
    expect(trustedFrame("https://evil.test/","http://127.0.0.1:4123",true)).toBe(false);
    expect(trustedFrame("http://127.0.0.1:4123/","http://127.0.0.1:4123",false)).toBe(false);
    expect(validSession("old","new")).toBe(false);expect(allowedExternal("file:///C:/x")).toBe(false);expect(allowedExternal("https://carto.com.evil.test")).toBe(false);expect(allowedExternal("https://carto.com/basemaps/apikey/")).toBe(true);
  });
  it("chooses a non-3000 port and bounds failed readiness",async()=>{const port=await unusedPort();expect(port).not.toBe(3000);await expect(ready(`http://127.0.0.1:${port}`,"test",()=>true,150)).rejects.toThrow("runtime");});
});
