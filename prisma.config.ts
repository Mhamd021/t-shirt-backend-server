import "dotenv/config";
import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";
import { defineConfig as composer } from "@prisma/composer/config";
import { prismaCloud, prismaState } from "@prisma/composer-prisma-cloud/control";
import { nodeBuild } from "@prisma/composer/node/control";


export default definePrismaConfig({
  orm: definePostgresConfig({
    contract: "prisma8/contract.prisma",
    output: "src/generated/prisma8",
    db: {
      connection: process.env["DATABASE_URL"],
    },
  }),
  composer: composer({
  extensions: [prismaCloud({ region: "us-east-1" }), nodeBuild()],
  state: prismaState(),
}),
});