import service from "./service.ts";
import { applyAppInput } from "./runtime-input.ts";

applyAppInput(service.input());
process.env.DATABASE_URL = service.load().database.url;

await import("../dist/main.js");