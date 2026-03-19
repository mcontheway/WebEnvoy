export class CommandRegistry {
    commands = new Map();
    register(command) {
        this.commands.set(command.name, command);
    }
    get(commandName) {
        return this.commands.get(commandName);
    }
    list() {
        return [...this.commands.values()];
    }
}
