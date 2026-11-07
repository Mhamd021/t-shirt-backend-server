import node from "@prisma/composer/node";
import { compute } from "@prisma/composer-prisma-cloud";
import { triggerContract } from "@prisma/composer-prisma-cloud/cron";
import { postgres } from "@prisma/composer-prisma-cloud/orm";

import { appContract } from "./composer.ts";
import { appInput } from "./runtime-input.ts";

export default compute({
  name: "order-tick-runner",
  deps: { database: postgres(appContract) },
  input: appInput,
  expose: { trigger: triggerContract },
  build: node({
    module: import.meta.url,
    entry: "../bundle/cron/cron-runner.mjs",
  }),
});
