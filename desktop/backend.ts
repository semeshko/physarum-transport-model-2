import {createServer} from "node:net";
import {get} from "node:http";
/** Reserve a currently unused port; startup detects races instead of reusing another server. */
export async function unusedPort():Promise<number>{
  return new Promise((resolve,reject)=>{const server=createServer();server.on("error",reject);server.listen(0,"127.0.0.1",()=>{const address=server.address();const port=typeof address==="object"&&address?address.port:0;server.close(error=>error?reject(error):resolve(port));});});
}
export async function ready(origin:string,token:string,alive:()=>boolean,timeout=20000):Promise<void>{
  const start=Date.now();
  while(Date.now()-start<timeout && alive()){
    const ok=await new Promise<boolean>(resolve=>{const request=get(`${origin}/api/desktop-health`,{headers:{"x-physarum-token":token},timeout:500},res=>{res.resume();resolve(res.statusCode===200 && res.headers["x-physarum-ready"]===token);});request.on("timeout",()=>request.destroy());request.on("error",()=>resolve(false));});
    if(ok)return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error("Локальний runtime не запустився вчасно. Закрийте програму й повторіть запуск.");
}
