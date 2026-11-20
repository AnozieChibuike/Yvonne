export class YvonneDataService {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async listTasks(userJid, includeCompleted = false) {
    let query = this.supabase
      .from('tasks')
      .select('id, title, notes, status, due_at, created_at')
      .eq('user_jid', userJid)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(50);

    if (!includeCompleted) query = query.eq('status', 'open');
    return this.unwrap(await query, 'list tasks');
  }

  async addTask(userJid, title, notes = '', dueAt = null) {
    const data = this.unwrap(await this.supabase
      .from('tasks')
      .insert({
        user_jid: userJid,
        title: title.trim(),
        notes: notes.trim(),
        due_at: dueAt || null
      })
      .select('id, title, notes, status, due_at')
      .single(), 'add task');
    return data;
  }

  async completeTask(userJid, taskId) {
    return this.unwrap(await this.supabase
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_jid', userJid)
      .eq('id', taskId)
      .eq('status', 'open')
      .select('id, title, status')
      .single(), 'complete task');
  }

  async deleteTask(userJid, taskId) {
    this.unwrap(await this.supabase
      .from('tasks')
      .delete()
      .eq('user_jid', userJid)
      .eq('id', taskId)
      .select('id')
      .single(), 'delete task');
    return true;
  }

  async listPreferences(userJid) {
    return this.unwrap(await this.supabase
      .from('user_preferences')
      .select('preference_key, preference_value, updated_at')
      .eq('user_jid', userJid)
      .order('preference_key'), 'list preferences');
  }

  async listMemories(userJid) {
    return this.unwrap(await this.supabase
      .from('profile_memories')
      .select('memory_key, memory_value, status, updated_at')
      .eq('user_jid', userJid)
      .order('updated_at', { ascending: false }), 'list saved memories');
  }

  async proposeMemory(userJid, key, value) {
    const pending = await this.getPendingMemory(userJid);
    if (pending && pending.memory_key !== key.trim()) {
      throw new Error('Resolve the existing memory proposal before creating another one.');
    }
    return this.unwrap(await this.supabase
      .from('profile_memories')
      .upsert({
        user_jid: userJid,
        memory_key: key.trim(),
        memory_value: value.trim(),
        status: 'proposed',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_jid,memory_key' })
      .select('memory_key, memory_value, status')
      .single(), 'propose saved memory');
  }

  async rememberMemory(userJid, key, value) {
    return this.unwrap(await this.supabase
      .from('profile_memories')
      .upsert({
        user_jid: userJid,
        memory_key: key.trim(),
        memory_value: value.trim(),
        status: 'confirmed',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_jid,memory_key' })
      .select('memory_key, memory_value, status')
      .single(), 'save confirmed memory');
  }

  async getPendingMemory(userJid) {
    return this.unwrap(await this.supabase
      .from('profile_memories')
      .select('memory_key, memory_value')
      .eq('user_jid', userJid)
      .eq('status', 'proposed')
      .maybeSingle(), 'load pending saved memory');
  }

  async resolvePendingMemory(userJid, accept) {
    const pending = await this.getPendingMemory(userJid);
    if (!pending) return null;
    const status = accept ? 'confirmed' : 'rejected';
    return this.unwrap(await this.supabase
      .from('profile_memories')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('user_jid', userJid)
      .eq('memory_key', pending.memory_key)
      .eq('status', 'proposed')
      .select('memory_key, memory_value, status')
      .single(), 'resolve saved memory');
  }

  async forgetMemory(userJid, key) {
    const memory = this.unwrap(await this.supabase
      .from('profile_memories')
      .delete()
      .eq('user_jid', userJid)
      .eq('memory_key', key.trim())
      .select('memory_key')
      .maybeSingle(), 'forget saved memory');
    const preference = this.unwrap(await this.supabase
      .from('user_preferences')
      .delete()
      .eq('user_jid', userJid)
      .eq('preference_key', key.trim())
      .select('preference_key')
      .maybeSingle(), 'forget saved preference');
    return memory || preference;
  }

  async ensureUserProfile(userJid) {
    return this.unwrap(await this.supabase
      .from('user_profiles')
      .upsert({ user_jid: userJid }, {
        onConflict: 'user_jid',
        ignoreDuplicates: true
      }), 'initialize user profile');
  }

  async getUserProfile(userJid) {
    return this.unwrap(await this.supabase
      .from('user_profiles')
      .select('onboarding_status, onboarding_step, pending_onboarding_step, pending_onboarding_answer')
      .eq('user_jid', userJid)
      .single(), 'load user profile');
  }

  async saveOnboardingAnswer(userJid, step, answer) {
    const profile = await this.getUserProfile(userJid);
    if (profile.onboarding_status !== 'in_progress' || profile.onboarding_step !== step) {
      throw new Error('Onboarding changed before the answer could be staged. Please retry.');
    }
    if (!answer.trim()) throw new Error('Onboarding answers cannot be empty.');
    const nextStep = step + 1;
    const staged = this.unwrap(await this.supabase
      .from('user_profiles')
      .update({
        pending_onboarding_step: step,
        pending_onboarding_answer: answer.trim(),
        updated_at: new Date().toISOString()
      })
      .eq('user_jid', userJid)
      .eq('onboarding_status', 'in_progress')
      .eq('onboarding_step', step)
      .is('pending_onboarding_step', null)
      .select('user_jid')
      .maybeSingle(), 'stage onboarding answer');
    if (!staged) throw new Error('The onboarding answer could not be staged. Please retry.');

    return {
      status: 'awaiting_confirmation',
      nextStep
    };
  }

  async confirmOnboardingAnswer(userJid) {
    const profile = await this.getUserProfile(userJid);
    const step = profile.pending_onboarding_step;
    const answer = profile.pending_onboarding_answer;
    if (step === null || !answer) return null;

    const preferenceKeys = ['name', 'priorities', 'communication_style'];
    const prompts = [
      'Thanks. What are one or two things you’d like me to help you stay on top of?',
      'Got it. How do you prefer I communicate—brief and direct, or with more detail?',
      null
    ];
    await this.rememberPreference(userJid, `onboarding.${preferenceKeys[step]}`, answer);
    const nextStep = step + 1;
    const completed = nextStep >= preferenceKeys.length;
    const updated = this.unwrap(await this.supabase
      .from('user_profiles')
      .update({
        onboarding_status: completed ? 'completed' : 'in_progress',
        onboarding_step: Math.min(nextStep, preferenceKeys.length - 1),
        pending_onboarding_step: null,
        pending_onboarding_answer: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_jid', userJid)
      .eq('pending_onboarding_step', step)
      .eq('pending_onboarding_answer', answer)
      .select('user_jid')
      .maybeSingle(), 'confirm onboarding answer');
    if (!updated) throw new Error('The onboarding answer changed before it could be confirmed.');
    return {
      status: completed ? 'completed' : 'in_progress',
      nextStep,
      prompt: prompts[step]
    };
  }

  async rejectOnboardingAnswer(userJid) {
    const profile = await this.getUserProfile(userJid);
    if (profile.pending_onboarding_step === null) return false;
    const updated = this.unwrap(await this.supabase
      .from('user_profiles')
      .update({
        pending_onboarding_step: null,
        pending_onboarding_answer: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_jid', userJid)
      .eq('pending_onboarding_step', profile.pending_onboarding_step)
      .select('user_jid')
      .maybeSingle(), 'reject onboarding answer');
    if (!updated) return false;
    return true;
  }

  async skipOnboarding(userJid) {
    this.unwrap(await this.supabase
      .from('user_profiles')
      .update({
        onboarding_status: 'skipped',
        pending_onboarding_step: null,
        pending_onboarding_answer: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_jid', userJid), 'skip onboarding');
  }

  async restartOnboarding(userJid) {
    this.unwrap(await this.supabase
      .from('user_profiles')
      .update({
        onboarding_status: 'in_progress',
        onboarding_step: 0,
        pending_onboarding_step: null,
        pending_onboarding_answer: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_jid', userJid), 'restart onboarding');
  }

  async createReminder(userJid, {
    title,
    remindAt,
    kind = 'reminder',
    recurrence = 'once',
    timezone = 'Africa/Lagos'
  }) {
    const localParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(remindAt));
    const localTime = `${localParts.find(part => part.type === 'hour').value}:${localParts.find(part => part.type === 'minute').value}`;
    return this.unwrap(await this.supabase
      .from('reminders')
      .insert({
        user_jid: userJid,
        title: title.trim(),
        kind,
        remind_at: new Date(remindAt).toISOString(),
        timezone,
        recurrence,
        local_time: recurrence === 'once' ? null : localTime,
        status: 'scheduled'
      })
      .select('id, title, kind, remind_at, timezone, recurrence, status')
      .single(), 'create reminder');
  }

  async listReminders(userJid) {
    return this.unwrap(await this.supabase
      .from('reminders')
      .select('id, title, kind, remind_at, timezone, recurrence, status, created_at')
      .eq('user_jid', userJid)
      .in('status', ['scheduled', 'sending'])
      .order('remind_at', { ascending: true })
      .limit(50), 'list reminders');
  }

  async cancelReminder(userJid, reminderId) {
    return this.unwrap(await this.supabase
      .from('reminders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('user_jid', userJid)
      .eq('id', reminderId)
      .eq('status', 'scheduled')
      .select('id, title')
      .maybeSingle(), 'cancel reminder');
  }

  async getDueReminders(now = new Date(), allowedJids = []) {
    if (allowedJids.length === 0) return [];
    return this.unwrap(await this.supabase
      .from('reminders')
      .select('id, user_jid, title, kind, remind_at, timezone, recurrence, local_time, status, updated_at')
      .eq('status', 'scheduled')
      .in('user_jid', allowedJids)
      .lte('remind_at', now.toISOString())
      .order('remind_at', { ascending: true })
      .limit(100), 'load due reminders');
  }

  async claimReminder(reminderId) {
    const result = await this.supabase
      .from('reminders')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', reminderId)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle();
    return this.unwrap(result, 'claim reminder delivery');
  }

  async finishReminder(reminder, error = null, now = new Date()) {
    if (error) {
      this.unwrap(await this.supabase
        .from('reminders')
        .update({
          status: 'scheduled',
          last_error: error.message,
          updated_at: now.toISOString()
        })
        .eq('id', reminder.id)
        .eq('status', 'sending'), 'retry reminder delivery');
      return;
    }

    if (reminder.recurrence === 'once') {
      this.unwrap(await this.supabase
        .from('reminders')
        .update({
          status: 'sent',
          sent_at: now.toISOString(),
          last_error: null,
          updated_at: now.toISOString()
        })
        .eq('id', reminder.id)
        .eq('status', 'sending'), 'complete reminder delivery');
      return;
    }

    const nextAt = getNextReminderTime(reminder, now);
    this.unwrap(await this.supabase
      .from('reminders')
      .update({
        status: 'scheduled',
        remind_at: nextAt.toISOString(),
        last_sent_at: now.toISOString(),
        last_error: null,
        updated_at: now.toISOString()
      })
      .eq('id', reminder.id)
      .eq('status', 'sending'), 'schedule recurring reminder');
  }

  async recoverStuckReminders(cutoff, allowedJids = []) {
    if (allowedJids.length === 0) return;
    this.unwrap(await this.supabase
      .from('reminders')
      .update({ status: 'scheduled', updated_at: new Date().toISOString() })
      .eq('status', 'sending')
      .in('user_jid', allowedJids)
      .lt('updated_at', cutoff.toISOString()), 'recover interrupted reminder deliveries');
  }

  async rememberPreference(userJid, key, value) {
    return this.unwrap(await this.supabase
      .from('user_preferences')
      .upsert({
        user_jid: userJid,
        preference_key: key.trim(),
        preference_value: value,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_jid,preference_key' })
      .select('preference_key, preference_value')
      .single(), 'save preference');
  }

  async ensureDefaultCheckins(userJid, settings) {
    return this.unwrap(await this.supabase
      .from('checkin_settings')
      .upsert(settings.map(setting => ({
        user_jid: userJid,
        ...setting
      })), {
        onConflict: 'user_jid,checkin_type',
        ignoreDuplicates: true
      }), 'initialize check-in settings');
  }

  async setCheckinSetting(userJid, checkinType, localTime, timezone, enabled = true) {
    return this.unwrap(await this.supabase
      .from('checkin_settings')
      .upsert({
        user_jid: userJid,
        checkin_type: checkinType,
        local_time: localTime,
        timezone,
        enabled,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_jid,checkin_type' })
      .select('checkin_type, local_time, timezone, enabled')
      .single(), 'update check-in setting');
  }

  async getCheckinSettings(userJid) {
    return this.unwrap(await this.supabase
      .from('checkin_settings')
      .select('checkin_type, local_time, timezone, enabled')
      .eq('user_jid', userJid)
      .eq('enabled', true), 'load check-in settings');
  }

  async listCheckinSettings(userJid) {
    return this.unwrap(await this.supabase
      .from('checkin_settings')
      .select('checkin_type, local_time, timezone, enabled')
      .eq('user_jid', userJid)
      .order('checkin_type'), 'list check-in settings');
  }

  async claimCheckin(userJid, checkinType, localDate) {
    const existing = this.unwrap(await this.supabase
      .from('checkin_deliveries')
      .select('id, status, created_at')
      .eq('user_jid', userJid)
      .eq('checkin_type', checkinType)
      .eq('local_date', localDate)
      .maybeSingle(), 'check check-in delivery');

    if (existing) {
      if (existing.status === 'sent') return false;
      if (
        existing.status === 'pending' &&
        Date.now() - new Date(existing.created_at).getTime() < 15 * 60 * 1000
      ) {
        return false;
      }

      this.unwrap(await this.supabase
        .from('checkin_deliveries')
        .update({ status: 'pending', error_message: null, created_at: new Date().toISOString() })
        .eq('id', existing.id), 'retry check-in delivery');
      return true;
    }

    this.unwrap(await this.supabase
      .from('checkin_deliveries')
      .insert({
        user_jid: userJid,
        checkin_type: checkinType,
        local_date: localDate,
        status: 'pending'
      }), 'claim check-in delivery');
    return true;
  }

  async finishCheckin(userJid, checkinType, localDate, error = null) {
    const update = error
      ? { status: 'failed', error_message: error.message }
      : { status: 'sent', sent_at: new Date().toISOString(), error_message: null };
    this.unwrap(await this.supabase
      .from('checkin_deliveries')
      .update(update)
      .eq('user_jid', userJid)
      .eq('checkin_type', checkinType)
      .eq('local_date', localDate), 'record check-in delivery');
  }

  unwrap(result, operation) {
    if (result.error) {
      throw new Error(`Could not ${operation}: ${result.error.message}`);
    }
    return result.data;
  }
}

export function getNextReminderTime(reminder, now) {
  const [hour, minute] = reminder.local_time.split(':').map(Number);
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: reminder.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const dateParts = Object.fromEntries(
    dateFormatter.formatToParts(now).map(part => [part.type, part.value])
  );
  const localDate = new Date(Date.UTC(
    Number(dateParts.year),
    Number(dateParts.month) - 1,
    Number(dateParts.day) + (reminder.recurrence === 'weekly' ? 7 : 1),
    hour,
    minute
  ));
  const utcDateParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(localDate).map(part => [part.type, part.value])
  );
  const targetLocal = `${utcDateParts.year}-${utcDateParts.month}-${utcDateParts.day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const approximateUtc = new Date(`${targetLocal}Z`);
  const formattedInZone = new Intl.DateTimeFormat('en-CA', {
    timeZone: reminder.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(approximateUtc);
  const observed = Object.fromEntries(formattedInZone.map(part => [part.type, part.value]));
  const desiredAsUtc = Date.parse(`${targetLocal}Z`);
  const observedAsUtc = Date.parse(
    `${observed.year}-${observed.month}-${observed.day}T${observed.hour}:${observed.minute}:00Z`
  );
  return new Date(approximateUtc.getTime() + desiredAsUtc - observedAsUtc);
}
