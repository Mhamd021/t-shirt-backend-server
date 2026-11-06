import { Module } from "@nestjs/common";
import { OrderModule } from "../order/order.module";
import { InternalController } from "./internal.controller";
import { InternalSecretGuard } from "./internal-secret.guard";

@Module({
  imports: [OrderModule],           
  controllers: [InternalController],
  providers: [InternalSecretGuard],
})
export class InternalModule {}