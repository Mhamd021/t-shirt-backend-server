import { isBuiltin } from "node:module";
import { defineConfig } from "tsdown";

const optionalNest = [
  /^@nestjs\/microservices(?:\/|$)/,
  /^@nestjs\/platform-socket\.io(?:\/|$)/,
  /^@nestjs\/websockets(?:\/|$)/,
];

export default defineConfig({
 entry: { server: "deploy/launcher.ts" },
  outDir: "bundle",
  platform: "node",
  target: "node22.18",
  format: "esm",
  clean: true,
  hash: false,
  outputOptions: { codeSplitting: false },
  deps: {
    onlyBundle: false,
    alwaysBundle: (id) =>
      !isBuiltin(id) && !optionalNest.some((p) => p.test(id)),
    neverBundle: optionalNest,
  },
});