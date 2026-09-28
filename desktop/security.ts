export function trustedFrame(url:string,origin:string,isMainFrame:boolean):boolean {
  try{const u=new URL(url);return isMainFrame && u.origin===origin && u.pathname==="/";}catch{return false;}
}
export function allowedExternal(url:string):boolean {
  try{const u=new URL(url);return u.protocol==="https:" && ["carto.com","www.openstreetmap.org","maplibre.org"].includes(u.hostname) && !u.username && !u.password;}catch{return false;}
}
export function validSession(requested:unknown,current:string):boolean {return typeof requested==="string" && Boolean(current) && requested===current;}
