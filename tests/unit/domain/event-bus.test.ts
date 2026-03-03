import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../../../src/domain/events/event-bus';
import { createDomainEvent } from '../../../src/domain/events/domain-events';
import type { DomainEvent } from '../../../src/domain/events/domain-events';

describe('createEventBus', () => {
  function makeSyncStartedEvent(): DomainEvent {
    return createDomainEvent('SyncStarted', { source: 'workday' });
  }

  it('publish sends events to all subscribers', () => {
    const bus = createEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.subscribe(handler1);
    bus.subscribe(handler2);

    const event = makeSyncStartedEvent();
    bus.publish(event);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledWith(event);
  });

  it('subscribe returns an unsubscribe function', () => {
    const bus = createEventBus();
    const handler = vi.fn();

    const unsubscribe = bus.subscribe(handler);
    expect(typeof unsubscribe).toBe('function');

    unsubscribe();
    bus.publish(makeSyncStartedEvent());

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribed handlers do not receive events', () => {
    const bus = createEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const unsub1 = bus.subscribe(handler1);
    bus.subscribe(handler2);

    unsub1();
    bus.publish(makeSyncStartedEvent());

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('handler errors do not break other handlers', () => {
    const bus = createEventBus();
    const errorHandler = vi.fn(() => {
      throw new Error('handler blew up');
    });
    const goodHandler = vi.fn();

    // Suppress console.error from event bus error handling
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    bus.subscribe(errorHandler);
    bus.subscribe(goodHandler);

    const event = makeSyncStartedEvent();
    bus.publish(event);

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledWith(event);

    consoleSpy.mockRestore();
  });

  it('publish with no subscribers does not throw', () => {
    const bus = createEventBus();
    expect(() => bus.publish(makeSyncStartedEvent())).not.toThrow();
  });
});
