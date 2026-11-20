import cron from 'node-cron';
import { config } from '../config/env.js';

const checkinPrompts = {
  morning: 'Good morning. What would make today feel like a good day, and what is your top priority?',
  daytime: 'Quick daytime check-in: how are you doing, and is there anything you want to refocus or adjust?',
  evening: 'Evening check-in: what went well today, and what would you like to carry forward to tomorrow?'
};

export function getLocalDateAndTime(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    localDate: `${values.year}-${values.month}-${values.day}`,
    localTime: `${values.hour}:${values.minute}`
  };
}

export function isCheckinDueNow(localTime, scheduledTime, graceMinutes = 4) {
  const toMinutes = time => {
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
  };
  const minutesLate = toMinutes(localTime) - toMinutes(scheduledTime);
  return minutesLate >= 0 && minutesLate <= graceMinutes;
}

export function createCheckinMessage(checkinType, tasks) {
  const taskLines = tasks.slice(0, 3).map(task => `• ${task.title}`);
  const tasksSection = taskLines.length
    ? `\n\nYour open tasks:\n${taskLines.join('\n')}`
    : '';
  return `${checkinPrompts[checkinType]}${tasksSection}`;
}

export function formatReminderTime(remindAt, timezone = 'Africa/Lagos') {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(remindAt));
}

export function createReminderMessage(reminder, now = new Date()) {
  const scheduledAt = new Date(reminder.remind_at);
  const wasLate = now.getTime() - scheduledAt.getTime() > 60_000;
  const lateNote = wasLate
    ? ` (this was scheduled for ${formatReminderTime(reminder.remind_at, reminder.timezone)})`
    : '';
  const label = reminder.kind === 'alarm' ? '⏰ Alarm' : '🔔 Reminder';
  return `${label}: ${reminder.title}${lateNote}`;
}

export async function runReminderTick({ allowedJids, dataService, getSocket, now = new Date() }) {
  const sock = getSocket();
  if (!sock) return;

  try {
    await dataService.recoverStuckReminders(new Date(now.getTime() - 5 * 60 * 1000), allowedJids);
    const dueReminders = await dataService.getDueReminders(now, allowedJids);

    for (const reminder of dueReminders) {
      if (!allowedJids.includes(reminder.user_jid)) continue;

      try {
        const claimed = await dataService.claimReminder(reminder.id);
        if (!claimed) continue;

        await sock.sendMessage(reminder.user_jid, {
          text: createReminderMessage(reminder, now)
        });
        await dataService.finishReminder(reminder, null, now);
        console.log(`Delivered a scheduled ${reminder.kind} to an authorized user.`);
      } catch (error) {
        console.error(`Could not deliver a scheduled reminder (${reminder.id}):`, error);
        try {
          await dataService.finishReminder(reminder, error, now);
        } catch (recordError) {
          console.error(`Could not record reminder delivery failure (${reminder.id}):`, recordError);
        }
      }
    }
  } catch (error) {
    console.error('Could not process scheduled reminders:', error);
  }
}

export async function runCheckinTick({ allowedJids, dataService, getSocket, now = new Date() }) {
  for (const userJid of allowedJids) {
    let settings;
    try {
      settings = await dataService.getCheckinSettings(userJid);
    } catch (error) {
      console.error(`Could not load check-in settings for ${userJid}:`, error);
      continue;
    }

    for (const setting of settings) {
      const { localDate, localTime } = getLocalDateAndTime(now, setting.timezone);
      if (!isCheckinDueNow(localTime, setting.local_time)) continue;

      const sock = getSocket();
      if (!sock) continue;

      let claimed;
      try {
        claimed = await dataService.claimCheckin(userJid, setting.checkin_type, localDate);
      } catch (error) {
        console.error(`Could not claim ${setting.checkin_type} check-in for ${userJid}:`, error);
        continue;
      }
      if (!claimed) continue;

      try {
        const tasks = await dataService.listTasks(userJid);
        await sock.sendMessage(
          userJid,
          { text: createCheckinMessage(setting.checkin_type, tasks) }
        );
        await dataService.finishCheckin(userJid, setting.checkin_type, localDate);
        console.log(`Sent ${setting.checkin_type} check-in to ${userJid} for ${localDate}.`);
      } catch (error) {
        console.error(`Could not send ${setting.checkin_type} check-in to ${userJid}:`, error);
        try {
          await dataService.finishCheckin(userJid, setting.checkin_type, localDate, error);
        } catch (recordError) {
          console.error(`Could not record failed check-in for ${userJid}:`, recordError);
        }
      }
    }
  }
}

export function startCheckinScheduler({ allowedJids, dataService, getSocket }) {
  return cron.schedule('* * * * *', async () => {
    await runCheckinTick({ allowedJids, dataService, getSocket });
    await runReminderTick({ allowedJids, dataService, getSocket });
  }, { noOverlap: true });
}

export function getDefaultCheckinSettings() {
  return [
    { checkin_type: 'morning', local_time: config.checkins.morning, timezone: config.checkins.timezone, enabled: true },
    { checkin_type: 'daytime', local_time: config.checkins.daytime, timezone: config.checkins.timezone, enabled: true },
    { checkin_type: 'evening', local_time: config.checkins.evening, timezone: config.checkins.timezone, enabled: true }
  ];
}
