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
