import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

/**
 * Wrap fetch so that Turso HTTP responses containing bare NaN/Infinity
 * (invalid JSON) are sanitized before `resp.json()` is called.
 * Bun on macOS uses NSJSONSerialization which hard-rejects these tokens.
 */
export function sanitizingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init).then((resp) => {
    const patched = new Proxy(resp, {
      get(target, prop, receiver) {
        if (prop === "json") {
          return async () => {
            const text = await target.text();
            const sanitized = text.replace(/\bNaN\b/g, "null").replace(/\b-?Infinity\b/g, "null");
            return JSON.parse(sanitized);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return patched;
  });
}

export function createDb(url: string, authToken?: string) {
  const isHttp =
    url.startsWith("libsql://") || url.startsWith("https://") || url.startsWith("http://");
  const client = createClient({
    url,
    authToken: authToken || undefined,
    ...(isHttp ? { fetch: sanitizingFetch } : {}),
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
