import { config } from '../config/env.js';
import { ToolRegistry } from './toolRegistry.js';

function functionTool(name, description, properties, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false
      }
    }
  };
}

function getTaskProvider(provider, dataService, googleTasks) {
  if (provider === 'google') {
    if (!googleTasks) {
      throw new Error('Google Tasks is not configured. Set up Google OAuth before using that provider.');
    }
    return {
      list: (_userJid, includeCompleted) => googleTasks.getTasks('@default', includeCompleted),
      add: (_userJid, title, notes, dueAt) => googleTasks.addTask(title, notes, '@default', dueAt),
      complete: (_userJid, taskId) => googleTasks.completeTask(taskId),
      delete: (_userJid, taskId) => googleTasks.deleteTask(taskId)
    };
  }
  if (provider !== 'supabase') throw new Error(`Unknown task provider: ${provider}`);

  return {
    list: (userJid, includeCompleted) => dataService.listTasks(userJid, includeCompleted),
    add: (userJid, title, notes, dueAt) => dataService.addTask(userJid, title, notes, dueAt),
    complete: (userJid, taskId) => dataService.completeTask(userJid, taskId),
    delete: (userJid, taskId) => dataService.deleteTask(userJid, taskId)
  };
}

function validateTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
}

export function createYvonneToolRegistry({ dataService, googleTasks }) {
  const registry = new ToolRegistry();
  const providerProperty = {
    type: 'string',
    enum: ['supabase', 'google'],
    description: 'Task provider. Defaults to Supabase; choose Google only when explicitly requested.'
  };

  registry.register(
    functionTool('list_tasks', 'List your tasks from Supabase by default, or Google Tasks when requested.', {
      provider: providerProperty,
      include_completed: { type: 'boolean', description: 'Include completed tasks.' }
    }),
    async ({ provider = 'supabase', include_completed = false }, { userJid }) => {
      if (typeof include_completed !== 'boolean') {
        throw new Error('include_completed must be a boolean.');
      }
      const taskProvider = getTaskProvider(provider, dataService, googleTasks);
      return taskProvider.list(userJid, include_completed);
    }
  );

  registry.register(
    functionTool('add_task', 'Create a task. Supabase is the default provider. Use due_at as an ISO date/time if supplied.', {
      title: { type: 'string', description: 'Short task title.' },
      notes: { type: 'string', description: 'Optional task details.' },
      due_at: { type: 'string', description: 'Optional ISO date or date-time.' },
      provider: providerProperty
    }, ['title']),
    async ({ title, notes = '', due_at = null, provider = 'supabase' }, { userJid }) => {
      if (typeof title !== 'string' || !title.trim()) throw new Error('Task title cannot be empty.');
      if (typeof notes !== 'string') throw new Error('Task notes must be text.');
      if (due_at !== null && (
        typeof due_at !== 'string' ||
        Number.isNaN(Date.parse(due_at))
      )) {
        throw new Error('due_at must be a valid ISO date or date-time.');
      }
      const taskProvider = getTaskProvider(provider, dataService, googleTasks);
      return taskProvider.add(userJid, title, notes, due_at);
    }
  );

  registry.register(
    functionTool('complete_task', 'Mark a task complete by its exact task ID from the selected provider.', {
      task_id: { type: 'string', description: 'Exact task ID returned by list_tasks.' },
      provider: providerProperty
    }, ['task_id']),
    async ({ task_id, provider = 'supabase' }, { userJid }) => {
      if (typeof task_id !== 'string' || !task_id.trim()) throw new Error('A task ID is required.');
      const taskProvider = getTaskProvider(provider, dataService, googleTasks);
      return taskProvider.complete(userJid, task_id);
    }
  );

  registry.register(
    functionTool('delete_task', 'Delete a task by its exact task ID from the selected provider. Only use when the user explicitly asks to delete it.', {
      task_id: { type: 'string', description: 'Exact task ID returned by list_tasks.' },
      provider: providerProperty
    }, ['task_id']),
    async ({ task_id, provider = 'supabase' }, { userJid }) => {
      if (typeof task_id !== 'string' || !task_id.trim()) throw new Error('A task ID is required.');
      const taskProvider = getTaskProvider(provider, dataService, googleTasks);
      return taskProvider.delete(userJid, task_id);
    }
  );

  registry.register(
    functionTool('list_preferences', 'Read saved user preferences that Yvonne may use to personalize future replies.', {}),
    async (_input, { userJid }) => dataService.listPreferences(userJid)
  );

  registry.register(
    functionTool('remember_preference', 'Save or update a durable user preference. Only store information the user explicitly asks Yvonne to remember or clearly wants remembered.', {
      key: { type: 'string', description: 'Short preference name.' },
      value: { type: 'string', description: 'Preference to remember.' }
    }, ['key', 'value']),
    async ({ key, value }, { userJid }) => {
      if (typeof key !== 'string' || !key.trim()) throw new Error('A preference key is required.');
      if (typeof value !== 'string' || !value.trim()) throw new Error('A preference value is required.');
      return dataService.rememberPreference(userJid, key, value);
    }
  );

  registry.register(
    functionTool('get_checkin_schedule', 'Read your current morning, daytime, and evening check-in times and enabled states.', {}),
    async (_input, { userJid }) => dataService.listCheckinSettings(userJid)
  );

  registry.register(
    functionTool('set_checkin_schedule', 'Change or enable/disable one of the daily check-ins. Unspecified time, timezone, and enabled state remain unchanged.', {
      checkin_type: { type: 'string', enum: ['morning', 'daytime', 'evening'] },
      local_time: { type: 'string', description: '24-hour local time, for example 07:00.' },
      timezone: { type: 'string', description: 'IANA timezone, for example Africa/Lagos.' },
      enabled: { type: 'boolean', description: 'Whether this check-in is enabled.' }
    }, ['checkin_type']),
    async ({ checkin_type, local_time, timezone, enabled }, { userJid }) => {
      if (!['morning', 'daytime', 'evening'].includes(checkin_type)) {
        throw new Error('Check-in type must be morning, daytime, or evening.');
      }
      if (local_time !== undefined && typeof local_time !== 'string') {
        throw new Error('Check-in time must be text in HH:MM format.');
      }
      if (local_time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(local_time)) {
        throw new Error('Check-in time must use 24-hour HH:MM format.');
      }
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        throw new Error('enabled must be a boolean.');
      }

      const currentSettings = await dataService.listCheckinSettings(userJid);
      const current = currentSettings.find(setting => setting.checkin_type === checkin_type);
      const nextTime = local_time ?? current?.local_time ?? config.checkins[checkin_type];
      const nextTimezone = timezone ?? current?.timezone ?? config.checkins.timezone;
      const nextEnabled = enabled ?? current?.enabled ?? true;
      validateTimeZone(nextTimezone);
      return dataService.setCheckinSetting(
        userJid,
        checkin_type,
        nextTime,
        nextTimezone,
        nextEnabled
      );
    }
  );

  return registry;
}
