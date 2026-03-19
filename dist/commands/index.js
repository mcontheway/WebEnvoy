import { CommandRegistry } from "../core/registry.js";
import { runtimeCommands } from "./runtime.js";
import { xhsCommands } from "./xhs.js";
export const createCommandRegistry = () => {
    const registry = new CommandRegistry();
    for (const command of runtimeCommands()) {
        registry.register(command);
    }
    for (const command of xhsCommands()) {
        registry.register(command);
    }
    return registry;
};
