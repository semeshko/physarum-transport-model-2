import {open,rename,unlink,stat,readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {isAbsolute} from "node:path";
export const MAX_FILE_BYTES=32*1024*1024;
export function fileError(error:unknown):Error {
  const code=(error as NodeJS.ErrnoException)?.code;
  if(code==="EACCES"||code==="EPERM"||code==="EBUSY")return new Error("Немає доступу до файлу або він зайнятий іншою програмою. Попередню копію не змінено.");
  if(code==="ENOSPC")return new Error("Недостатньо місця на диску. Попередню копію не змінено.");
  if(code==="ENOENT")return new Error("Файл або каталог не знайдено. Оберіть наявний каталог.");
  return error instanceof Error?error:new Error("Не вдалося прочитати або записати проєкт.");
}
export function projectPath(path:string):string {
  if(!isAbsolute(path) || path.startsWith("\\\\") || !path.toLowerCase().endsWith(".physarum.json")) throw new Error("Оберіть локальний файл із розширенням .physarum.json.");
  return path;
}
export function checkFileText(text:unknown):asserts text is string {
  if(typeof text!=="string" || Buffer.byteLength(text)>MAX_FILE_BYTES) throw new Error("Проєкт завеликий: максимум 32 МіБ.");
  let doc;
  try{doc=JSON.parse(text);}catch{throw new Error("Пошкоджений JSON.");}
  if(doc?.format!=="physarum-project" || doc.schemaVersion!==1 || doc.mode!=="analyze") throw new Error("Непідтримуваний формат проєкту.");
}
export async function readProjectFile(path:string):Promise<string> {
  projectPath(path);
  if((await stat(path)).size>MAX_FILE_BYTES) throw new Error("Проєкт завеликий: максимум 32 МіБ.");
  const text=await readFile(path,"utf8");checkFileText(text);return text;
}
/** Windows rename replaces in one operation. Never unlink/truncate the target. */
export async function writeProjectFile(path:string,text:string,replace=rename):Promise<void> {
  projectPath(path);checkFileText(text);
  const temp=`${path}.${randomUUID()}.tmp`;
  try {
    const handle=await open(temp,"wx",0o600);
    try{await handle.writeFile(text,"utf8");await handle.sync();}finally{await handle.close();}
    await replace(temp,path);
  } finally {await unlink(temp).catch(()=>{});}
}
export class SerializedOperations {
  private pending:Promise<unknown>=Promise.resolve();
  run<T>(operation:()=>Promise<T>):Promise<T> {const result=this.pending.then(operation);this.pending=result.catch(()=>{});return result;}
}
