export const dynamic="force-dynamic";
export async function GET(request:Request){
  const token=process.env.PHYSARUM_DESKTOP_TOKEN;
  if(!token || request.headers.get("x-physarum-token")!==token)return new Response("Forbidden",{status:403});
  return new Response("ready",{headers:{"x-physarum-ready":token,"cache-control":"no-store"}});
}
