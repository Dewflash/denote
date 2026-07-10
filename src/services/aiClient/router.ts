// src/services/aiClient/router.ts — per-task routing table + the D18 privacy boundary.
//
// This is the ONE place a task is mapped to a backend, and the ONE place localOnly is enforced:
// if a note's vault is `localOnly`, a network-class backend (anthropic) is REFUSED here with a
// typed `local-only-blocked` error — no exceptions, regardless of the routing table. Content from
// a localOnly vault can therefore never reach a network backend, because it can never obtain one.
// (Pass 9 adds a second, independent check in the batch assembler — defense in depth, S27.)

import { DenoteError } from '../errors';
import type { AiBackendKind, AiClient, AiTask } from './types';

export type RoutingTable = Record<AiTask, AiBackendKind>;

/** Pass-06 default: everything routes to the local mock (apple lands pass 7, anthropic pass 9). */
export const DEFAULT_ROUTING: RoutingTable = {
  summarize: 'mock',
  enrich: 'mock',
  'label-similarity': 'mock',
  'deep-organize': 'mock',
};

export class AiRouter {
  private routing: RoutingTable;
  private readonly clients: Map<AiBackendKind, AiClient>;

  constructor(clients: Iterable<AiClient>, routing: RoutingTable = DEFAULT_ROUTING) {
    this.clients = new Map();
    for (const c of clients) this.clients.set(c.id, c);
    this.routing = { ...routing };
  }

  /** Register (or replace) a backend. Backends land over passes 6/7/9. */
  register(client: AiClient): void {
    this.clients.set(client.id, client);
  }

  has(kind: AiBackendKind): boolean {
    return this.clients.has(kind);
  }

  getRouting(): RoutingTable {
    return { ...this.routing };
  }

  setRouting(routing: RoutingTable): void {
    this.routing = { ...routing };
  }

  setTask(task: AiTask, backend: AiBackendKind): void {
    this.routing = { ...this.routing, [task]: backend };
  }

  /**
   * Resolve the backend for a task. Throws `ai-unavailable` if the routed backend isn't
   * registered, and `local-only-blocked` (D18) if the vault is localOnly and the routed backend
   * is network-class. A localOnly vault can NEVER obtain a network client through this method.
   */
  route(task: AiTask, opts: { localOnly: boolean }): AiClient {
    const kind = this.routing[task] ?? 'mock';
    const client = this.clients.get(kind);
    if (!client) {
      throw new DenoteError('ai-unavailable', `no AI backend registered for "${kind}"`, {
        retryable: false,
      });
    }
    if (client.isNetwork && opts.localOnly) {
      throw new DenoteError(
        'local-only-blocked',
        `task "${task}" is routed to network backend "${kind}", but this vault is local-only (D18)`,
        { retryable: false },
      );
    }
    return client;
  }
}
