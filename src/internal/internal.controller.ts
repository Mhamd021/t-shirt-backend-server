import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OrderNotifierService } from "../order/order-notifier-service";
import { getTickBudgetMs } from "../order/order.constants";
import { InternalSecretGuard } from "./internal-secret.guard";

@Controller('internal')
export class InternalController {
  constructor(
    private readonly notifier: OrderNotifierService,
    private readonly config: ConfigService,
  ) {}

  @UseGuards(InternalSecretGuard)
  @Post('tick')
  @HttpCode(200)
  tick() {
    const budgetMs = getTickBudgetMs(this.config.get('TICK_BUDGET_MS'));
    return this.notifier.runCycle(budgetMs);
  }
}