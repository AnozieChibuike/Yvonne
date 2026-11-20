import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/assistant/toolRegistry.js';
import { createYvonneToolRegistry } from '../src/assistant/tools.js';
import { YvonneAssistant } from '../src/assistant/yvonne.js';
import {
  createCheckinMessage,
  createReminderMessage,
  formatReminderTime,
  getLocalDateAndTime,
  isCheckinDueNow,
  runCheckinTick,
  runReminderTick
} from '../src/services/checkinScheduler.js';
import { getNextReminderTime } from '../src/services/yvonneData.js';
import { config, isAllowedSender } from '../src/config/env.js';
import { isAuthorizedSelfChat } from '../src/whatsapp/client.js';
import { normalizeWhatsAppText } from '../src/whatsapp/client.js';
import { handleIncomingMessage } from '../src/whatsapp/handler.js';
import { getTimeContext } from '../src/services/timeContext.js';
import { renderTaskListImage } from '../src/services/taskCards.js';
import sharp from 'sharp';

test('configured WhatsApp numbers and LIDs are allowlisted exactly', () => {
  const allowedJid = config.whatsapp.allowedJids[0];
  assert.ok(allowedJid);
  const [allowedIdentifier, allowedServer] = allowedJid.split('@');
  assert.equal(isAllowedSender(allowedJid), true);
  assert.equal(isAllowedSender(`${allowedIdentifier}:12@${allowedServer}`), true);
  assert.equal(isAllowedSender('2340000000000@s.whatsapp.net'), false);
  assert.equal(isAllowedSender('120363000000000000@g.us'), false);
});

test('WhatsApp LIDs are matched using their LID server and retained for storage', () => {
  const testLid = '9876543210@lid';
  config.whatsapp.allowedJids.push(testLid);
  try {
    assert.equal(isAllowedSender(testLid), true);
    assert.equal(isAllowedSender('9876543210@s.whatsapp.net'), false);
  } finally {
    config.whatsapp.allowedJids.pop();
  }
});

test('only an authorized direct self-chat is accepted as a from-me message', () => {
  const phone = '2347040361805@s.whatsapp.net';
  config.whatsapp.allowedJids.push(phone);
  const [phoneId] = phone.split('@');
  const socket = { user: { id: `${phoneId}:17@s.whatsapp.net` } };

  try {
    assert.equal(isAuthorizedSelfChat(socket, {
      key: { remoteJid: phone, fromMe: true }
    }), true);
    assert.equal(isAuthorizedSelfChat(socket, {
      key: { remoteJid: '123456789@s.whatsapp.net', fromMe: true }
    }), false);
    assert.equal(isAuthorizedSelfChat(socket, {
      key: { remoteJid: '123456789@g.us', fromMe: true }
    }), false);
  } finally {
    config.whatsapp.allowedJids.pop();
  }
});

test('sender authorization rejects unmatched JIDs', () => {
  assert.equal(isAllowedSender('123@s.whatsapp.net'), false);
  assert.equal(isAllowedSender('2340000000000@s.whatsapp.net'), false);
});

test('outgoing replies normalize Telegram-style formatting for WhatsApp', () => {
  assert.equal(
    normalizeWhatsAppText('<b>Tasks</b>\n**Call Mum** and __send the email__\n| Task | Due |\n| --- | --- |\n| Call Mum | Tomorrow |'),
    '*Tasks*\n*Call Mum* and _send the email_\n• Call Mum — Tomorrow'
  );
});

test('task card renderer creates a readable PNG image', async () => {
  const image = await renderTaskListImage([
    { title: 'Call Mum', notes: 'Ask about Sunday lunch', due_at: '2026-11-21T09:00:00.000Z' },
    { title: 'Review project plan', status: 'completed' }
  ], { totalTasks: 2 });
  const metadata = await sharp(image).metadata();

  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1080);
  assert.ok(metadata.height > 300);
});

