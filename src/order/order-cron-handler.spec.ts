import { createOrderTickHandlers } from "./order-cron-handler";

describe("order tick cron handler", () => {
  it("maps orderTick to one notifier cycle using the configured budget", async () => {
    const result = { claimed: 0, swept: 0, stoppedBy: "drained" as const };
    const notifier = { runCycle: jest.fn().mockResolvedValue(result) };
    const handlers = createOrderTickHandlers(notifier, () => "30000");

    expect(Object.keys(handlers)).toEqual(["orderTick"]);
    await expect(handlers.orderTick()).resolves.toEqual(result);
    expect(notifier.runCycle).toHaveBeenCalledTimes(1);
    expect(notifier.runCycle).toHaveBeenCalledWith(30_000);
  });

  it("caps the configured budget before invoking the notifier", async () => {
    const notifier = {
      runCycle: jest
        .fn()
        .mockResolvedValue({ claimed: 0, swept: 0, stoppedBy: "drained" as const }),
    };
    const handlers = createOrderTickHandlers(notifier, () => "999999");

    await handlers.orderTick();

    expect(notifier.runCycle).toHaveBeenCalledWith(45_000);
  });
});
