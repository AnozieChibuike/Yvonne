export class YvonneAssistant {
  constructor(groq, toolRegistry, model) {
    this.groq = groq;
    this.toolRegistry = toolRegistry;
    this.model = model;
    this.conversations = new Map();
  }

  async respond(userJid, text) {
    const history = this.conversations.get(userJid) || [];
    const messages = [
      {
        role: 'system',
        content: [
          'You are Yvonne, a warm, practical personal assistant.',
          'Be concise and conversational. Ask a brief clarifying question when needed.',
          'Use tools for tasks, saved preferences, and check-in settings instead of claiming an action without completing it.',
          'Supabase is the default task provider. Use Google Tasks only when the user explicitly asks for Google Tasks.',
          'Only save a preference when the user clearly asks you to remember it.',
          'Never claim to have sent a scheduled message or changed data unless the relevant tool succeeds.'
        ].join(' ')
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
