import { dataContract } from "@prisma/composer-prisma-cloud/orm";

import type { Contract } from "../src/generated/prisma8/contract.d.ts";
import contractJson from "../src/generated/prisma8/contract.json" with { type: "json" };

export const appContract = dataContract<Contract>(contractJson);