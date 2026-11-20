import {
  downloadMediaMessage,
  normalizeMessageContent
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { isAllowedSender, normalizePhoneNumber } from '../config/env.js';
import { transcribeVoiceNote } from '../services/groq.js';
import { formatReminderTime } from '../services/checkinScheduler.js';
import { MAX_TASKS_PER_CARD, renderTaskListImage } from '../services/taskCards.js';

const MAX_VOICE_NOTE_BYTES = 25 * 1024 * 1024;
const TASKS_PER_PAGE = MAX_TASKS_PER_CARD;
const mediaLogger = pino({ level: 'silent' });
const userSessions = new Map();

function getSession(jid) {
  if (!userSessions.has(jid)) {
    userSessions.set(jid, {
      maps: {
        supabase: new Map(),
        google: new Map(),
        googleLists: new Map()
      },
      activeGoogleListId: '@default',
      activeGoogleListName: 'Default List'
    });
  }
  return userSessions.get(jid);
}

function getProvider(provider, dataService, googleTasks, session) {
  if (provider === 'google') {
    if (!googleTasks) {
      throw new Error('Google Tasks is not configured. Set up Google OAuth first.');
    }
    return {
      list: includeCompleted => googleTasks.getTasks(session.activeGoogleListId, includeCompleted),
      add: (title, notes) => googleTasks.addTask(title, notes, session.activeGoogleListId),
      complete: taskId => googleTasks.completeTask(taskId, session.activeGoogleListId),
      delete: taskId => googleTasks.deleteTask(taskId, session.activeGoogleListId)
    };
  }

  return {
    list: includeCompleted => dataService.listTasks(session.userJid, includeCompleted),
    add: (title, notes) => dataService.addTask(session.userJid, title, notes),
    complete: taskId => dataService.completeTask(session.userJid, taskId),
    delete: taskId => dataService.deleteTask(session.userJid, taskId)
  };
}

async function sendHelpMessage(sock, jid) {
  await sock.sendMessage(jid, {
    text: `Hi, I’m *Yvonne*. You can chat naturally, send a voice note, or use these commands:

• \`!tasks [page]\` — view your tasks as a card
• \`!task <number or id>\` — view one task as a card
• \`!add <title> | <notes>\` — create a task
• \`!done <number or id>\` — complete a task
• \`!delete <number or id>\` — delete a task
• \`!google tasks\`, \`!google add <title>\`, \`!google done <number or id>\`, \`!google delete <number or id>\` — use Google Tasks
• \`!google lists\` and \`!google use <number>\` — choose a Google task list
• \`!reminders\` — list scheduled reminders and alarms
• \`!onboard\` / \`!skip\` — start or skip getting-to-know-you questions
• \`!help\` — show this menu

Supabase is the default task store; Google Tasks stays separate.`
  });
}

async function listTasks(sock, jid, providerName, provider, session, page = 1) {
  const tasks = await provider.list();
  const taskMap = session.maps[providerName];
  taskMap.clear();
  tasks.forEach((task, index) => taskMap.set(index + 1, task.id));

  if (tasks.length === 0) {
    await sock.sendMessage(jid, {
      text: `No open tasks in ${providerName === 'google' ? session.activeGoogleListName : 'your Yvonne list'}.`
    });
    return;
  }

  const pageCount = Math.ceil(tasks.length / TASKS_PER_PAGE);
  const selectedPage = Math.min(page, pageCount);
  const pageTasks = tasks.slice((selectedPage - 1) * TASKS_PER_PAGE, selectedPage * TASKS_PER_PAGE);
  const image = await renderTaskListImage(pageTasks, {
    title: providerName === 'google' ? session.activeGoogleListName : 'Your tasks',
    page: selectedPage,
    totalTasks: tasks.length
  });
  const pageHint = pageCount > 1
    ? ` Send \`!tasks ${selectedPage < pageCount ? selectedPage + 1 : 1}\` for ${selectedPage < pageCount ? 'the next' : 'the first'} page.`
    : '';
  await sock.sendMessage(jid, {
    image,
    caption: `📋 ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}.${pageHint}\nReply with \`!task <number>\` for details.`
  });
}

async function handleTaskCommand(sock, jid, providerName, command, args, dataService, googleTasks, session) {
  const provider = getProvider(providerName, dataService, googleTasks, session);

  if (['!tasks', '!list', '!ls'].includes(command)) {
    const requestedPage = /^\d+$/.test(args) ? Number(args) : 1;
    await listTasks(sock, jid, providerName, provider, session, requestedPage);
    return true;
  }

  if (command === '!task') {
    if (!args) {
      await sock.sendMessage(jid, { text: 'Usage: `!task <number or id>`. Use `!tasks` first to see task numbers.' });
      return true;
    }
    const taskNumber = /^\d+$/.test(args) ? Number(args) : null;
    const mappedTaskId = taskNumber ? session.maps[providerName].get(taskNumber) : null;
    const tasks = await provider.list(Boolean(mappedTaskId || !taskNumber));
    const task = mappedTaskId
      ? tasks.find(candidate => candidate.id === mappedTaskId)
      : taskNumber
        ? tasks[taskNumber - 1]
        : tasks.find(candidate => candidate.id === args);
    if (!task) {
      await sock.sendMessage(jid, { text: 'I could not find that task. Send `!tasks` to refresh your list.' });
      return true;
    }
    const image = await renderTaskListImage([task], { title: 'Task details', totalTasks: 1 });
    await sock.sendMessage(jid, {
      image,
      caption: `Task: ${task.title}`
    });
    return true;
  }

  if (command === '!add') {
    if (!args) {
      await sock.sendMessage(jid, { text: 'Usage: `!add <title> | <optional notes>`' });
      return true;
    }
    const [rawTitle, ...noteParts] = args.split('|');
    const title = rawTitle.trim();
    if (!title) {
      await sock.sendMessage(jid, { text: 'Please provide a task title.' });
      return true;
    }
    const task = await provider.add(title, noteParts.join('|').trim());
    session.maps[providerName].clear();
    await sock.sendMessage(jid, { text: `✅ Added *${task.title}* to ${providerName === 'google' ? 'Google Tasks' : 'Yvonne Tasks'}.` });
    return true;
  }

  if (['!done', '!complete', '!delete', '!rm'].includes(command)) {
    if (!args) {
      await sock.sendMessage(jid, { text: `Usage: \`${command} <task number or id>\`` });
      return true;
    }

    const number = /^\d+$/.test(args) ? Number(args) : null;
    const taskId = number ? session.maps[providerName].get(number) : args;
    if (!taskId) {
      await sock.sendMessage(jid, { text: 'That task number is not in the latest list. Use `!tasks` first.' });
      return true;
    }

    if (['!done', '!complete'].includes(command)) {
      const task = await provider.complete(taskId);
      session.maps[providerName].clear();
      await sock.sendMessage(jid, { text: `✅ Completed *${task.title}*.` });
    } else {
      await provider.delete(taskId);
      session.maps[providerName].clear();
      await sock.sendMessage(jid, { text: `🗑️ Deleted task ${number ? `#${number}` : taskId}.` });
    }
    return true;
  }

  if (command === '!lists' && providerName === 'google') {
    const lists = await googleTasks.getTaskLists();
    const listMap = session.maps.googleLists;
    listMap.clear();
    const rows = lists.map((list, index) => {
      const number = index + 1;
      listMap.set(number, list);
      const active = list.id === session.activeGoogleListId ? ' *(Active)*' : '';
      return `*${number}.* ${list.title}${active}`;
    });
    await sock.sendMessage(jid, { text: `📂 *Google Task Lists*\n\n${rows.join('\n') || 'No lists found.'}` });
    return true;
  }

  if (command === '!use' && providerName === 'google') {
    const number = /^\d+$/.test(args) ? Number(args) : null;
    const list = number ? session.maps.googleLists.get(number) : null;
    if (!list) {
      await sock.sendMessage(jid, { text: 'Use `!google lists` first, then `!google use <number>`.' });
      return true;
    }
    session.activeGoogleListId = list.id;
    session.activeGoogleListName = list.title;
    session.maps.google.clear();
    await sock.sendMessage(jid, { text: `Switched to Google list *${list.title}*.` });
    return true;
  }

  if ((command === '!lists' || command === '!use') && providerName === 'supabase') {
    await sock.sendMessage(jid, { text: 'Yvonne Tasks uses one Supabase list. Use `!google lists` to browse Google Task lists.' });
    return true;
  }

  return false;
}

async function handleCommand(sock, jid, userJid, text, dataService, googleTasks) {
  const session = getSession(jid);
  session.userJid = userJid;

  let commandText = text.trim();
  let provider = 'supabase';
  if (/^!google(?:\s|$)/i.test(commandText)) {
    provider = 'google';
    commandText = commandText.replace(/^!google\s*/i, '!');
  }

  const parts = commandText.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  if (['!help', 'help'].includes(command)) {
    await sendHelpMessage(sock, jid);
    return true;
  }

  if (command === '!reminders') {
    const reminders = await dataService.listReminders(userJid);
    const rows = reminders.map(reminder => {
      const kind = reminder.kind === 'alarm' ? 'Alarm' : 'Reminder';
      const repeat = reminder.recurrence === 'once' ? '' : ` · ${reminder.recurrence}`;
      return `• ${kind}: ${reminder.title} — ${formatReminderTime(reminder.remind_at, reminder.timezone)}${repeat}\n  ID: ${reminder.id}`;
    });
    await sock.sendMessage(jid, {
      text: rows.length ? `🔔 *Your reminders*\n\n${rows.join('\n')}` : 'You have no scheduled reminders or alarms.'
    });
    return true;
  }

  if (command === '!onboard') {
    await dataService.restartOnboarding(userJid);
    await sock.sendMessage(jid, {
      text: 'Let’s set up your Yvonne profile. What name should I use for you? You can reply `!skip` at any time.'
    });
    return true;
  }

  if (command === '!skip') {
    await dataService.skipOnboarding(userJid);
    await sock.sendMessage(jid, { text: 'No problem. I’ve stopped onboarding; you can start it later with `!onboard`.' });
    return true;
  }

  return handleTaskCommand(sock, jid, provider, command, args, dataService, googleTasks, session);
}

function getAudioMessage(message) {
  const content = normalizeMessageContent(message);
  return content?.audioMessage || null;
}

export async function handleIncomingMessage(sock, msg, dependencies) {
  const senderJid = msg.key.remoteJid;
  if (!isAllowedSender(senderJid)) {
    console.log(`Ignoring unauthorized WhatsApp message from ${senderJid || 'unknown sender'}.`);
    return;
  }
  console.log('Received an authorized WhatsApp message; processing it.');
  const [senderIdentifier, senderServer] = senderJid.split('@');
  const senderNumber = normalizePhoneNumber(senderIdentifier.split(':')[0]);
  const userJid = `${senderNumber}@${senderServer.toLowerCase() === 'lid' ? 'lid' : 's.whatsapp.net'}`;

  const content = normalizeMessageContent(msg.message);
  let text = (
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    ''
  ).trim();

  if (!text) {
    const audioMessage = getAudioMessage(msg.message);
    if (!audioMessage) return;

    if (Number(audioMessage.fileLength || 0) > MAX_VOICE_NOTE_BYTES) {
      await sock.sendMessage(senderJid, { text: 'That voice note is too large to transcribe. Please send one under 25 MB.' });
      return;
    }

    try {
      const audioBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
        logger: mediaLogger,
        reuploadRequest: message => sock.updateMediaMessage(message)
      });
      if (audioBuffer.length > MAX_VOICE_NOTE_BYTES) {
        await sock.sendMessage(senderJid, { text: 'That voice note is too large to transcribe. Please send one under 25 MB.' });
        return;
      }
      text = await dependencies.transcribeVoiceNote(audioBuffer, audioMessage.mimetype);
    } catch (error) {
      console.error('Could not transcribe WhatsApp voice note:', error);
      await sock.sendMessage(senderJid, { text: 'I could not transcribe that voice note. Please try again or send a text message.' });
      return;
    }
  }

  try {
    if (text.startsWith('!') || text.toLowerCase() === 'help') {
      const handled = await handleCommand(
        sock,
        senderJid,
        userJid,
        text,
        dependencies.dataService,
        dependencies.googleTasks
      );
      if (handled) return;
      if (text.startsWith('!')) {
        await sock.sendMessage(senderJid, { text: `Unknown command. Type \`!help\` to see what I can do.` });
        return;
      }
    }

    const profile = await dependencies.dataService.getUserProfile(userJid);
    if (profile.onboarding_status === 'in_progress') {
      if (profile.pending_onboarding_step !== null) {
        if (/^(yes|y|confirm|save)$/i.test(text.trim())) {
          const result = await dependencies.dataService.confirmOnboardingAnswer(userJid);
          const prompt = result?.prompt
            ? ` ${result.prompt}`
            : ' Your profile setup is complete.';
          await sock.sendMessage(senderJid, { text: `Saved.${prompt}` });
          return;
        }
        if (/^(no|n|reject|don'?t save)$/i.test(text.trim())) {
          await dependencies.dataService.rejectOnboardingAnswer(userJid);
          await sock.sendMessage(senderJid, { text: 'Okay, I did not save that. Please answer the question again, or use `!skip`.' });
          return;
        }
        await sock.sendMessage(senderJid, {
          text: `Should I save this answer: “${profile.pending_onboarding_answer}”? Reply yes or no.`
        });
        return;
      }

      await dependencies.dataService.saveOnboardingAnswer(
        userJid,
        profile.onboarding_step,
        text
      );
      await sock.sendMessage(senderJid, {
        text: `I heard: “${text}”. Should I save that to your profile? Reply yes or no.`
      });
      return;
    }

    if (profile.onboarding_status === 'completed' || profile.onboarding_status === 'skipped') {
      const pendingMemory = await dependencies.dataService.getPendingMemory(userJid);
      if (pendingMemory && /^(yes|y|confirm|save)$/i.test(text.trim())) {
        const memory = await dependencies.dataService.resolvePendingMemory(userJid, true);
        await sock.sendMessage(senderJid, {
          text: memory ? `Got it — I’ll remember “${memory.memory_value}”.` : 'There is no memory waiting for confirmation.'
        });
        return;
      }
      if (pendingMemory && /^(no|n|reject|don'?t save)$/i.test(text.trim())) {
        await dependencies.dataService.resolvePendingMemory(userJid, false);
        await sock.sendMessage(senderJid, { text: 'Understood. I will not save that.' });
        return;
      }
    }

    const response = dependencies.assistant.respondWithMedia
      ? await dependencies.assistant.respondWithMedia(userJid, text)
      : { text: await dependencies.assistant.respond(userJid, text) };
    if (['task-list', 'task-detail'].includes(response.media?.type) && response.media.tasks.length > 0) {
      const image = await renderTaskListImage(response.media.tasks, {
        title: response.media.title || 'Your tasks',
        totalTasks: response.media.tasks.length
      });
      const taskCount = response.media.tasks.length;
      const nextPageHint = taskCount > MAX_TASKS_PER_CARD
        ? ` Showing the first ${MAX_TASKS_PER_CARD}; send \`!tasks 2\` for more.`
        : '';
      await sock.sendMessage(senderJid, {
        image,
        caption: `📋 ${response.media.title || 'Your tasks'} · ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}.${nextPageHint}`
      });
    } else {
      await sock.sendMessage(senderJid, { text: response.text });
    }

    if (profile.onboarding_status === 'pending') {
      await dependencies.dataService.restartOnboarding(userJid);
      await sock.sendMessage(senderJid, {
        text: 'To get to know you a little, what name should I use for you? Reply `!skip` if you’d rather not do onboarding.'
      });
    }
  } catch (error) {
    console.error('Error processing Yvonne message:', error);
    await sock.sendMessage(senderJid, {
      text: 'I could not complete that request just now. Please try again; the server log has the error details.'
    });
  }
}
