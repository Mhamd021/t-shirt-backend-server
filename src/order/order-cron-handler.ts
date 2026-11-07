import { Logger } from "@nestjs/common";
import { OrderNotifierService } from "./order-notifier-service";
import { getTickBudgetMs } from "./order.constants";

export function createOrderTickHandlers(
  notifier: Pick<OrderNotifierService, "runCycle">,
  getBudget: () => string | undefined,
) {
  const logger = new Logger("OrderCronRunner");

  return {
    orderTick: async () => {
      const budgetMs = getTickBudgetMs(getBudget());
      logger.log(`Composer orderTick started (budgetMs=${budgetMs})`);
      const result = await notifier.runCycle(budgetMs);
      logger.log(
        `Composer orderTick completed (claimed=${result.claimed}, swept=${result.swept}, stoppedBy=${result.stoppedBy})`,
      );
      return result;
    },
  };
}
