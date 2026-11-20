import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextCalendarEventAlert, getNextReminderTime } from '../src/services/recurrence.js';

test('monthly reminders preserve their anchor day and clamp short months', () => {
  const reminder = {
    remind_at: '2026-01-31T08:00:00.000Z',
    recurrence_anchor_date: '2026-01-31',
    recurrence: 'monthly',
    local_time: '09:00',
    timezone: 'Africa/Lagos'
  };

  assert.equal(
    getNextReminderTime(reminder, new Date('2026-02-01T00:00:00.000Z')).toISOString(),
    '2026-02-28T08:00:00.000Z'
  );
});

test('yearly reminders restore leap-day dates after clamping non-leap years', () => {
  const reminder = {
    remind_at: '2024-02-29T08:00:00.000Z',
    recurrence_anchor_date: '2024-02-29',
    recurrence: 'yearly',
    local_time: '09:00',
    timezone: 'Africa/Lagos'
  };

  assert.equal(
    getNextReminderTime(reminder, new Date('2025-03-01T00:00:00.000Z')).toISOString(),
    '2026-02-28T08:00:00.000Z'
  );
});

test('recurring event alerts follow the event occurrence when its day is clamped', () => {
  const event = {
    starts_at: '2026-01-31T08:00:00.000Z',
    recurrence: 'monthly',
    timezone: 'Africa/Lagos',
    alert_enabled: true,
    alert_lead_minutes: 1440,
    recurrence_until: null
  };

  assert.equal(
    getNextCalendarEventAlert(event, new Date('2026-01-30T09:00:00.000Z')).toISOString(),
    '2026-02-27T08:00:00.000Z'
  );
});