test('task commands send image cards for task lists and task details', async () => {
  const allowedJid = config.whatsapp.allowedJids[0];
  const sent = [];
  const tasks = [
    { id: 'task-1', title: 'Call Mum', notes: 'Ask about Sunday lunch', status: 'open' },
    { id: 'task-2', title: 'Review project plan', status: 'completed' }
  ];
  const dependencies = {
    dataService: { listTasks: async (_userJid, includeCompleted) => includeCompleted ? tasks : tasks.slice(0, 1) },
    googleTasks: null
  };
  const sock = { sendMessage: async (jid, message) => sent.push({ jid, message }) };
  const message = text => ({
    key: { remoteJid: allowedJid, fromMe: false },
    message: { conversation: text }
  });

  await handleIncomingMessage(sock, message('!tasks'), dependencies);
  await handleIncomingMessage(sock, message('!task 1'), dependencies);
  await handleIncomingMessage(sock, message('!task task-2'), {
    ...dependencies,
    assistant: { respond: async () => assert.fail('task command should not call the assistant') }
  });

  assert.equal(sent.length, 3);
  assert.ok(Buffer.isBuffer(sent[0].message.image));
  assert.match(sent[0].message.caption, /task/);
  assert.ok(Buffer.isBuffer(sent[1].message.image));
  assert.match(sent[1].message.caption, /Call Mum/);
  assert.ok(Buffer.isBuffer(sent[2].message.image));
  assert.match(sent[2].message.caption, /Review project plan/);
});

test('natural-language task list responses are sent as task-card images', async () => {
  const allowedJid = '9876543210@s.whatsapp.net';
  const sent = [];
  config.whatsapp.allowedJids.push(allowedJid);
  try {
    const sock = { sendMessage: async (jid, message) => sent.push({ jid, message }) };
    await handleIncomingMessage(sock, {
      key: { remoteJid: allowedJid, fromMe: false },
      message: { conversation: 'Show my tasks' }
    }, {
      dataService: {
        getUserProfile: async () => ({ onboarding_status: 'completed' }),
        getPendingMemory: async () => null
      },
      assistant: {
        respondWithMedia: async () => ({
          text: 'Here are your tasks.',
          media: {
            type: 'task-list',
            title: 'Your tasks',
            tasks: [{ id: 'task-1', title: 'Call Mum', status: 'open' }]
          }
        })
      }
    });
  } finally {
    config.whatsapp.allowedJids.pop();
  }

  assert.equal(sent.length, 1);
  assert.ok(Buffer.isBuffer(sent[0].message.image));
  assert.match(sent[0].message.caption, /Your tasks · 1 task/);
});

test('tool registry runs registered tools and rejects duplicate names', async () => {
  const registry = new ToolRegistry();
  const definition = {
    type: 'function',
    function: { name: 'say_hello', parameters: { type: 'object', properties: {} } }
  };
  registry.register(definition, async ({ name }) => `Hello, ${name}`);

  assert.equal(await registry.execute('say_hello', { name: 'Yvonne' }, {}), 'Hello, Yvonne');
  assert.throws(() => registry.register(definition, async () => null), /already registered/);
  await assert.rejects(registry.execute('missing_tool', {}, {}), /Unknown assistant tool/);
});

test('task tools use Supabase by default and Google only when requested', async () => {
  const calls = [];
  const dataService = {
    listTasks: async (userJid, includeCompleted) => {
      calls.push(['supabase', userJid, includeCompleted]);
      return [];
    }
  };
  const googleTasks = {
    getTasks: async (...args) => {
      calls.push(['google', ...args]);
      return [];
    }
  };
  const registry = createYvonneToolRegistry({ dataService, googleTasks });

  await registry.execute('list_tasks', {}, { userJid: '234@s.whatsapp.net' });
  await registry.execute('list_tasks', { provider: 'google' }, { userJid: '234@s.whatsapp.net' });

  assert.deepEqual(calls, [
    ['supabase', '234@s.whatsapp.net', false],
    ['google', '@default', false]
  ]);
});

test('changing a check-in time preserves its saved timezone', async () => {
  const saved = [];
  const dataService = {
    listCheckinSettings: async () => [{
      checkin_type: 'evening',
      local_time: '21:00',
      timezone: 'Europe/London',
      enabled: true
    }],
    setCheckinSetting: async (...args) => {
      saved.push(args);
      return args;
    }
  };
  const registry = createYvonneToolRegistry({ dataService, googleTasks: null });

  await registry.execute('set_checkin_schedule', {
    checkin_type: 'evening',
    local_time: '22:15'
  }, { userJid: '234@s.whatsapp.net' });

  assert.deepEqual(saved[0], [
    '234@s.whatsapp.net',
    'evening',
    '22:15',
    'Europe/London',
    true
  ]);
});

