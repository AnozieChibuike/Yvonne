export class YvonneAssistant {
  constructor(groq, toolRegistry, model, dataService = null) {
    this.groq = groq;
    this.toolRegistry = toolRegistry;
    this.model = model;
    this.dataService = dataService;
    this.conversations = new Map();
  }

  async respond(userJid, text) {
    const history = this.conversations.get(userJid) || [];
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
    const localNow = new Intl.DateTimeFormat('en-NG', {
      timeZone: 'Africa/Lagos',
      dateStyle: 'full',
      timeStyle: 'long'
    }).format(new Date());
    const messages = [
      {
        role: 'system',
        content: [
          'You are Yvonne, a warm, practical personal assistant.',
          'Be concise and conversational. Ask a brief clarifying question when needed.',
          `The current time is ${localNow} in Africa/Lagos. Use this as the reference for relative reminder times.`,
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
        this.conversations.set(userJid, [
          ...history,
          { role: 'user', content: text },
          { role: 'assistant', content: reply }
        ].slice(-12));
        return reply;
      }

      for (const toolCall of assistantMessage.tool_calls) {
        let input;
        try {
          input = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          throw new Error(`Groq returned invalid arguments for ${toolCall.function.name}.`);
        }

        const result = await this.toolRegistry.execute(toolCall.function.name, input, { userJid });
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
