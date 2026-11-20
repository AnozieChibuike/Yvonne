import { getTimeContext } from '../services/timeContext.js';

function requestsTaskVisual(text) {
  const mentionsTasks = /\b(?:tasks?|to-?dos?)\b/i.test(text);
  if (!mentionsTasks) return false;
  if (/\b(?:image|picture|card)\b/i.test(text)) return true;
  if (/\b(?:show|display|list|view|see|send)\b/i.test(text)) return true;
  const asksForTaskFact = /\b(?:how many|count|due|overdue|status|priority|when|which|next)\b/i.test(text);
  if (asksForTaskFact) return false;
  return /\b(?:give me|tell me)\b/i.test(text) ||
    /\bwhat\s+(?:are|is)\s+(?:my|the|all|open)?\s*tasks?\b/i.test(text) ||
    /\bwhat\s+tasks?\s+(?:do|did)\s+i\s+have\b/i.test(text);
}

function requestsReminder(text) {
  return /\bremind me\b|\b(?:set|create|schedule|make)\b.{0,24}\b(?:alarm|reminder)\b|\b(?:alarm|reminder)\s+(?:at|for|tomorrow|today)\b/i.test(text);
}

function requestedDashboardView(text) {
  if (!/\b(?:website|web\s*(?:app|page)?|dashboard|ui|interface|online|in the browser)\b/i.test(text)) return null;
  if (!/\b(?:open|visit|go to|show|see|view|access|link|where|just|can i|could i)\b/i.test(text)) return null;

  if (/\breminders?\b|\balarms?\b/i.test(text)) return 'reminders';
  if (/\btasks?\b|\bto-?dos?\b/i.test(text)) return 'tasks';
  if (/\bevents?\b/i.test(text)) return 'events';
  return 'calendar';
}

function explicitlyRequestsTask(text) {
  const taskRequest = /\b(?:add|create|make|save)\b.{0,30}\btask\b/i.exec(text);
  const reminderRequest = /\bremind me\b|\b(?:set|create|schedule|make)\b.{0,24}\b(?:alarm|reminder)\b/i.exec(text);
  return Boolean(taskRequest && (!reminderRequest || taskRequest.index < reminderRequest.index));
}

function formatReminderConfirmation(reminder) {
  const kind = reminder.kind === 'alarm' ? 'Alarm' : 'Reminder';
  const repeat = reminder.recurrence === 'once' ? 'one-time' : reminder.recurrence;
  return `✅ Saved ${kind.toLowerCase()} “${reminder.title}” for ${reminder.remind_at_local} Africa/Lagos (${repeat}). It’s separate from your tasks. Send !reminders to verify it.`;
}

function formatReminderList(reminders) {
  if (!reminders.length) return 'You have no scheduled reminders or alarms.';
  const lines = reminders.map(reminder => {
    const kind = reminder.kind === 'alarm' ? 'Alarm' : 'Reminder';
    const repeat = reminder.recurrence === 'once' ? '' : ` · ${reminder.recurrence}`;
    return `• ${kind}: ${reminder.title} — ${reminder.remind_at_local}${repeat}`;
  });
  return `Your scheduled reminders and alarms (separate from tasks):\n${lines.join('\n')}`;
}

function formatConfirmedAction(toolName, result) {
  if (toolName === 'create_reminder') return formatReminderConfirmation(result);
  if (toolName === 'list_reminders') return formatReminderList(result);
  if (toolName === 'cancel_reminder') return `Cancelled ${result.title ? `“${result.title}”` : 'that reminder'}.`;
  return null;
}

export class YvonneAssistant {
  constructor(groq, toolRegistry, model, dataService = null, clock = () => new Date()) {
    this.groq = groq;
    this.toolRegistry = toolRegistry;
    this.model = model;
    this.dataService = dataService;
    this.clock = clock;
    this.conversations = new Map();
  }

  async respond(userJid, text) {
    const response = await this.respondWithMedia(userJid, text);
    return response.text;
  }

  async respondWithMedia(userJid, text) {
    const history = this.conversations.get(userJid) || [];
    const dashboardView = requestedDashboardView(text);
    if (dashboardView) {
      let reply;
      try {
        const link = await this.toolRegistry.execute(
          'get_web_dashboard_link',
          { view: dashboardView },
          { userJid }
        );
        reply = `Here’s your Yvonne website: ${link.url}`;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'The Yvonne web app URL is not configured.') {
          throw error;
        }
        reply = 'I don’t have a Yvonne website URL configured on my server yet.';
      }
      this.conversations.set(userJid, [
        ...history,
        { role: 'user', content: text },
        { role: 'assistant', content: reply }
      ].slice(-12));
      return { text: reply, media: null };
    }

