import { module } from "@prisma/composer";
import { cron, defineSchedule } from "@prisma/composer-prisma-cloud/cron";
import { postgres } from "@prisma/composer-prisma-cloud/orm";

import { appContract } from "./composer.ts";
import app from "./service.ts";
import cronRunner from "./order-cron-runner-service.ts";
import { appInputBindings } from "./runtime-input.ts";

const orderTickSchedule = defineSchedule({ orderTick: "1m" });
const orderTickCron = cron({
  schedule: orderTickSchedule,
  runner: cronRunner,
  input: appInputBindings,
});

export default module("t-shirt-backend-server", ({ provision }) => {
  const database = provision(
    postgres({ name: "database", contract: appContract, config: "./prisma.config.ts" }),
    { id: "database" },
  );
  provision(app, {
    deps: { database },
    input: appInputBindings,
  });
  provision(orderTickCron, { deps: { database } });
});