import service from "./service.ts";

try {
  process.env.DATABASE_URL = service.load().database.url;
} catch {
 
}

await import("../dist/main.js");