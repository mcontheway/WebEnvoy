import { CommandRegistry } from "../core/registry.js";
import { runtimeCommands } from "./runtime.js";
export const createCommandRegistry = () => {
    const registry = new CommandRegistry();
    for (const command of runtimeCommands()) {
        registry.register(command);
    }
    registry.register({
        name: "xhs.search",
        status: "not_implemented",
        requiresProfile: false
    });
    return registry;
};