test('assistant executes tools then returns the model response', async () => {
  const registry = new ToolRegistry();
  registry.register({
    type: 'function',
    function: { name: 'lookup', parameters: { type: 'object', properties: { query: { type: 'string' } } } }
  }, async ({ query }) => ({ result: query }));

  const requests = [];
  const groq = {
    chat: {
      completions: {
        create: async request => {
          requests.push(request);
          if (requests.length === 1) {
            return {
              choices: [{
                message: {
                  role: 'assistant',
                  tool_calls: [{
                    id: 'tool-call-1',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"query":"tea"}' }
                  }]
                }
              }]
            };
          }
          return { choices: [{ message: { role: 'assistant', content: 'I found tea.' } }] };
        }
      }
    }
  };
  const fixedNow = new Date('2026-11-20T10:45:34.154Z');
  const assistant = new YvonneAssistant(groq, registry, 'test-model', null, () => fixedNow);

  assert.equal(await assistant.respond('user-1', 'Find tea'), 'I found tea.');
  assert.match(requests[0].messages[0].content, /Authoritative VPS clock/);
  assert.match(requests[0].messages[0].content, /2026-11-20T10:45:34\.154Z/);
  assert.match(requests[0].messages[0].content, /"localDate":"2026-11-20"/);
  assert.match(requests[0].messages[0].content, /"localTime":"11:45:34"/);
  assert.match(requests[0].messages[0].content, /"offset":"GMT\+1"/);
  const toolResult = requests[1].messages.find(message => message.role === 'tool');
  assert.deepEqual(JSON.parse(toolResult.content), { result: 'tea' });
  assert.equal(await assistant.respond('user-1', 'Thanks'), 'I found tea.');
  assert.equal(requests[2].messages.some(message => message.role === 'tool'), false);
});

test('assistant marks natural-language task lists for image-card delivery', async () => {
  const registry = new ToolRegistry();
  const tasks = [{ id: 'task-1', title: 'Call Mum', status: 'open' }];
  registry.register({
    type: 'function',
    function: { name: 'list_tasks', parameters: { type: 'object', properties: {} } }
  }, async () => tasks);

  const groq = {
    chat: {
      completions: {
        create: async request => {
          if (!request.messages.some(message => message.role === 'tool')) {
            return {
              choices: [{
                message: {
                  role: 'assistant',
                  tool_calls: [{
                    id: 'list-task-call',
                    type: 'function',
                    function: { name: 'list_tasks', arguments: '{}' }
                  }]
                }
              }]
            };
          }
          return { choices: [{ message: { role: 'assistant', content: 'Here are your tasks.' } }] };
        }
      }
    }
  };
  const assistant = new YvonneAssistant(groq, registry, 'test-model');

  const response = await assistant.respondWithMedia('user-1', 'Show my tasks');

  assert.equal(response.text, 'Here are your tasks.');
  assert.deepEqual(response.media, {
    type: 'task-list',
    title: 'Your tasks',
    tasks
  });

  const countResponse = await assistant.respondWithMedia('user-1', 'How many tasks do I have?');
  assert.equal(countResponse.media, null);
  const dueResponse = await assistant.respondWithMedia('user-1', 'What task is due today?');
  assert.equal(dueResponse.media, null);
});

test('reminder creation confirmation reflects the saved record and never sends an unrequested task image', async () => {
  const registry = new ToolRegistry();
  registry.register({
    type: 'function',
    function: { name: 'create_reminder', parameters: { type: 'object', properties: {} } }
  }, async () => ({
    id: 'reminder-1',
    title: 'Call Mum',
    kind: 'reminder',
    recurrence: 'once',
    remind_at_local: '21 Nov 2026, 09:00'
  }));
  registry.register({
    type: 'function',
    function: { name: 'list_tasks', parameters: { type: 'object', properties: {} } }
  }, async () => [{ id: 'task-1', title: 'Only task', status: 'open' }]);

  const groq = {
    chat: {
      completions: {
        create: async request => request.messages.some(message => message.role === 'tool')
          ? {
            choices: [{
              message: {
                role: 'assistant',
                content: 'Done, I set the reminder. You have one task.'
              }
            }]
          }
          : {
            choices: [{
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'create-reminder-call',
                    type: 'function',
                    function: { name: 'create_reminder', arguments: '{}' }
                  },
                  {
                    id: 'list-tasks-call',
                    type: 'function',
                    function: { name: 'list_tasks', arguments: '{}' }
                  }
                ]
              }
            }]
          }
      }
    }
  };
  const assistant = new YvonneAssistant(groq, registry, 'test-model');

  const response = await assistant.respondWithMedia('user-1', 'Remind me tomorrow at 9 to call Mum');

  assert.match(response.text, /Saved reminder “Call Mum” for 21 Nov 2026, 09:00 Africa\/Lagos/);
  assert.match(response.text, /separate from your tasks/);
  assert.match(response.text, /!reminders/);
  assert.equal(response.media, null);
});

