export type FileCommand = "new" | "open" | "save" | "saveAs" | "close";
export type DesktopBridge = {
  open():Promise<{text:string;ticket:string}|null>;
  activate(ticket:string|null):Promise<string>;
  save(input:{session:string;text:string;saveAs:boolean}):Promise<{name:string}|null>;
  confirmUnsaved():Promise<"save"|"discard"|"cancel">;
  changed(input:{session:string;name:string;dirty:boolean;canSave:boolean}):void;
  close(session:string):Promise<void>;
  onCommand(callback:(command:FileCommand)=>void):()=>void;
  getBasemapKey():Promise<string>;
  setBasemapKey(key:string):Promise<void>;
};
declare global { interface Window { physarumDesktop?:DesktopBridge; } }
