import type { CommandDefinition } from "./types.js";

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(command: CommandDefinition): void {
    this.commands.set(command.name, command);
  }

  get(commandName: string): CommandDefinition | undefined {
    return this.commands.get(commandName);
  }

  list(): CommandDefinition[] {
    return [...this.commands.values()];
  }
}
