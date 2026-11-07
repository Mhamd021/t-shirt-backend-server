import { createServer } from "node:http";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { serveSchedule, defineSchedule } from "@prisma/composer-prisma-cloud/cron";

import { AppModule } from "../src/app.module";
import { OrderNotifierService } from "../src/order/order-notifier-service";
import { createOrderTickHandlers } from "../src/order/order-cron-handler";
import { applyAppInput } from "./runtime-input.ts";
import runner from "./order-cron-runner-service.ts";

applyAppInput(runner.input());
process.env.DATABASE_URL = runner.load().database.url;

const app = await NestFactory.createApplicationContext(AppModule);
const notifier = app.get(OrderNotifierService);
const config = app.get(ConfigService);
const schedule = defineSchedule({ orderTick: "1m" });
const handlers = createOrderTickHandlers(
  notifier,
  () => config.get<string>("TICK_BUDGET_MS"),
);
const handleSchedule = serveSchedule(runner, schedule, handlers);

const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") {
        headers.set(name, value);
      } else if (Array.isArray(value)) {
        headers.set(name, value.join(", "));
      }
    }

    const method = request.method ?? "GET";
    const body = Buffer.concat(chunks).toString("utf8");
    const input = new Request(
      new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`),
      {
        method,
        headers,
        body: method === "GET" || method === "HEAD" || body.length === 0 ? undefined : body,
      },
    );
    const output = await handleSchedule(input);

    response.statusCode = output.status;
    output.headers.forEach((value, name) => response.setHeader(name, value));
    response.end(await output.text());
  } catch (error) {
    console.error("Cron runner request failed", error);
    response.statusCode = 500;
    response.end("Internal Server Error");
  }
});

server.listen(runner.port(), "0.0.0.0");