test('assistant does not claim a reminder was saved without a successful reminder tool call', async () => {
  const registry = new ToolRegistry();
  const groq = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Done, I scheduled your reminder.' } }]
        })
      }
    }
  };
  const assistant = new YvonneAssistant(groq, registry, 'test-model');

  const reply = await assistant.respond('user-1', 'Remind me to call Mum tomorrow');

  assert.match(reply, /I have not saved a reminder yet/);
});

test('reminder-only requests cannot accidentally create task records', async () => {
  let taskWrites = 0;
  const registry = new ToolRegistry();
  registry.register({
    type: 'function',
    function: { name: 'add_task', parameters: { type: 'object', properties: {} } }
  }, async () => {
    taskWrites += 1;
    return { id: 'task-1', title: 'Buy milk' };
  });
  const groq = {
    chat: {
      completions: {
        create: async request => request.messages.some(message => message.role === 'tool')
          ? {
            choices: [{
              message: { role: 'assistant', content: 'Done, I added it and scheduled your reminder.' }
            }]
          }
          : {
            choices: [{
              message: {
                role: 'assistant',
                tool_calls: [{
                  id: 'wrong-task-call',
                  type: 'function',
                  function: { name: 'add_task', arguments: '{}' }
                }]
              }
            }]
          }
      }
    }
  };
  const assistant = new YvonneAssistant(groq, registry, 'test-model');

  const reply = await assistant.respond('user-1', 'Remind me tomorrow to add a task to buy milk');

  assert.equal(taskWrites, 0);
  assert.match(reply, /I have not saved a reminder yet/);
});

test('time context converts the VPS instant to Africa/Lagos date and wall-clock time', () => {
  assert.deepEqual(getTimeContext(new Date('2026-11-20T10:45:34.154Z')), {
    instant: '2026-11-20T10:45:34.154Z',
    timezone: 'Africa/Lagos',
    localDate: '2026-11-20',
    localTime: '11:45:34',
    offset: 'GMT+1'
  });
});

test('check-in time uses the requested timezone', () => {
  const date = new Date('2026-11-20T06:00:00.000Z');
  assert.deepEqual(getLocalDateAndTime(date, 'Africa/Lagos'), {
    localDate: '2026-11-20',
    localTime: '07:00'
  });
});

test('check-in scheduler allows a short restart grace window', () => {
  assert.equal(isCheckinDueNow('07:04', '07:00'), true);
  assert.equal(isCheckinDueNow('07:05', '07:00'), false);
  assert.equal(isCheckinDueNow('06:59', '07:00'), false);
});

test('check-in message includes a few open tasks when available', () => {
  const message = createCheckinMessage('morning', [
    { title: 'Review notes' },
    { title: 'Call the dentist' },
    { title: 'Buy groceries' },
    { title: 'Too many items' }
  ]);

  assert.match(message, /Good morning/);
  assert.match(message, /Review notes/);
  assert.match(message, /Buy groceries/);
  assert.doesNotMatch(message, /Too many items/);
});

test('scheduler sends and records a matching local-time check-in once', async () => {
  const sent = [];
  const finished = [];
  let deliveryClaimed = false;
  const socket = {
    sendMessage: async (jid, message) => sent.push({ jid, message })
  };
  const dataService = {
    getCheckinSettings: async () => [{
      checkin_type: 'morning',
      local_time: '07:00',
      timezone: 'Africa/Lagos'
    }],
    claimCheckin: async () => {
      if (deliveryClaimed) return false;
      deliveryClaimed = true;
      return true;
    },
    listTasks: async () => [{ title: 'Review notes' }],
    finishCheckin: async (...args) => finished.push(args)
  };
  const options = {
    allowedJids: ['2347012345678@s.whatsapp.net'],
    dataService,
    getSocket: () => socket,
    now: new Date('2026-11-20T06:00:00.000Z')
  };

  await runCheckinTick(options);
  await runCheckinTick(options);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, '2347012345678@s.whatsapp.net');
  assert.match(sent[0].message.text, /Review notes/);
  assert.equal(finished.length, 1);
  assert.equal(finished[0][2], '2026-11-20');
});

