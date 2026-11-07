import { isBuiltin } from "node:module";
import { defineConfig } from "tsdown";

const optionalNest = [
  /^@nestjs\/microservices(?:\/|$)/,
  /^@nestjs\/platform-socket\.io(?:\/|$)/,
  /^@nestjs\/websockets(?:\/|$)/,
];

const shared = {
  platform: "node" as const,
  target: "node22.18",
  format: "esm" as const,
  clean: true,
  hash: false,
  outputOptions: { codeSplitting: false },
  deps: {
    onlyBundle: false,
    alwaysBundle: (id: string) =>
      !isBuiltin(id) && !optionalNest.some((p) => p.test(id)),
    neverBundle: optionalNest,
  },
};

export default [
  defineConfig({
    ...shared,
    entry: { server: "deploy/launcher.ts" },
    outDir: "bundle/server",
  }),
  defineConfig({
    ...shared,
    entry: { "cron-runner": "deploy/order-cron-runner.ts" },
    outDir: "bundle/cron",
  }),
];