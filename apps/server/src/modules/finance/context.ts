import type { FastifyRequest } from 'fastify';
import { israelDate } from '../../lib/clock';
import type { Deps } from '../../deps';

export const todayOf = (deps: Deps) => israelDate(deps.clock.now());

export const userIdOf = (req: FastifyRequest) => req.auth?.user.id ?? null;

export const hasPerm = (req: FastifyRequest, p: string) => !!req.auth?.user.permissions.includes(p as never);
