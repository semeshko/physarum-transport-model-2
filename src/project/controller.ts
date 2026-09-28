import { canonical,createProject,parseProject,serializeProject,type ProjectDocument,type ProjectSnapshot } from "./document";
import type { DesktopBridge,FileCommand } from "./bridge";

/** Single-document coordinator. File access is injected; never exposes paths. */
export class ProjectController {
  session="";
  identity={id:crypto.randomUUID() as string,name:"Новий проєкт",createdAt:new Date().toISOString()};
  baseline="";
  busy=false;
  constructor(private bridge:DesktopBridge,private capture:()=>ProjectSnapshot,private commit:(doc:ProjectDocument|null)=>void,private changed:()=>void) {}
  get dirty() { return canonical(this.capture())!==this.baseline; }
  async initialize() { this.session=await this.bridge.activate(null);this.baseline=canonical(this.capture());this.changed(); }
  private async save(as:boolean):Promise<boolean> {
    const snapshot=this.capture(),revision=canonical(snapshot),session=this.session;
    const document=await createProject(snapshot,this.identity);
    const result=await this.bridge.save({session,text:serializeProject(document),saveAs:as});
    if(!result || session!==this.session) return false;
    this.baseline=revision;
    this.changed();
    return !this.dirty;
  }
  private async mayReplace():Promise<boolean> {
    if(!this.dirty) return true;
    const choice=await this.bridge.confirmUnsaved();
    if(choice==="cancel") return false;
    return choice==="discard" || await this.save(false);
  }
  async execute(command:FileCommand) {
    if(this.busy) return;
    this.busy=true;this.changed();
    try {
      if(command==="save" || command==="saveAs") { await this.save(command==="saveAs");return; }
      // A cancelled/invalid Open leaves both the active document AND worker alone.
      const selected=command==="open" ? await this.bridge.open():null;
      if(command==="open" && !selected) return;
      const doc=selected ? await parseProject(selected.text):null;
      if(!await this.mayReplace()) return;
      if(command==="close") { await this.bridge.close(this.session);return; }
      const session=await this.bridge.activate(selected?.ticket??null);
      this.session=session;
      this.identity=doc?{id:doc.id,name:doc.name,createdAt:doc.createdAt}:{id:crypto.randomUUID(),name:"Новий проєкт",createdAt:new Date().toISOString()};
      this.commit(doc);
      this.baseline=canonical(this.capture());
    } finally {this.busy=false;this.changed();}
  }
}
