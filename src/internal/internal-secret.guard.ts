import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

@Injectable()
export class InternalSecretGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService) {
    const secret = config.getOrThrow<string>('INTERNAL_TICK_SECRET');
    if (secret.length < 32) {
      throw new Error('INTERNAL_TICK_SECRET must be at least 32 characters');
    }
    this.expected = digest(secret);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['x-internal-secret'];
    if (typeof header !== 'string' || !timingSafeEqual(digest(header), this.expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}