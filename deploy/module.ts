import { module } from "@prisma/composer";
import { postgres } from "@prisma/composer-prisma-cloud/orm";

import { appContract } from "./composer.ts";
import app from "./service.ts";

export default module("t-shirt-backend-test", ({ provision }) => {
  const database = provision(
    postgres({ name: "database", contract: appContract, config: "./prisma.config.ts" }),
    { id: "database" },
  );
  provision(app, { deps: { database } });
});