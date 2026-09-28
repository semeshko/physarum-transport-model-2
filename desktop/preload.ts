import {contextBridge,ipcRenderer} from "electron";
import type {DesktopBridge,FileCommand} from "../src/project/bridge";
const api:DesktopBridge={
  open:()=>ipcRenderer.invoke("project:open"),
  activate:ticket=>ipcRenderer.invoke("project:activate",ticket),
  save:input=>ipcRenderer.invoke("project:save",input),
  confirmUnsaved:()=>ipcRenderer.invoke("project:confirm"),
  changed:input=>ipcRenderer.send("project:changed",input),
  close:session=>ipcRenderer.invoke("project:close",session),
  onCommand:callback=>{const listener=(_event:unknown,command:FileCommand)=>callback(command);ipcRenderer.on("project:command",listener);return()=>ipcRenderer.removeListener("project:command",listener);},
  getBasemapKey:()=>ipcRenderer.invoke("settings:basemap:get"),
  setBasemapKey:key=>ipcRenderer.invoke("settings:basemap:set",key),
};
contextBridge.exposeInMainWorld("physarumDesktop",Object.freeze(api));
