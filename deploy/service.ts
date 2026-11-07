import node from "@prisma/composer/node";
import { compute } from "@prisma/composer-prisma-cloud";
import { postgres } from "@prisma/composer-prisma-cloud/orm";

import { appContract } from "./composer.ts";
import { appInput } from "./runtime-input.ts";

export default compute({
  name: "app",
  deps: { database: postgres(appContract) },
  input: appInput,
  build: node({ module: import.meta.url, entry: "../bundle/server/server.mjs" }),
});