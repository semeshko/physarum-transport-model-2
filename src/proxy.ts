import {NextRequest,NextResponse} from "next/server";

export function proxy(request:NextRequest){
  const token=process.env.PHYSARUM_DESKTOP_TOKEN;
  if(!token)return NextResponse.next();
  const origin=`http://127.0.0.1:${process.env.PORT}`;
  if(request.headers.get("x-physarum-token")!==token || (request.headers.has("origin") && request.headers.get("origin")!==origin))return new NextResponse("Forbidden",{status:403});
  const nonce=Buffer.from(crypto.randomUUID()).toString("base64");
  const csp=`default-src 'self'; script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com; font-src 'self'; connect-src 'self' https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`;
  const headers=new Headers(request.headers);headers.set("Content-Security-Policy",csp);
  const response=NextResponse.next({request:{headers}});response.headers.set("Content-Security-Policy",csp);response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Referrer-Policy","no-referrer");return response;
}
