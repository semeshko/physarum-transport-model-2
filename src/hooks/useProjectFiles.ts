"use client";
import {useEffect,useRef,useState} from "react";
import {ProjectController} from "../project/controller";
import type {ProjectDocument,ProjectSnapshot} from "../project/document";
import type {FileCommand} from "../project/bridge";

export function useProjectFiles(snapshot:ProjectSnapshot,onOpen:(doc:ProjectDocument|null)=>ProjectSnapshot,supported:boolean) {
  const current=useRef(snapshot), apply=useRef(onOpen), allowed=useRef(supported);
  const controller=useRef<ProjectController|null>(null);
  const [view,setView]=useState({name:"Новий проєкт",dirty:false,busy:false});
  const [error,setError]=useState<string|null>(null);
  const [desktop,setDesktop]=useState(false);
  function publish(){const c=controller.current;if(c)setView(previous=>{const next={name:c.identity.name,dirty:c.dirty,busy:c.busy};return previous.name===next.name&&previous.dirty===next.dirty&&previous.busy===next.busy?previous:next;});}
  useEffect(()=>{current.current=snapshot;apply.current=onOpen;allowed.current=supported;
    const c=controller.current;
    if(c?.session) window.physarumDesktop?.changed({session:c.session,name:c.identity.name,dirty:c.dirty,canSave:supported});
    queueMicrotask(publish);
  },[snapshot,onOpen,supported]);
  useEffect(()=>{
    const bridge=window.physarumDesktop;
    if(!bridge) return;
    const c=new ProjectController(bridge,()=>current.current,doc=>{current.current=apply.current(doc);},publish);
    controller.current=c;
    const run=async(command:FileCommand)=>{
      if(!allowed.current) {setError("Файли DESKTOP-01 підтримують лише Analyze. Поверніться до Analyze перед файловою операцією.");return;}
      setError(null);
      try {await c.execute(command);} catch(e) {setError(e instanceof Error?e.message:"Не вдалося виконати файлову операцію.");}
    };
    const unsubscribe=bridge.onCommand(command=>void run(command));
    void c.initialize().then(()=>setDesktop(true)).catch(e=>setError(String(e)));
    return ()=>{unsubscribe();controller.current=null;};
  },[]);
  return {desktop,...view,error,
    rename:(name:string)=>{const c=controller.current;if(c){c.identity={...c.identity,name:name.slice(0,200)||"Новий проєкт"};c.baseline="";publish();}},
  };
}
