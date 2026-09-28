import https from "node:https";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import { version as applicationVersion, name as applicationName } from "../../package.json";
import type { GISBounds } from "../gis/types";
import {
  classifyOverpassStatus,
  createQuery,
  OSM_EMPTY_MESSAGES,
  OSMRequestError,
  validateOverpassPayload,
  type OSMQueryKind,
} from "./query";

/**
 * SERVER-ONLY Overpass client.
 *
 * ## Why this exists
 *
 * Until Task 18C.1 the Overpass request was issued from `MapWorkspace`, a
 * `"use client"` component, so it left the browser. OSM community endpoints
 * reject unidentified and browser-like clients, and a browser cannot help:
 * `User-Agent` is a forbidden header name, so page JavaScript is unable to
 * identify itself no matter what it sets. Every request therefore arrived with
 * a Chrome UA and came back **HTTP 406**.
 *
 * Measured against overpass-api.de with one query at one moment:
 *
 *   User-Agent: physarum-transport-model/2.0 (+repo)  -> 200, 127 KB, 1.4 s
 *   User-Agent: Mozilla/5.0 physarum-transport-model  -> 406, 371 B, 0.1 s
 *
 * So the fix is architectural, not a header tweak on the existing call: the
 * request has to originate on the server.
 *
 * ## Attribution
 *
 * The transport shape here — `https.get`/`request` with an identifying
 * User-Agent, explicit timeout, and content-encoding decoding — is adapted
 * from `src/lib/httpJson.ts` in the `osiris-physarum-reference` donor
 * repository, which documents the same OSM 406/429 behaviour. Only that
 * pattern was taken; none of the donor's routing or provider code is used.
 */

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
] as const;

export const OSM_REQUEST_TIMEOUT_MILLISECONDS = 25_000;
/** Overpass can stream a lot; stop reading long before it can exhaust memory. */
export const OSM_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * Identity sent to OSM community services.
 *
 * Built from package.json plus an optional contact URL, so it stays correct
 * when the app is renamed or versioned. `OSM_CONTACT_URL` lets a deployment
 * supply its own contact address as the usage policies ask; it is read on the
 * server only and never reaches a client bundle.
 */
export function overpassUserAgent(contact = process.env.OSM_CONTACT_URL ?? "https://github.com/semeshko/physarum-transport-model-2"): string {
  return `${applicationName}/${applicationVersion} (+${contact})`;
}

type RawResponse = { status: number; headers: NodeJS.Dict<string | string[]>; body: string };

function post(endpoint: string, body: string, timeoutMilliseconds: number, signal?: AbortSignal): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OSMRequestError("aborted", "The previous OSM request was cancelled."));
      return;
    }
    const request = https.request(
      endpoint,
      {
        method: "POST",
        headers: {
          "User-Agent": overpassUserAgent(),
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate, br",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: timeoutMilliseconds,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 400) {
          response.resume();
          reject(classifyOverpassStatus(status));
          return;
        }
        // Decode by the header the host actually sent, not by what we asked for.
        const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
        let stream: Readable = response;
        if (encoding === "gzip") stream = response.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = response.pipe(zlib.createInflate());
        else if (encoding === "br") stream = response.pipe(zlib.createBrotliDecompress());

        let text = "", bytes = 0;
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > OSM_MAX_RESPONSE_BYTES) {
            request.destroy();
            reject(new OSMRequestError("oversized", "The OSM service returned more data than this area should produce. Select a smaller area."));
            return;
          }
          text += chunk;
        });
        stream.on("error", reject);
        stream.on("end", () => resolve({ status, headers: response.headers, body: text }));
      },
    );
    request.on("timeout", () => { request.destroy(); reject(new OSMRequestError("timeout", "The OSM request timed out. Select a smaller area or try again.")); });
    request.on("error", (error) => reject(error instanceof OSMRequestError ? error : new OSMRequestError("network", "Could not reach the OSM service. Check your connection and try again.")));
    const abort = () => request.destroy(new OSMRequestError("aborted", "The previous OSM request was cancelled."));
    signal?.addEventListener("abort", abort, { once: true });
    request.on("close", () => signal?.removeEventListener("abort", abort));
    request.write(body);
    request.end();
  });
}

