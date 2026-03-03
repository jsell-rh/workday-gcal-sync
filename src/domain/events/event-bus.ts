import type { DomainEvent } from './domain-events';

export type DomainEventHandler = (event: DomainEvent) => void;

export interface EventBus {
  publish(event: DomainEvent): void;
  subscribe(handler: DomainEventHandler): () => void;
}

export function createEventBus(): EventBus {
  const handlers: Set<DomainEventHandler> = new Set();

  return {
    publish(event: DomainEvent): void {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error('[EventBus] Handler error:', error);
        }
      }
    },
    subscribe(handler: DomainEventHandler): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
