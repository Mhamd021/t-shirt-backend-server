import { secretString } from "@prisma/composer/arktype";
import {
  envParam,
  envSecret,
} from "@prisma/composer-prisma-cloud";
import { type } from "arktype";

export const appInput = type({
  JWT_SECRET: secretString(),
  CLOUDINARY_CLOUD_NAME: "string",
  CLOUDINARY_API_KEY: secretString(),
  CLOUDINARY_API_SECRET: secretString(),
  RESEND_API_KEY: secretString(),
  PRINTER_EMAIL: "string",
  REMOVEBG_API_KEY: secretString(),
  ORDER_POLLER_ENABLED: "string",
  GRACE_PERIOD_MS: "string",
  INTERNAL_TICK_SECRET: secretString(),
  TICK_BUDGET_MS: "string",
  OPENAI_API_KEY: secretString(),
});

export const appInputBindings = {
  JWT_SECRET: envSecret("JWT_SECRET"),
  CLOUDINARY_CLOUD_NAME: envParam("CLOUDINARY_CLOUD_NAME"),
  CLOUDINARY_API_KEY: envSecret("CLOUDINARY_API_KEY"),
  CLOUDINARY_API_SECRET: envSecret("CLOUDINARY_API_SECRET"),
  RESEND_API_KEY: envSecret("RESEND_API_KEY"),
  PRINTER_EMAIL: envParam("PRINTER_EMAIL"),
  REMOVEBG_API_KEY: envSecret("REMOVEBG_API_KEY"),
  ORDER_POLLER_ENABLED: envParam("ORDER_POLLER_ENABLED"),
  GRACE_PERIOD_MS: envParam("GRACE_PERIOD_MS"),
  INTERNAL_TICK_SECRET: envSecret("INTERNAL_TICK_SECRET"),
  TICK_BUDGET_MS: envParam("TICK_BUDGET_MS"),
  OPENAI_API_KEY: envSecret("OPENAI_API_KEY"),
};

export type AppInput = typeof appInput.infer;

export function applyAppInput(input: AppInput) {
  process.env.JWT_SECRET = input.JWT_SECRET.expose();
  process.env.CLOUDINARY_CLOUD_NAME = input.CLOUDINARY_CLOUD_NAME;
  process.env.CLOUDINARY_API_KEY = input.CLOUDINARY_API_KEY.expose();
  process.env.CLOUDINARY_API_SECRET = input.CLOUDINARY_API_SECRET.expose();
  process.env.RESEND_API_KEY = input.RESEND_API_KEY.expose();
  process.env.PRINTER_EMAIL = input.PRINTER_EMAIL;
  process.env.REMOVEBG_API_KEY = input.REMOVEBG_API_KEY.expose();
  process.env.ORDER_POLLER_ENABLED = input.ORDER_POLLER_ENABLED;
  process.env.GRACE_PERIOD_MS = input.GRACE_PERIOD_MS;
  process.env.INTERNAL_TICK_SECRET = input.INTERNAL_TICK_SECRET.expose();
  process.env.TICK_BUDGET_MS = input.TICK_BUDGET_MS;
  process.env.OPENAI_API_KEY = input.OPENAI_API_KEY.expose();
}