test('reminder display uses Africa/Lagos local time and marks overdue delivery', () => {
  const scheduledAt = '2026-11-20T06:00:00.000Z';
  assert.match(formatReminderTime(scheduledAt), /20 Nov 2026/);
  assert.match(createReminderMessage({
    title: 'Call home',
    kind: 'reminder',
    remind_at: scheduledAt,
    timezone: 'Africa/Lagos'
  }, new Date('2026-11-20T08:00:00.000Z')), /scheduled for.*20 Nov 2026/);
});

test('recurring reminder is scheduled for its next Africa/Lagos local time', () => {
  const nextAt = getNextReminderTime({
    recurrence: 'daily',
    timezone: 'Africa/Lagos',
    local_time: '10:00'
  }, new Date('2026-11-20T08:30:00.000Z'));

  assert.equal(nextAt.toISOString(), '2026-11-21T09:00:00.000Z');
});

test('reminder scheduler delivers overdue reminder and relies on claim to prevent duplicates', async () => {
  const sent = [];
  const finished = [];
  let canClaim = true;
  const reminder = {
    id: 'reminder-1',
    user_jid: '234@s.whatsapp.net',
    title: 'Call home',
    kind: 'alarm',
    remind_at: '2026-11-20T06:00:00.000Z',
    timezone: 'Africa/Lagos',
    recurrence: 'once'
  };
  const dataService = {
    recoverStuckReminders: async () => {},
    getDueReminders: async () => [reminder],
    claimReminder: async () => {
      if (!canClaim) return null;
      canClaim = false;
      return { id: reminder.id };
    },
    finishReminder: async (...args) => finished.push(args)
  };
  const options = {
    allowedJids: [reminder.user_jid],
    dataService,
    getSocket: () => ({
      sendMessage: async (jid, message) => sent.push({ jid, message })
    }),
    now: new Date('2026-11-20T08:00:00.000Z')
  };

  await runReminderTick(options);
  await runReminderTick(options);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, reminder.user_jid);
  assert.match(sent[0].message.text, /Alarm: Call home/);
  assert.match(sent[0].message.text, /scheduled for/);
  assert.equal(finished.length, 1);
  assert.equal(finished[0][1], null);
});

test('onboarding answer is staged and saved only after explicit confirmation', async () => {
  const allowedJid = config.whatsapp.allowedJids[0];
  const sent = [];
  const staged = [];
  const confirmed = [];
  let pendingAnswer = false;
  const dataService = {
    getUserProfile: async () => ({
      onboarding_status: 'in_progress',
      onboarding_step: 0,
      pending_onboarding_step: pendingAnswer ? 0 : null,
      pending_onboarding_answer: pendingAnswer ? 'Chibuike' : null
    }),
    saveOnboardingAnswer: async (...args) => {
      staged.push(args);
      pendingAnswer = true;
    },
    confirmOnboardingAnswer: async () => {
      confirmed.push(true);
      pendingAnswer = false;
      return { status: 'in_progress', prompt: 'What should I help with?' };
    }
  };
  const dependencies = {
    dataService,
    assistant: { respond: async () => assert.fail('onboarding must be handled deterministically') }
  };
  const sock = { sendMessage: async (jid, message) => sent.push({ jid, message }) };
  const message = text => ({
    key: { remoteJid: allowedJid, fromMe: false },
    message: { conversation: text }
  });

  await handleIncomingMessage(sock, message('Chibuike'), dependencies);
  assert.deepEqual(staged, [[allowedJid, 0, 'Chibuike']]);
  assert.equal(confirmed.length, 0);
  assert.match(sent.at(-1).message.text, /Reply yes or no/);

  await handleIncomingMessage(sock, message('yes'), dependencies);
  assert.equal(confirmed.length, 1);
  assert.match(sent.at(-1).message.text, /What should I help with/);
});

test('reminder tool rejects date-times without an explicit timezone offset', async () => {
  let created = false;
  const registry = createYvonneToolRegistry({
    dataService: { createReminder: async () => { created = true; } },
    googleTasks: null
  });

  await assert.rejects(
    registry.execute('create_reminder', {
      title: 'Call home',
      remind_at: '2026-11-20T10:00:00'
    }, { userJid: '234@s.whatsapp.net' }),
    /timezone offset/
  );
  assert.equal(created, false);
});
