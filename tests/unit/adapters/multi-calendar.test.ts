import { describe, it, expect, vi } from 'vitest';
import { createMultiCalendarTarget } from '../../../src/adapters/google-calendar/multi-calendar';
import type { CalendarTarget } from '../../../src/domain/ports/calendar-target';
import type { CalendarEvent } from '../../../src/domain/model/calendar-event';

function createMockTarget(eventId = 'event-id'): CalendarTarget {
  return {
    createEvent: vi.fn(async () => eventId),
    eventExists: vi.fn(async () => false),
    deleteEvent: vi.fn(async () => {}),
  };
}

const testEvent: CalendarEvent = {
  summary: 'PTO - Paid Time Off (PTO)',
  description: 'Auto-synced from Workday. 8 hours.',
  startDate: '2025-03-15',
  endDate: '2025-03-16',
  isAllDay: true,
  visibility: 'busy',
};

describe('MultiCalendarTarget', () => {
  it('throws if no targets provided', () => {
    expect(() => createMultiCalendarTarget([])).toThrow('At least one calendar target is required');
  });

  it('creates events on all targets and returns composite ID', async () => {
    const target1 = createMockTarget('id-1');
    const target2 = createMockTarget('id-2');
    const multi = createMultiCalendarTarget([target1, target2]);

    const id = await multi.createEvent(testEvent);

    expect(id).toBe('id-1|id-2');
    expect(target1.createEvent).toHaveBeenCalledWith(testEvent);
    expect(target2.createEvent).toHaveBeenCalledWith(testEvent);
  });

  it('skips creation on calendars where event already exists', async () => {
    const target1 = createMockTarget('id-1');
    const target2 = createMockTarget('id-2');
    // target1 already has the event
    (target1.eventExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    target1.findEventByDate = vi.fn(async () => 'existing-id-1');
    const multi = createMultiCalendarTarget([target1, target2]);

    const id = await multi.createEvent(testEvent);

    expect(id).toBe('existing-id-1|id-2');
    expect(target1.createEvent).not.toHaveBeenCalled();
    expect(target2.createEvent).toHaveBeenCalledWith(testEvent);
  });

  it('checks eventExists on all targets — returns true only if all have it', async () => {
    const target1 = createMockTarget();
    const target2 = createMockTarget();
    (target1.eventExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (target2.eventExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const multi = createMultiCalendarTarget([target1, target2]);

    const exists = await multi.eventExists('2025-03-15', 'PTO');

    expect(exists).toBe(true);
    expect(target1.eventExists).toHaveBeenCalledWith('2025-03-15', 'PTO');
    expect(target2.eventExists).toHaveBeenCalledWith('2025-03-15', 'PTO');
  });

  it('checks eventExists on all targets — returns false if any is missing', async () => {
    const target1 = createMockTarget();
    const target2 = createMockTarget();
    (target1.eventExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (target2.eventExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const multi = createMultiCalendarTarget([target1, target2]);

    const exists = await multi.eventExists('2025-03-15', 'PTO');

    expect(exists).toBe(false);
    expect(target1.eventExists).toHaveBeenCalledWith('2025-03-15', 'PTO');
    expect(target2.eventExists).toHaveBeenCalledWith('2025-03-15', 'PTO');
  });

  it('deletes events from all targets using composite ID', async () => {
    const target1 = createMockTarget();
    const target2 = createMockTarget();
    const multi = createMultiCalendarTarget([target1, target2]);

    await multi.deleteEvent('id-1|id-2');

    expect(target1.deleteEvent).toHaveBeenCalledWith('id-1');
    expect(target2.deleteEvent).toHaveBeenCalledWith('id-2');
  });

  it('handles single target as pass-through', async () => {
    const target = createMockTarget('single-id');
    const multi = createMultiCalendarTarget([target]);

    const id = await multi.createEvent(testEvent);
    expect(id).toBe('single-id');

    await multi.deleteEvent('single-id');
    expect(target.deleteEvent).toHaveBeenCalledWith('single-id');
  });

  it('handles more targets than IDs in composite delete gracefully', async () => {
    const target1 = createMockTarget();
    const target2 = createMockTarget();
    const target3 = createMockTarget();
    const multi = createMultiCalendarTarget([target1, target2, target3]);

    // Only 2 IDs but 3 targets — should only delete from first 2
    await multi.deleteEvent('id-1|id-2');

    expect(target1.deleteEvent).toHaveBeenCalledWith('id-1');
    expect(target2.deleteEvent).toHaveBeenCalledWith('id-2');
    expect(target3.deleteEvent).not.toHaveBeenCalled();
  });
});
