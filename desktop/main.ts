import {app,BrowserWindow,Menu,dialog,ipcMain,utilityProcess,shell,type IpcMainInvokeEvent,type IpcMainEvent} from "electron";
import {join,basename,dirname} from "node:path";
import {randomBytes,randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile,appendFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {writeProjectFile,readProjectFile,SerializedOperations,checkFileText,fileError} from "./files";
import {trustedFrame,allowedExternal,validSession} from "./security";
import {unusedPort,ready} from "./backend";
import type {FileCommand} from "../src/project/bridge";

// Squirrel installation events only create/remove this application's shortcuts.
const squirrel=process.argv.find(arg=>arg.startsWith("--squirrel-"));
if(squirrel){
  if(squirrel==="--squirrel-install"||squirrel==="--squirrel-updated"||squirrel==="--squirrel-uninstall"){
    const child=spawn(join(dirname(process.execPath),"..","Update.exe"),[squirrel==="--squirrel-uninstall"?"--removeShortcut":"--createShortcut",basename(process.execPath)],{windowsHide:true});
    child.on("close",()=>app.quit());child.on("error",()=>app.quit());
  }else app.quit();
}else if(!app.requestSingleInstanceLock()){app.quit();}else{void start();}

async function start(){
  await app.whenReady();
  const started=Date.now();
  const userData=app.getPath("userData");await mkdir(userData,{recursive:true});
  const log=(message:string)=>void appendFile(join(userData,"desktop.log"),`${new Date().toISOString()} ${message}\n`).catch(()=>{});
  let window:BrowserWindow|null=null;
  let child:ReturnType<typeof utilityProcess.fork>|null=null;
  let quitting=false,approvedClose=false,origin="",session="",currentPath:string|null=null,canSave=false;
  const pendingFiles=new Map<string,string>();
  const operations=new SerializedOperations();
  const token=randomBytes(32).toString("hex");
  const settingsPath=join(userData,"basemap.json");
  const command=(value:FileCommand)=>{if(window && session)window.webContents.send("project:command",value);};
  app.on("second-instance",()=>{window?.show();window?.focus();});
  app.on("before-quit",event=>{if(!approvedClose&&window&&session){event.preventDefault();command("close");return;}quitting=true;child?.kill();});
  app.on("window-all-closed",()=>app.quit());
  const trusted=(event:IpcMainInvokeEvent|IpcMainEvent)=>{
    if(!window || event.sender!==window.webContents || !trustedFrame(event.senderFrame?.url??"",origin,event.senderFrame===window.webContents.mainFrame)) throw new Error("Недовірене джерело запиту.");
  };
  const sessionCheck=(value:unknown)=>{if(!validSession(value,session))throw new Error("Застаріла сесія документа.");};
  const handle=(name:string,fn:(arg:unknown)=>Promise<unknown>)=>ipcMain.handle(name,(event,arg)=>{trusted(event);return operations.run(()=>fn(arg)).catch(error=>{throw fileError(error);});});
  try{
    window=new BrowserWindow({width:1440,height:1000,minWidth:950,minHeight:650,title:"Physarum — запуск…",backgroundColor:"#17232b",show:true,
      webPreferences:{preload:join(__dirname,"preload.cjs"),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,partition:`physarum-${randomUUID()}`}});
    await window.loadFile(join(__dirname,"splash.html"));
    window.on("close",event=>{if(!approvedClose&&session){event.preventDefault();command("close");}else{quitting=true;child?.kill();}});
    window.on("closed",()=>{window=null;});
    window.webContents.on("render-process-gone",()=>{child?.kill();approvedClose=true;dialog.showErrorBox("Physarum","Вікно програми аварійно завершилося. Збережений файл не змінено.");app.quit();});
    window.webContents.on("will-navigate",(event,url)=>{if(!trustedFrame(url,origin,true))event.preventDefault();});
    window.webContents.setWindowOpenHandler(({url})=>{if(allowedExternal(url))void shell.openExternal(url);return {action:"deny"};});
    const ses=window.webContents.session;
    ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    ses.setPermissionCheckHandler(()=>false);
    const menu=Menu.buildFromTemplate([{label:"Файл",submenu:[
      {label:"Новий проєкт",accelerator:"Ctrl+N",click:()=>command("new")},
      {label:"Відкрити…",accelerator:"Ctrl+O",click:()=>command("open")},
      {label:"Зберегти",accelerator:"Ctrl+S",click:()=>command("save")},
      {label:"Зберегти як…",accelerator:"Ctrl+Shift+S",click:()=>command("saveAs")},
      {type:"separator"},{label:"Вийти",accelerator:"Alt+F4",click:()=>session?command("close"):app.quit()},
    ]}]);Menu.setApplicationMenu(menu);
    // No source-tree lookup in a packaged application.
    const runtime=app.isPackaged?join(process.resourcesPath,"runtime"):join(app.getAppPath(),".desktop","runtime");
    const port=await unusedPort();origin=`http://127.0.0.1:${port}`;
    ses.webRequest.onBeforeSendHeaders({urls:[`${origin}/*`]},(details,callback)=>{
      // This ephemeral session contains only our window and its workers.
      callback({requestHeaders:{...details.requestHeaders,"x-physarum-token":token}});
    });
    // Test switch blocks remote requests in this app session only, never OS network settings.
    if(process.argv.includes("--offline-test"))ses.webRequest.onBeforeRequest((details,callback)=>callback({cancel:/^https?:/.test(details.url)&&!details.url.startsWith(`${origin}/`)}));
    child=utilityProcess.fork(join(runtime,"server.js"),[],{cwd:userData,env:{...process.env,NODE_ENV:"production",HOSTNAME:"127.0.0.1",PORT:String(port),PHYSARUM_DESKTOP_TOKEN:token,NEXT_TELEMETRY_DISABLED:"1"},stdio:"pipe",serviceName:"Physarum local runtime"});
    let alive=true;
    child.on("exit",code=>{alive=false;log(`runtime exit ${code}`);if(!quitting){approvedClose=true;dialog.showErrorBox("Physarum","Локальний runtime завершився. Перезапустіть програму. Збережений файл не змінено.");app.quit();}});
    // Avoid logging potentially sensitive URLs or query headers.
    child.stderr?.on("data",()=>log("runtime stderr (details omitted)"));
    await ready(origin,token,()=>alive);
    log(`runtime ready port=${port} pid=${child.pid} startupMs=${Date.now()-started}`);
    handle("project:open",async()=>{
      const result=await dialog.showOpenDialog(window!,{title:"Відкрити проєкт",properties:["openFile"],filters:[{name:"Проєкт Physarum",extensions:["json"]}]});
      if(result.canceled)return null;
      const path=result.filePaths[0],text=await readProjectFile(path),ticket=randomUUID();pendingFiles.clear();pendingFiles.set(ticket,path);return {text,ticket};
    });
    handle("project:activate",async ticket=>{
      if(ticket!==null&&(typeof ticket!=="string"||!pendingFiles.has(ticket)))throw new Error("Недійсний вибір файлу.");
      currentPath=typeof ticket==="string"?pendingFiles.get(ticket)!:null;pendingFiles.clear();session=randomUUID();return session;
    });
    handle("project:save",async input=>{
      const arg=input as {session?:unknown;text?:unknown;saveAs?:unknown};
      if(!arg||typeof arg.saveAs!=="boolean")throw new Error("Некоректний запит збереження.");
      sessionCheck(arg.session);if(!canSave)throw new Error("Збереження підтримує лише Analyze.");checkFileText(arg.text);
      let path=currentPath;
      if(!path||arg.saveAs){const result=await dialog.showSaveDialog(window!,{title:"Зберегти проєкт",defaultPath:path??"Квартал.physarum.json",filters:[{name:"Проєкт Physarum",extensions:["physarum.json"]}]});if(result.canceled||!result.filePath)return null;path=result.filePath.toLowerCase().endsWith(".physarum.json")?result.filePath:`${result.filePath}.physarum.json`;}
      await writeProjectFile(path,arg.text);currentPath=path;log("project saved");return {name:basename(path)};
    });
    handle("project:confirm",async()=>{const result=await dialog.showMessageBox(window!,{type:"question",title:"Незбережені зміни",message:"Зберегти зміни перед продовженням?",buttons:["Зберегти","Не зберігати","Скасувати"],defaultId:0,cancelId:2,noLink:true});return ["save","discard","cancel"][result.response];});
    ipcMain.on("project:changed",(event,arg)=>{try{trusted(event);sessionCheck(arg?.session);if(typeof arg.name!=="string"||arg.name.length>200||typeof arg.dirty!=="boolean"||typeof arg.canSave!=="boolean")return;canSave=arg.canSave;window?.setTitle(`${arg.dirty?"● ":""}${arg.name} — Physarum Transport Model 2.0`);}catch{/* Untrusted or stale notifications have no effect. */}});
    handle("project:close",async value=>{sessionCheck(value);approvedClose=true;app.quit();});
    handle("settings:basemap:get",async()=>{try{return JSON.parse(await readFile(settingsPath,"utf8")).key??"";}catch{return "";}});
    handle("settings:basemap:set",async key=>{if(typeof key!=="string"||key.length>1024||/[\r\n]/.test(key))throw new Error("Некоректний ключ.");await writeFile(settingsPath,JSON.stringify({key}),{mode:0o600});});
    await window.loadURL(origin);
    log(`window loaded startupMs=${Date.now()-started}`);
  }catch(error){quitting=true;approvedClose=true;child?.kill();log("startup failed");dialog.showErrorBox("Не вдалося запустити Physarum",error instanceof Error?error.message:"Невідома помилка");app.quit();}
}