    const savedMemories = this.dataService
      ? (await this.dataService.listMemories(userJid))
        .filter(memory => memory.status === 'confirmed')
        .map(({ memory_key, memory_value }) => ({ key: memory_key, value: memory_value }))
      : [];
    const savedPreferences = this.dataService
      ? await this.dataService.listPreferences(userJid)
      : [];
    const pendingMemory = this.dataService
      ? await this.dataService.getPendingMemory(userJid)
      : null;
    const timeContext = getTimeContext(this.clock());
    const messages = [
      {
        role: 'system',
        content: [
          'You are Yvonne, a warm, practical personal assistant.',
          'Be concise and conversational. Ask a brief clarifying question when needed.',
          'Never invent or guess URLs, domains, or routes. For requests to open or view the Yvonne website/dashboard, use get_web_dashboard_link and provide exactly its URL. If the URL is not configured, say so plainly.',
          'Web UI link policy: attach a dashboard link only when the user asks to open, visit, view, see, or access the web UI, asks where to manage Yvonne data online, or requests a web link. Do not append links to routine task or reminder confirmations, ordinary lists, check-ins, or unrelated replies. For a dashboard section, use get_web_dashboard_link with the matching view; for a specific item, use get_web_item_link only with its exact ID from a data tool.',
          'Use only WhatsApp formatting: *bold*, _italic_, ~strikethrough~, and ```monospace```. Never use HTML tags, Markdown ** or __, or tables. Prefer short paragraphs and simple bullets.',
          'Tasks are to-dos and may have no due date. A task due date does not schedule a WhatsApp message. Reminders and alarms are separate scheduled notifications; use reminder tools for them and never count or report them as tasks. Create both only when the user explicitly asks for both.',
          'Send task image cards only when the user explicitly asks to see, show, list, or display their tasks. For task counts, due-date questions, reminders, or other requests, answer in text only.',
          'When the user asks to inspect one task, use list_tasks to find its ID, then get_task to retrieve it.',
          `Authoritative VPS clock: ${JSON.stringify(timeContext)}. The date and time are the current Africa/Lagos local values. Use this clock for relative dates and times, not timestamps from conversation history.`,
          'When asked for the current time or date, answer from this clock context. Do not guess or use model training knowledge.',
          'Use tools for tasks, reminders, saved preferences, and check-in settings instead of claiming an action without completing it.',
          'Supabase is the default task provider. Use Google Tasks only when the user explicitly asks for Google Tasks.',
          'One-time reminders and alarms are the default. Only create a recurring alarm if the user explicitly asks for a repeat schedule.',
          'When interpreting dates, send reminders using an ISO 8601 timestamp with the Africa/Lagos UTC+01:00 offset. Ask a clarification instead of guessing when a date or time is ambiguous.',
          'Only confirmed memory records below are facts. Never infer facts from old conversation history or claim to remember unconfirmed proposals.',
          'If a memory proposal is already pending, ask the user to confirm or reject it before suggesting another memory.',
          'For a stable fact or preference that may help later, use propose_memory and ask the user to confirm before treating it as remembered. If the user asks explicitly to remember something, use remember_preference.',
          'Never claim to have sent a scheduled message or changed data unless the relevant tool succeeds.'
        ].join(' '),
      },
      {
        role: 'system',
        content: `Confirmed memories (source of truth): ${JSON.stringify(savedMemories)}. Explicitly saved preferences: ${JSON.stringify(savedPreferences)}. Pending memory confirmation: ${JSON.stringify(pendingMemory)}.`
      },
      ...history,
      { role: 'user', content: text }
    ];
    const wantsTaskCard = requestsTaskVisual(text);
    const reminderOnlyRequest = requestsReminder(text) && !explicitlyRequestsTask(text);
    let media = null;
    let confirmedActionText = null;
    let createdReminder = false;

    for (let round = 0; round < 5; round += 1) {
      const completion = await this.groq.chat.completions.create({
        model: this.model,
        messages,
        tools: this.toolRegistry.definitions(),
        tool_choice: 'auto',
        temperature: 0.4,
        max_tokens: 800
      });

      const assistantMessage = completion.choices?.[0]?.message;
      if (!assistantMessage) throw new Error('Groq returned an empty assistant response.');
      messages.push(assistantMessage);

      if (!assistantMessage.tool_calls?.length) {
        const reply = assistantMessage.content?.trim();
        if (!reply) throw new Error('Groq returned an empty text response.');
        const isClarifyingOrDeclining = reply.includes('?') ||
          /\b(?:what|which|when|please|provide|tell me|need (?:an?|the) exact|cannot|can't|unable|not saved|haven't saved)\b/i.test(reply);
        const reminderNotCreated = requestsReminder(text) && !createdReminder;
        const finalReply = reminderNotCreated
          ? isClarifyingOrDeclining
            ? reply
            : 'I have not saved a reminder yet. Please tell me the exact date and time, and I’ll confirm it after it is saved.'
          : confirmedActionText || reply;
        this.conversations.set(userJid, [
          ...history,
          { role: 'user', content: text },
          { role: 'assistant', content: finalReply }
        ].slice(-12));
        return { text: finalReply, media };
      }

      for (const toolCall of assistantMessage.tool_calls) {
        let input;
        try {
          input = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          throw new Error(`Groq returned invalid arguments for ${toolCall.function.name}.`);
        }

        const blockedTaskCreation = reminderOnlyRequest && toolCall.function.name === 'add_task';
        const result = blockedTaskCreation
          ? {
            error: 'Do not add this as a task. The user asked for a reminder; use create_reminder or ask for a precise date and time.'
          }
          : await this.toolRegistry.execute(toolCall.function.name, input, { userJid });
        const actionText = formatConfirmedAction(toolCall.function.name, result);
        if (actionText) confirmedActionText = actionText;
        if (toolCall.function.name === 'create_reminder') createdReminder = true;
        if (wantsTaskCard && toolCall.function.name === 'list_tasks' && Array.isArray(result)) {
          media = {
            type: 'task-list',
            title: input.provider === 'google' ? 'Google tasks' : 'Your tasks',
            tasks: result
          };
        }
        if (wantsTaskCard && toolCall.function.name === 'get_task' && result && !Array.isArray(result)) {
          media = { type: 'task-detail', title: 'Task details', tasks: [result] };
        }
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
    }

    throw new Error('Yvonne reached the maximum number of tool steps for one reply.');
  }
}
