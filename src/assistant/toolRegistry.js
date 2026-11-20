export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(definition, execute) {
    const name = definition.function?.name;
    if (!name || typeof execute !== 'function') {
      throw new Error('A tool requires a function name and an execute handler.');
    }
    if (this.tools.has(name)) throw new Error(`Tool already registered: ${name}`);
    this.tools.set(name, { definition, execute });
  }

  definitions() {
    return [...this.tools.values()].map(({ definition }) => definition);
  }

  async execute(name, input, context) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown assistant tool: ${name}`);
    return tool.execute(input, context);
  }
}