export type OverpassTransport = (endpoint: string, body: string, timeoutMilliseconds: number, signal?: AbortSignal) => Promise<RawResponse>;

export type OverpassRequestOptions = {
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds?: number;
  /** Injected in tests so no unit test depends on a public instance. */
  readonly transport?: OverpassTransport;
};

export type OverpassResult = { readonly payload: unknown; readonly endpoint: string; readonly fetchedAt: string; readonly elapsedMilliseconds: number; readonly bytes: number; readonly elementCount: number };

/** A wall-clock deadline includes DNS, connection setup and a trickling body. */
async function providerAttempt(transport: OverpassTransport, endpoint: string, body: string, timeout: number, signal?: AbortSignal): Promise<RawResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancelled: (error: OSMRequestError) => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const stop = (error: OSMRequestError) => { rejectCancelled(error); controller.abort(); };
  const abort = () => stop(new OSMRequestError("aborted", "The previous OSM request was cancelled."));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) { abort(); return await cancelled; }
    timer = setTimeout(() => stop(new OSMRequestError("timeout", "The OSM provider exceeded its time limit.")), timeout);
    return await Promise.race([transport(endpoint, body, timeout, controller.signal), cancelled]);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Small server-side cache.
 *
 * The same small AOI is re-requested constantly while a user experiments with
 * the UI, and the public instances are volunteer-run. This is deliberately not
 * a persistent OSM cache: a handful of entries, a short life, cleared by
 * process restart.
 */
const CACHE_LIMIT = 16;
const CACHE_TTL_MILLISECONDS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; result: OverpassResult }>();

export function clearOverpassCache(): void { cache.clear(); }

export async function requestOverpass(kind: OSMQueryKind, bounds: GISBounds, options: OverpassRequestOptions = {}): Promise<OverpassResult & { cached: boolean }> {
  if (options.signal?.aborted) throw new OSMRequestError("aborted", "The previous OSM request was cancelled.");
  const query = createQuery(kind, bounds);
  const key = `${kind}|${query}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MILLISECONDS) return { ...hit.result, cached: true };

  const body = new URLSearchParams({ data: query }).toString();
  const transport = options.transport ?? post;
  const timeout = options.timeoutMilliseconds ?? OSM_REQUEST_TIMEOUT_MILLISECONDS;
  let lastFailure: OSMRequestError | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (options.signal?.aborted) throw new OSMRequestError("aborted", "The previous OSM request was cancelled.");
    const started = Date.now();
    try {
      const response = await providerAttempt(transport, endpoint, body, timeout, options.signal);
      if (options.signal?.aborted) throw new OSMRequestError("aborted", "The previous OSM request was cancelled.");
      if (response.status >= 400) throw classifyOverpassStatus(response.status);
      let parsed: unknown;
      try { parsed = JSON.parse(response.body); }
      catch { throw new OSMRequestError("remote", "The OSM service returned an unexpected response format."); }
      const payload = validateOverpassPayload(parsed, OSM_EMPTY_MESSAGES[kind], kind === "context");
      const result: OverpassResult = {
        payload,
        endpoint,
        fetchedAt: new Date().toISOString(),
        elapsedMilliseconds: Date.now() - started,
        bytes: Buffer.byteLength(response.body),
        elementCount: (payload as { elements: unknown[] }).elements.length,
      };
      cache.set(key, { at: Date.now(), result });
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      return { ...result, cached: false };
    } catch (error) {
      // An empty or oversized answer is the area's fault, not the endpoint's:
      // trying the next mirror would return the same thing.
      if (error instanceof OSMRequestError && (error.code === "empty" || error.code === "oversized" || error.code === "aborted")) throw error;
      lastFailure = error instanceof OSMRequestError ? error : new OSMRequestError("network", "Could not reach the OSM service. Check your connection and try again.");
    }
  }
  throw lastFailure ?? new OSMRequestError("network", "Could not reach an OSM service endpoint.");
}
