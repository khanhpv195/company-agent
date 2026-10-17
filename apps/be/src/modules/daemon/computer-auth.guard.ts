import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { API_KEY_PREFIX, hashApiKey } from '../computers/computers.service';
import { Computer } from '../computers/entities/computer.entity';

/**
 * Authenticates a daemon by its `Bearer agk_...` API key (looked up by sha256, never compared
 * in plaintext). A JWT or any other token does not carry the prefix and is rejected. Routes use
 * it together with `@Public()`, which only opts them out of the member JWT guard.
 */
@Injectable()
export class ComputerAuthGuard implements CanActivate {
  constructor(@InjectRepository(Computer) private readonly computers: Repository<Computer>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token?.startsWith(API_KEY_PREFIX)) {
      throw this.unauthorized();
    }
    const computer = await this.computers.findOne({
      where: { apiKeyHash: hashApiKey(token) },
      select: { id: true, workspaceId: true },
    });
    if (!computer) throw this.unauthorized();
    request.computer = { id: computer.id, workspaceId: computer.workspaceId };
    return true;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({ message: 'gateway.INVALID_API_KEY' });
  }
}
