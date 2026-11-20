import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/assistant/toolRegistry.js';
import { createYvonneToolRegistry } from '../src/assistant/tools.js';
import { YvonneAssistant } from '../src/assistant/yvonne.js';
import {
  createCheckinMessage,
  getLocalDateAndTime,
  isCheckinDueNow,
  runCheckinTick
} from '../src/services/checkinScheduler.js';
import { isAllowedSender } from '../src/config/env.js';

test('only the configured WhatsApp sender is allowlisted', () => {
  const allowedNumber = process.env.ALLOWED_NUMBERS?.split(',')[0]?.replace(/\D/g, '');
  assert.ok(allowedNumber);
  assert.equal(isAllowedSender(`${allowedNumber}@s.whatsapp.net`), true);
  assert.equal(isAllowedSender(`${allowedNumber}:12@s.whatsapp.net`), true);
  assert.equal(isAllowedSender('2340000000000@s.whatsapp.net'), false);
  assert.equal(isAllowedSender('120363000000000000@g.us'), false);
});

test('sender authorization rejects unmatched JIDs', () => {
  assert.equal(isAllowedSender('123@s.whatsapp.net'), false);
  assert.equal(isAllowedSender('2340000000000@s.whatsapp.net'), false);
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
  const assistant = new YvonneAssistant(groq, registry, 'test-model');

  assert.equal(await assistant.respond('user-1', 'Find tea'), 'I found tea.');
  const toolResult = requests[1].messages.find(message => message.role === 'tool');
  assert.deepEqual(JSON.parse(toolResult.content), { result: 'tea' });
  assert.equal(await assistant.respond('user-1', 'Thanks'), 'I found tea.');
  assert.equal(requests[2].messages.some(message => message.role === 'tool'), false);
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
    allowedNumbers: ['2347012345678'],
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
