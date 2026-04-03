import { access, chmod, copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "../core/errors.js";
import { PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME } from "../runtime/native-messaging/host.js";
import { inspectManagedNativeHostInstall, resolveNativeHostInstallRoots } from "./native-host-install-root.js";
export const DEFAULT_NATIVE_HOST_NAME = "com.webenvoy.host";
export const DEFAULT_BROWSER_CHANNEL = "chrome";
const NATIVE_HOST_DESCRIPTION = "WebEnvoy CLI ↔ Extension bridge";
const MANAGED_INSTALL_METADATA_FILENAME = "install-metadata.json";
const BROWSER_CHANNELS = ["chrome", "chrome_beta", "chromium", "brave", "edge"];
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const NATIVE_HOST_NAME_PATTERN = /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/;
const asAbsolutePath = (cwd, input) => isAbsolute(input) ? input : resolve(cwd, input);
const nativeHostPathError = (abilityId, reason, details) => new CliError("ERR_CLI_INVALID_ARGS", "安装命令参数不合法", {
    details: {
        ability_id: abilityId,
        stage: "input_validation",
        reason,
        ...details
    }
});
const pathExists = async (filePath) => {
    try {
        await access(filePath);
        return true;
    }
    catch {
        return false;
    }
};
const assertNotSymlink = async (command, field, targetPath) => {
    try {
        const stat = await lstat(targetPath);
        if (!stat.isSymbolicLink()) {
            return;
        }
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code === "ENOENT") {
            return;
        }
        throw error;
    }
    throw nativeHostPathError(command, "INSTALL_PATH_SYMBOLIC_LINK", {
        field,
        received_path: targetPath
    });
};
const assertNoSymlinkAncestorBetween = async (input) => {
    const normalizedFrom = normalizePathForBoundaryCheck(input.fromDir);
    const normalizedTarget = normalizePathForBoundaryCheck(input.targetDir);
    const rel = relative(normalizedFrom, normalizedTarget);
    const isInside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    if (!isInside) {
        return;
    }
    const segments = rel === "" ? [] : rel.split(sep).filter((segment) => segment.length > 0 && segment !== ".");
    let current = normalizedFrom;
    try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) {
            throw nativeHostPathError(input.command, "INSTALL_PATH_PARENT_SYMBOLIC_LINK", {
                field: input.field,
                received_path: current
            });
        }
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code !== "ENOENT") {
            throw error;
        }
    }
    for (const segment of segments) {
        current = join(current, segment);
        try {
            const stat = await lstat(current);
            if (!stat.isSymbolicLink()) {
                continue;
            }
        }
        catch (error) {
            const nodeError = error;
            if (nodeError.code === "ENOENT") {
                continue;
            }
            throw error;
        }
        throw nativeHostPathError(input.command, "INSTALL_PATH_PARENT_SYMBOLIC_LINK", {
            field: input.field,
            received_path: current
        });
    }
};
const quoteShellToken = (value) => JSON.stringify(value);
const quoteShellArgForScript = (value) => `'${value.replace(/'/g, `'\"'\"'`)}'`;
const tokenizeHostCommand = (command, hostCommand) => {
    const tokens = [];
    let current = "";
    let index = 0;
    let quote = null;
    const pushCurrent = () => {
        if (current.length === 0) {
            return;
        }
        tokens.push(current);
        current = "";
    };
    while (index < hostCommand.length) {
        const char = hostCommand[index];
        if (quote === null) {
            if (/\s/.test(char)) {
                pushCurrent();
                index += 1;
                continue;
            }
            if (char === "'" || char === '"') {
                quote = char;
                index += 1;
                continue;
            }
            if (char === "\\") {
                const next = hostCommand[index + 1];
                if (typeof next !== "string") {
                    throw nativeHostPathError(command, "HOST_COMMAND_INVALID", {
                        field: "host_command"
                    });
                }
                current += next;
                index += 2;
                continue;
            }
            if ("|&;<>$`()\n\r".includes(char)) {
                throw nativeHostPathError(command, "HOST_COMMAND_INVALID", {
                    field: "host_command"
                });
            }
            current += char;
            index += 1;
            continue;
        }
        if (char === quote) {
            quote = null;
            index += 1;
            continue;
        }
        if (quote === '"' && char === "\\") {
            const next = hostCommand[index + 1];
            if (typeof next !== "string") {
                throw nativeHostPathError(command, "HOST_COMMAND_INVALID", {
                    field: "host_command"
                });
            }
            current += next;
            index += 2;
            continue;
        }
        current += char;
        index += 1;
    }
    if (quote !== null) {
        throw nativeHostPathError(command, "HOST_COMMAND_INVALID", {
            field: "host_command"
        });
    }
    pushCurrent();
    if (tokens.length === 0) {
        throw nativeHostPathError(command, "HOST_COMMAND_INVALID", {
            field: "host_command"
        });
    }
    return tokens;
};
const resolveCurrentBuildNativeHostRuntimePaths = () => {
    const distInstallDir = dirname(fileURLToPath(import.meta.url));
    const distRuntimeDir = resolve(distInstallDir, "..", "runtime");
    return {
        entryPath: join(distRuntimeDir, "native-messaging", "native-host-entry.js"),
        protocolPath: join(distRuntimeDir, "native-messaging", "protocol.js"),
        hostPath: join(distRuntimeDir, "native-messaging", "host.js"),
        worktreeRootPath: join(distRuntimeDir, "worktree-root.js")
    };
};
const resolveBundledNativeHostRuntimePaths = (channelRoot) => {
    const runtimeRoot = join(channelRoot, "runtime");
    return {
        runtimeRoot,
        entryPath: join(runtimeRoot, "native-messaging", "native-host-entry.js"),
        protocolPath: join(runtimeRoot, "native-messaging", "protocol.js"),
        hostPath: join(runtimeRoot, "native-messaging", "host.js"),
        worktreeRootPath: join(runtimeRoot, "worktree-root.js"),
        packageJsonPath: join(runtimeRoot, "package.json")
    };
};
const ensureBundledNativeHostRuntime = async (channelRoot) => {
    const source = resolveCurrentBuildNativeHostRuntimePaths();
    const target = resolveBundledNativeHostRuntimePaths(channelRoot);
    await mkdir(dirname(target.entryPath), { recursive: true });
    await copyFile(source.entryPath, target.entryPath);
    await copyFile(source.protocolPath, target.protocolPath);
    await copyFile(source.hostPath, target.hostPath);
    await copyFile(source.worktreeRootPath, target.worktreeRootPath);
    await writeFile(target.packageJsonPath, `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf8");
    return target.entryPath;
};
export const resolveRepoOwnedNativeHostEntryPath = () => resolveCurrentBuildNativeHostRuntimePaths().entryPath;
const resolveComparablePath = async (cwd, filePath) => {
    const absolutePath = asAbsolutePath(cwd, filePath);
    try {
        return await realpath(absolutePath);
    }
    catch {
        return resolve(absolutePath);
    }
};
const NATIVE_HOST_ENTRY_BASENAME = "native-host-entry.js";
const INSPECTABLE_SHELL_WRAPPER_SCRIPT_EXTENSIONS = new Set([
    ".sh",
    ".bash",
    ".zsh",
    ".command"
]);
const INSPECTABLE_NODE_WRAPPER_SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const KNOWN_WRAPPER_INTERPRETER_BASENAMES = new Set(["bash", "sh", "zsh", "env", "node"]);
const SHELL_CONTROL_OR_BUILTIN_TOKENS = new Set([
    "if",
    "then",
    "elif",
    "else",
    "fi",
    "for",
    "while",
    "until",
    "do",
    "done",
    "case",
    "esac",
    "function",
    "local",
    "readonly",
    "declare",
    "typeset",
    "export",
    "return",
    "exit",
    "source",
    ".",
    "cd",
    "echo",
    "printf",
    "test",
    "[",
    "[["
]);
const INLINE_SHELL_COMMAND_TOKENS = new Set(["-c", "-lc"]);
const MAX_HOST_COMMAND_REFERENCE_DEPTH = 4;
const MAX_INSPECTABLE_SCRIPT_BYTES = 128 * 1024;
const isEnvironmentAssignmentToken = (token) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
const isInspectableWrapperScriptPath = (filePath) => basename(filePath) === NATIVE_HOST_ENTRY_BASENAME ||
    INSPECTABLE_SHELL_WRAPPER_SCRIPT_EXTENSIONS.has(extname(filePath).toLowerCase()) ||
    INSPECTABLE_NODE_WRAPPER_SCRIPT_EXTENSIONS.has(extname(filePath).toLowerCase());
const isJavascriptWrapperScriptPath = (filePath) => INSPECTABLE_NODE_WRAPPER_SCRIPT_EXTENSIONS.has(extname(filePath).toLowerCase());
const parseLiteralShellAssignment = (line) => {
    const trimmed = line.trim();
    const quotedMatch = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(['"])(.*)\2$/);
    if (quotedMatch) {
        return {
            name: quotedMatch[1],
            value: quotedMatch[3]
        };
    }
    const unquotedMatch = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=([^\s"'`;|&<>()]+)$/);
    if (!unquotedMatch) {
        return null;
    }
    return {
        name: unquotedMatch[1],
        value: unquotedMatch[2]
    };
};
const parseWrapperDirectoryAssignment = (line, wrapperScriptPath) => {
    const match = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
    if (!match) {
        return null;
    }
    const valueExpression = match[2];
    const dirnameSourcePattern = '(?:\\$0|\\$\\{0\\}|\\$\\{BASH_SOURCE\\[0\\]\\})';
    const dirnamePath = dirname(wrapperScriptPath);
    const normalizedExpression = valueExpression.replace(/^['"]|['"]$/g, "");
    const replacedExpression = normalizedExpression
        .replace(new RegExp(`\\$\\(\\s*cd\\s+["']?\\$\\(\\s*dirname\\s+["']?${dirnameSourcePattern}["']?\\s*\\)["']?\\s*&&\\s*pwd\\s*\\)`, "g"), dirnamePath)
        .replace(new RegExp(`\\$\\(\\s*dirname\\s+["']?${dirnameSourcePattern}["']?\\s*\\)`, "g"), dirnamePath);
    if (replacedExpression === normalizedExpression ||
        (!valueExpression.includes("$0") &&
            !valueExpression.includes("${0}") &&
            !valueExpression.includes("${BASH_SOURCE[0]}"))) {
        return null;
    }
    return {
        name: match[1],
        value: isAbsolute(replacedExpression)
            ? resolve(replacedExpression)
            : resolve(dirnamePath, replacedExpression)
    };
};
const substituteKnownShellVariables = (value, variables) => (variables.get("BASH_SOURCE[0]")
    ? value.replace(/\$\{BASH_SOURCE\[0\]\}/g, variables.get("BASH_SOURCE[0]"))
    : value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*|0)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$0/g, (match, braced, bare) => {
    const variableName = typeof braced === "string" && braced.length > 0 ? braced : typeof bare === "string" ? bare : "0";
    return variableName ? (variables.get(variableName) ?? match) : match;
});
const tokenizeHostCommandForInspection = (command, hostCommand) => {
    try {
        return tokenizeHostCommand(command, hostCommand);
    }
    catch {
        return null;
    }
};
const looksLikeExternalCommandToken = (token) => token.includes("/") ||
    KNOWN_WRAPPER_INTERPRETER_BASENAMES.has(basename(token)) ||
    /\.(?:sh|bash|zsh|command|js|mjs|cjs)$/i.test(token);
const splitShellStatements = (line) => {
    const statements = [];
    let current = "";
    let quote = null;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (quote === null && char === ";") {
            if (current.trim().length > 0) {
                statements.push(current.trim());
            }
            current = "";
            continue;
        }
        if (char === "'" || char === '"') {
            if (quote === char) {
                quote = null;
            }
            else if (quote === null) {
                quote = char;
            }
        }
        current += char;
    }
    if (current.trim().length > 0) {
        statements.push(current.trim());
    }
    return statements;
};
const isIgnorableScriptLine = (line) => {
    const trimmedLine = line.trim();
    return (trimmedLine.length === 0 ||
        trimmedLine.startsWith("#") ||
        trimmedLine.startsWith("//") ||
        trimmedLine.startsWith("/*") ||
        trimmedLine === "*/" ||
        trimmedLine.startsWith("*"));
};
const extractRunnableCommandText = (command, line) => {
    const execMatch = line.match(/^\s*exec\s+(.+)$/);
    if (execMatch) {
        return execMatch[1].trim();
    }
    const tokens = tokenizeHostCommandForInspection(command, line.trim());
    if (!tokens || tokens.length === 0) {
        return null;
    }
    const firstToken = tokens[0];
    if (firstToken.length === 0 ||
        firstToken.startsWith("-") ||
        isEnvironmentAssignmentToken(firstToken) ||
        SHELL_CONTROL_OR_BUILTIN_TOKENS.has(firstToken)) {
        return null;
    }
    return looksLikeExternalCommandToken(firstToken) ? line.trim() : null;
};
const readInspectableWrapperScript = async (filePath) => {
    let raw;
    try {
        raw = await readFile(filePath, "utf8");
    }
    catch {
        return null;
    }
    if (raw.length > MAX_INSPECTABLE_SCRIPT_BYTES || raw.includes("\u0000")) {
        return null;
    }
    if (raw.startsWith("#!") || isInspectableWrapperScriptPath(filePath)) {
        return raw;
    }
    return null;
};
const isManagedNativeHostEntryPath = (entryPath) => {
    const normalizedEntryPath = resolve(entryPath);
    if (basename(normalizedEntryPath) !== NATIVE_HOST_ENTRY_BASENAME) {
        return false;
    }
    const nativeMessagingDir = dirname(normalizedEntryPath);
    if (basename(nativeMessagingDir) !== "native-messaging") {
        return false;
    }
    const runtimeRoot = dirname(nativeMessagingDir);
    if (basename(runtimeRoot) !== "runtime") {
        return false;
    }
    const managedInstall = inspectManagedNativeHostInstall(join(dirname(runtimeRoot), "bin", "detector"));
    return managedInstall?.runtimeRoot === runtimeRoot;
};
const isRepoOwnedNativeHostEntryPath = async (cwd, filePath) => {
    const [candidatePath, repoOwnedEntryPath] = await Promise.all([
        resolveComparablePath(cwd, filePath),
        resolveComparablePath(cwd, resolveRepoOwnedNativeHostEntryPath())
    ]);
    return candidatePath === repoOwnedEntryPath || isManagedNativeHostEntryPath(candidatePath);
};
const candidatePathReferencesRepoOwnedNativeHost = async (input) => {
    if (await isRepoOwnedNativeHostEntryPath(input.baseDir, input.candidate)) {
        return true;
    }
    const comparableCandidatePath = await resolveComparablePath(input.baseDir, input.candidate);
    if (KNOWN_WRAPPER_INTERPRETER_BASENAMES.has(basename(comparableCandidatePath)) &&
        !isInspectableWrapperScriptPath(comparableCandidatePath)) {
        return false;
    }
    if (input.visitedFiles.has(comparableCandidatePath)) {
        return false;
    }
    const wrapperScript = await readInspectableWrapperScript(comparableCandidatePath);
    if (!wrapperScript) {
        return false;
    }
    input.visitedFiles.add(comparableCandidatePath);
    return tokenReferencesRepoOwnedNativeHost({
        command: input.command,
        baseDir: dirname(comparableCandidatePath),
        text: wrapperScript,
        depth: input.depth + 1,
        visitedFiles: input.visitedFiles,
        currentScriptPath: comparableCandidatePath
    });
};
const commandTextReferencesRepoOwnedNativeHost = async (input) => {
    const tokens = tokenizeHostCommandForInspection(input.command, input.commandText);
    if (!tokens) {
        return false;
    }
    for (const token of tokens) {
        if (token.length === 0 ||
            token === "$@" ||
            token === "${@}" ||
            token.startsWith("-") ||
            isEnvironmentAssignmentToken(token) ||
            token.includes("$")) {
            continue;
        }
        if (await candidatePathReferencesRepoOwnedNativeHost({
            command: input.command,
            baseDir: input.baseDir,
            candidate: token,
            depth: input.depth,
            visitedFiles: input.visitedFiles
        })) {
            return true;
        }
    }
    return false;
};
const stripTrailingJavascriptPunctuation = (value) => value.trim().replace(/[;,]+$/g, "");
const stripBalancedOuterParentheses = (value) => {
    let current = value.trim();
    while (current.startsWith("(") && current.endsWith(")")) {
        let depth = 0;
        let quote = null;
        let escaped = false;
        let isBalanced = true;
        for (let index = 0; index < current.length; index += 1) {
            const char = current[index];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (quote) {
                if (char === "\\") {
                    escaped = true;
                }
                else if (char === quote) {
                    quote = null;
                }
                continue;
            }
            if (char === "'" || char === '"' || char === "`") {
                quote = char;
                continue;
            }
            if (char === "(") {
                depth += 1;
                continue;
            }
            if (char === ")") {
                depth -= 1;
                if (depth === 0 && index !== current.length - 1) {
                    isBalanced = false;
                    break;
                }
            }
        }
        if (!isBalanced || depth !== 0) {
            break;
        }
        current = current.slice(1, -1).trim();
    }
    return current;
};
const splitTopLevelJavascriptExpressions = (text) => {
    const expressions = [];
    let current = "";
    let quote = null;
    let escaped = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (quote) {
            current += char;
            if (char === "\\") {
                escaped = true;
            }
            else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            current += char;
            continue;
        }
        if (char === "(") {
            parenDepth += 1;
            current += char;
            continue;
        }
        if (char === ")") {
            parenDepth -= 1;
            current += char;
            continue;
        }
        if (char === "[") {
            bracketDepth += 1;
            current += char;
            continue;
        }
        if (char === "]") {
            bracketDepth -= 1;
            current += char;
            continue;
        }
        if (char === "{") {
            braceDepth += 1;
            current += char;
            continue;
        }
        if (char === "}") {
            braceDepth -= 1;
            current += char;
            continue;
        }
        if (char === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            if (current.trim().length > 0) {
                expressions.push(current.trim());
            }
            current = "";
            continue;
        }
        current += char;
    }
    if (current.trim().length > 0) {
        expressions.push(current.trim());
    }
    return expressions;
};
const parseJavascriptAssignmentExpression = (line) => {
    const match = line.trim().match(/^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+?)\s*;?$/);
    if (!match) {
        return null;
    }
    return {
        name: match[1],
        expression: match[2]
    };
};
const resolveJavascriptPathPart = (expression, variables, currentScriptDir) => {
    const trimmed = stripBalancedOuterParentheses(stripTrailingJavascriptPunctuation(expression));
    if (trimmed === "__dirname" || trimmed === "import.meta.dirname" || trimmed === "dirname(fileURLToPath(import.meta.url))") {
        return currentScriptDir;
    }
    const literalMatch = trimmed.match(/^(["'`])([^"'`$]*)\1$/);
    if (literalMatch) {
        return literalMatch[2];
    }
    return variables.get(trimmed) ?? null;
};
const resolveJavascriptExpressionCandidates = (expression, variables, currentScriptDir) => {
    const trimmed = stripBalancedOuterParentheses(stripTrailingJavascriptPunctuation(expression));
    const directPart = resolveJavascriptPathPart(trimmed, variables, currentScriptDir);
    if (directPart) {
        return [directPart];
    }
    const fileUrlToPathMatch = trimmed.match(/^fileURLToPath\((.+)\)$/);
    if (fileUrlToPathMatch) {
        return resolveJavascriptExpressionCandidates(fileUrlToPathMatch[1], variables, currentScriptDir);
    }
    const newUrlMatch = trimmed.match(/^new URL\((.+)\)$/);
    if (newUrlMatch) {
        const args = splitTopLevelJavascriptExpressions(newUrlMatch[1]);
        if (args.length >= 2 && args[1].trim() === "import.meta.url") {
            return resolveJavascriptExpressionCandidates(args[0], variables, currentScriptDir).map((candidate) => asAbsolutePath(currentScriptDir, candidate));
        }
    }
    const pathCallMatch = trimmed.match(/^(?:path\.)?(join|resolve)\((.+)\)$/);
    if (pathCallMatch) {
        const [, method, rawArgs] = pathCallMatch;
        const args = splitTopLevelJavascriptExpressions(rawArgs);
        const parts = [];
        for (const arg of args) {
            const resolvedPart = resolveJavascriptPathPart(arg, variables, currentScriptDir) ??
                (() => {
                    const nestedCandidates = resolveJavascriptExpressionCandidates(arg, variables, currentScriptDir);
                    return nestedCandidates.length === 1 ? nestedCandidates[0] : null;
                })();
            if (!resolvedPart) {
                return [];
            }
            parts.push(resolvedPart);
        }
        return [method === "resolve" ? resolve(...parts) : join(...parts)];
    }
    return [];
};
const extractJavascriptCallArguments = (line, calleePattern) => {
    const match = calleePattern.exec(line);
    if (!match || typeof match.index !== "number") {
        return null;
    }
    const openParenIndex = line.indexOf("(", match.index);
    if (openParenIndex < 0) {
        return null;
    }
    let quote = null;
    let escaped = false;
    let depth = 0;
    let endIndex = -1;
    for (let index = openParenIndex; index < line.length; index += 1) {
        const char = line[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (quote) {
            if (char === "\\") {
                escaped = true;
            }
            else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            continue;
        }
        if (char === "(") {
            depth += 1;
            continue;
        }
        if (char === ")") {
            depth -= 1;
            if (depth === 0) {
                endIndex = index;
                break;
            }
        }
    }
    if (endIndex < 0) {
        return null;
    }
    return splitTopLevelJavascriptExpressions(line.slice(openParenIndex + 1, endIndex));
};
const extractJavascriptArrayItems = (expression) => {
    const trimmed = stripBalancedOuterParentheses(stripTrailingJavascriptPunctuation(expression));
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
        return [];
    }
    return splitTopLevelJavascriptExpressions(trimmed.slice(1, -1)).filter((item) => !item.startsWith("..."));
};
const extractJavascriptExecutionCandidates = (line, variables, arrayVariables, currentScriptDir) => {
    const candidates = new Set();
    const addExpression = (expression) => {
        if (!expression) {
            return;
        }
        for (const resolved of resolveJavascriptExpressionCandidates(expression, variables, currentScriptDir)) {
            candidates.add(resolved);
        }
    };
    const importFromMatch = line.match(/\bimport\s+.+?\s+from\s+(.+?)\s*;?$/);
    addExpression(importFromMatch?.[1]);
    const dynamicImportArgs = extractJavascriptCallArguments(line, /\b(?:await\s+)?import\s*\(/);
    if (dynamicImportArgs && dynamicImportArgs.length > 0) {
        addExpression(dynamicImportArgs[0]);
    }
    const requireArgs = extractJavascriptCallArguments(line, /\brequire\s*\(/);
    if (requireArgs && requireArgs.length > 0) {
        addExpression(requireArgs[0]);
    }
    const forkArgs = extractJavascriptCallArguments(line, /\bfork\s*\(/);
    if (forkArgs && forkArgs.length > 0) {
        addExpression(forkArgs[0]);
    }
    const spawnArgs = extractJavascriptCallArguments(line, /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(/);
    if (spawnArgs) {
        addExpression(spawnArgs[0]);
        if (spawnArgs.length > 1) {
            const argvExpression = stripBalancedOuterParentheses(stripTrailingJavascriptPunctuation(spawnArgs[1]));
            const argvItems = arrayVariables.get(argvExpression) ?? extractJavascriptArrayItems(argvExpression);
            for (const item of argvItems) {
                if (arrayVariables.has(item)) {
                    for (const nestedItem of arrayVariables.get(item) ?? []) {
                        addExpression(nestedItem);
                    }
                    continue;
                }
                addExpression(item);
            }
        }
    }
    return [...candidates];
};
const javascriptTextReferencesRepoOwnedNativeHost = async (input) => {
    const variables = new Map();
    const arrayVariables = new Map();
    for (const rawLine of input.text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (isIgnorableScriptLine(line)) {
            continue;
        }
        const assignment = parseJavascriptAssignmentExpression(line);
        if (assignment) {
            const resolvedAssignment = resolveJavascriptExpressionCandidates(assignment.expression, variables, input.baseDir);
            if (resolvedAssignment.length === 1) {
                variables.set(assignment.name, resolvedAssignment[0]);
            }
            const resolvedArrayItems = extractJavascriptArrayItems(assignment.expression);
            if (resolvedArrayItems.length > 0) {
                arrayVariables.set(assignment.name, resolvedArrayItems);
            }
        }
        for (const candidate of extractJavascriptExecutionCandidates(line, variables, arrayVariables, input.baseDir)) {
            if (await candidatePathReferencesRepoOwnedNativeHost({
                command: input.command,
                baseDir: input.baseDir,
                candidate,
                depth: input.depth,
                visitedFiles: input.visitedFiles
            })) {
                return true;
            }
        }
    }
    return false;
};
const tokenReferencesRepoOwnedNativeHost = async (input) => {
    if (input.depth > MAX_HOST_COMMAND_REFERENCE_DEPTH) {
        return false;
    }
    if (input.currentScriptPath && isJavascriptWrapperScriptPath(input.currentScriptPath)) {
        return javascriptTextReferencesRepoOwnedNativeHost({
            command: input.command,
            baseDir: input.baseDir,
            text: input.text,
            depth: input.depth,
            visitedFiles: input.visitedFiles
        });
    }
    const variables = new Map();
    if (input.currentScriptPath) {
        variables.set("0", input.currentScriptPath);
        variables.set("BASH_SOURCE[0]", input.currentScriptPath);
    }
    for (const rawLine of input.text.split(/\r?\n/)) {
        for (const statement of splitShellStatements(rawLine)) {
            let hasDirectoryAssignment = false;
            if (input.currentScriptPath) {
                const directoryAssignment = parseWrapperDirectoryAssignment(statement, input.currentScriptPath);
                if (directoryAssignment) {
                    variables.set(directoryAssignment.name, directoryAssignment.value);
                    hasDirectoryAssignment = true;
                }
            }
            const line = substituteKnownShellVariables(statement, variables);
            if (isIgnorableScriptLine(line)) {
                continue;
            }
            const assignment = hasDirectoryAssignment ? null : parseLiteralShellAssignment(line);
            if (assignment) {
                variables.set(assignment.name, substituteKnownShellVariables(assignment.value, variables));
            }
            const runnableCommandText = extractRunnableCommandText(input.command, line);
            if (!runnableCommandText) {
                continue;
            }
            if (await commandTextReferencesRepoOwnedNativeHost({
                command: input.command,
                baseDir: input.baseDir,
                commandText: runnableCommandText,
                depth: input.depth,
                visitedFiles: input.visitedFiles
            })) {
                return true;
            }
        }
    }
    return false;
};
const shouldExportLegacyProfileDirForExplicitHost = async (input) => {
    if (!input.profileDir) {
        return false;
    }
    const tokens = tokenizeHostCommand(input.command, input.hostCommand);
    const visitedFiles = new Set();
    for (const [index, token] of tokens.entries()) {
        if (token.startsWith("-") || isEnvironmentAssignmentToken(token)) {
            continue;
        }
        if (await isRepoOwnedNativeHostEntryPath(input.cwd, token)) {
            return false;
        }
        const previousToken = index > 0 ? tokens[index - 1] : null;
        if (previousToken && INLINE_SHELL_COMMAND_TOKENS.has(previousToken)) {
            if (await tokenReferencesRepoOwnedNativeHost({
                command: input.command,
                baseDir: input.cwd,
                text: token,
                depth: 0,
                visitedFiles
            })) {
                return false;
            }
            continue;
        }
        if (token.includes("$")) {
            continue;
        }
        const comparableCandidatePath = await resolveComparablePath(input.cwd, token);
        if (KNOWN_WRAPPER_INTERPRETER_BASENAMES.has(basename(comparableCandidatePath)) &&
            !isInspectableWrapperScriptPath(comparableCandidatePath)) {
            continue;
        }
        if (visitedFiles.has(comparableCandidatePath)) {
            continue;
        }
        const wrapperScript = await readInspectableWrapperScript(comparableCandidatePath);
        if (!wrapperScript) {
            continue;
        }
        visitedFiles.add(comparableCandidatePath);
        if (await tokenReferencesRepoOwnedNativeHost({
            command: input.command,
            baseDir: dirname(comparableCandidatePath),
            text: wrapperScript,
            depth: 1,
            visitedFiles,
            currentScriptPath: comparableCandidatePath
        })) {
            return false;
        }
    }
    return true;
};
export const resolveRepoOwnedNativeHostCommand = () => `${quoteShellToken(process.execPath)} ${quoteShellToken(resolveRepoOwnedNativeHostEntryPath())}`;
export const resolveProfileRoot = (cwd) => resolve(cwd, ".webenvoy", "profiles");
export const resolveProfileScopedNativeBridgeSocketPath = (profileDir) => join(profileDir, PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME);
export const isBrowserChannel = (value) => BROWSER_CHANNELS.includes(value);
export const isValidExtensionId = (value) => EXTENSION_ID_PATTERN.test(value);
export const isValidNativeHostName = (value) => NATIVE_HOST_NAME_PATTERN.test(value);
const resolveDefaultManifestDirectory = (browserChannel) => {
    if (process.platform === "darwin") {
        const baseByChannel = {
            chrome: join(homedir(), "Library", "Application Support", "Google", "Chrome"),
            chrome_beta: join(homedir(), "Library", "Application Support", "Google", "Chrome Beta"),
            chromium: join(homedir(), "Library", "Application Support", "Chromium"),
            brave: join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
            edge: join(homedir(), "Library", "Application Support", "Microsoft Edge")
        };
        return join(baseByChannel[browserChannel], "NativeMessagingHosts");
    }
    if (process.platform === "linux") {
        const baseByChannel = {
            chrome: join(homedir(), ".config", "google-chrome"),
            chrome_beta: join(homedir(), ".config", "google-chrome-beta"),
            chromium: join(homedir(), ".config", "chromium"),
            brave: join(homedir(), ".config", "BraveSoftware", "Brave-Browser"),
            edge: join(homedir(), ".config", "microsoft-edge")
        };
        return join(baseByChannel[browserChannel], "NativeMessagingHosts");
    }
    throw new CliError("ERR_RUNTIME_UNAVAILABLE", "runtime.install 当前仅支持 darwin/linux", {
        retryable: false
    });
};
const resolveManifestDirectoryOverride = () => {
    const override = process.env.WEBENVOY_NATIVE_HOST_MANIFEST_DIR;
    if (typeof override !== "string" || override.trim().length === 0) {
        return null;
    }
    return resolve(override.trim());
};
export const resolveManifestDiscoveryDirectory = (browserChannel) => resolveManifestDirectoryOverride() ?? resolveDefaultManifestDirectory(browserChannel);
const readNativeHostRegistrationManifest = async (manifestPath) => {
    try {
        const raw = await readFile(manifestPath, "utf8");
        const parsed = JSON.parse(raw);
        const launcherPath = typeof parsed.path === "string" && parsed.path.trim().length > 0
            ? (isAbsolute(parsed.path) ? parsed.path : resolve(dirname(manifestPath), parsed.path))
            : null;
        return {
            name: typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name.trim() : null,
            launcherPath,
            allowedOrigins: Array.isArray(parsed.allowed_origins)
                ? parsed.allowed_origins.filter((entry) => typeof entry === "string")
                : []
        };
    }
    catch {
        return null;
    }
};
const buildLauncherScript = (input) => {
    const argv = tokenizeHostCommand(input.command, input.hostCommand)
        .map((token) => quoteShellArgForScript(token))
        .join(" ");
    const profileRootExport = typeof input.profileRoot === "string" && input.profileRoot.length > 0
        ? `export WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT=${quoteShellArgForScript(input.profileRoot)}\n`
        : "";
    const legacyProfileDirExport = typeof input.legacyProfileDir === "string" && input.legacyProfileDir.length > 0
        ? `export WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR=${quoteShellArgForScript(input.legacyProfileDir)}\n`
        : "";
    return `#!/usr/bin/env bash
set -euo pipefail
${profileRootExport}${legacyProfileDirExport}exec ${argv} "$@"
`;
};
const writeManagedInstallMetadata = async (input) => {
    const metadata = {
        profile_root: input.profileRoot,
        bundle_runtime_expected: input.bundleRuntimeExpected
    };
    await writeFile(join(input.channelRoot, MANAGED_INSTALL_METADATA_FILENAME), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
};
export const resolveControlledInstallRoots = (cwd, browserChannel) => {
    return resolveNativeHostInstallRoots(cwd, browserChannel);
};
export const resolveRepoOwnedManifestPath = (cwd, browserChannel, nativeHostName) => join(resolveControlledInstallRoots(cwd, browserChannel).manifestRoot, `${nativeHostName}.json`);
export const resolveRepoOwnedLauncherPath = (cwd, browserChannel, nativeHostName) => join(resolveControlledInstallRoots(cwd, browserChannel).launcherRoot, `${nativeHostName}-launcher`);
const resolveLegacyDefaultLauncherPath = (manifestDir, nativeHostName) => join(manifestDir, `${nativeHostName}-launcher`);
const normalizePathForBoundaryCheck = (input) => {
    const normalized = resolve(input);
    return normalized.startsWith("/private/var/") ? normalized.slice("/private".length) : normalized;
};
const isPathInside = (baseDir, targetPath) => {
    const normalizedBase = normalizePathForBoundaryCheck(baseDir);
    const normalizedTarget = normalizePathForBoundaryCheck(targetPath);
    const rel = relative(normalizedBase, normalizedTarget);
    return (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)));
};
const normalizePathForOutput = (input) => typeof input === "string" ? normalizePathForBoundaryCheck(input) : null;
const resolveInstallPaths = (input) => {
    const roots = resolveControlledInstallRoots(input.cwd, input.browserChannel);
    const manifestRoot = resolveManifestDiscoveryDirectory(input.browserChannel);
    const manifestDir = typeof input.manifestDir === "string" && input.manifestDir.length > 0
        ? asAbsolutePath(input.cwd, input.manifestDir)
        : manifestRoot;
    const hasCustomManifestDir = typeof input.manifestDir === "string" && input.manifestDir.length > 0;
    if (hasCustomManifestDir && !isPathInside(manifestRoot, manifestDir)) {
        throw nativeHostPathError(input.command, "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT", {
            field: "manifest_dir",
            allowed_root: manifestRoot,
            received_path: manifestDir
        });
    }
    const manifestPath = join(manifestDir, `${input.nativeHostName}.json`);
    const launcherPath = typeof input.launcherPath === "string" && input.launcherPath.length > 0
        ? asAbsolutePath(input.cwd, input.launcherPath)
        : resolveRepoOwnedLauncherPath(input.cwd, input.browserChannel, input.nativeHostName);
    const hasCustomLauncherPath = typeof input.launcherPath === "string" && input.launcherPath.length > 0;
    if (hasCustomLauncherPath && !isPathInside(roots.launcherRoot, launcherPath)) {
        throw nativeHostPathError(input.command, "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT", {
            field: "launcher_path",
            allowed_root: roots.launcherRoot,
            received_path: launcherPath
        });
    }
    return {
        installScope: roots.installScope,
        installKey: roots.installKey,
        channelRoot: roots.channelRoot,
        worktreePath: roots.worktreePath,
        manifestRoot,
        manifestDir,
        manifestPath,
        runtimeRoot: roots.runtimeRoot,
        launcherRoot: roots.launcherRoot,
        launcherPath,
        hasCustomManifestDir,
        hasCustomLauncherPath,
        manifestPathSource: hasCustomManifestDir ? "custom" : "browser_default",
        launcherPathSource: hasCustomLauncherPath ? "custom" : "repo_owned_default"
    };
};
const resolveProfileDirForLauncher = (input) => {
    if (typeof input.profileDir !== "string" || input.profileDir.trim().length === 0) {
        return undefined;
    }
    const normalizedProfileDir = asAbsolutePath(input.cwd, input.profileDir.trim());
    if (!isPathInside(input.profileRoot, normalizedProfileDir)) {
        throw nativeHostPathError("runtime.install", "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT", {
            field: "profile_dir",
            allowed_root: input.profileRoot,
            received_path: normalizedProfileDir
        });
    }
    return normalizedProfileDir;
};
export const installNativeHost = async (input) => {
    const resolvedPaths = resolveInstallPaths({
        command: "runtime.install",
        cwd: input.cwd,
        nativeHostName: input.nativeHostName,
        browserChannel: input.browserChannel,
        manifestDir: input.manifestDir,
        launcherPath: input.launcherPath
    });
    const profileRoot = resolveProfileRoot(resolvedPaths.worktreePath);
    const allowedOrigin = `chrome-extension://${input.extensionId}/`;
    const profileDir = resolveProfileDirForLauncher({
        cwd: resolvedPaths.worktreePath,
        profileRoot,
        profileDir: input.profileDir
    });
    await assertNoSymlinkAncestorBetween({
        command: "runtime.install",
        field: "manifest_dir",
        fromDir: resolvedPaths.manifestRoot,
        targetDir: resolvedPaths.manifestDir
    });
    await assertNoSymlinkAncestorBetween({
        command: "runtime.install",
        field: "launcher_path",
        fromDir: resolvedPaths.launcherRoot,
        targetDir: dirname(resolvedPaths.launcherPath)
    });
    if (profileDir) {
        await assertNoSymlinkAncestorBetween({
            command: "runtime.install",
            field: "profile_dir",
            fromDir: profileRoot,
            targetDir: profileDir
        });
    }
    await assertNotSymlink("runtime.install", "manifest_path", resolvedPaths.manifestPath);
    await assertNotSymlink("runtime.install", "launcher_path", resolvedPaths.launcherPath);
    const currentRegistration = await readNativeHostRegistrationManifest(resolvedPaths.manifestPath);
    const previousManagedInstall = currentRegistration?.launcherPath && currentRegistration.launcherPath !== resolvedPaths.launcherPath
        ? inspectManagedNativeHostInstall(currentRegistration.launcherPath)
        : null;
    const previousLegacyLauncherPath = currentRegistration?.launcherPath &&
        currentRegistration.launcherPath !== resolvedPaths.launcherPath &&
        currentRegistration.launcherPath === resolveLegacyDefaultLauncherPath(resolvedPaths.manifestDir, input.nativeHostName)
        ? currentRegistration.launcherPath
        : null;
    const manifestExisted = await pathExists(resolvedPaths.manifestPath);
    const launcherExisted = await pathExists(resolvedPaths.launcherPath);
    const bundleRuntimeExisted = await pathExists(join(resolvedPaths.runtimeRoot, "native-messaging", "native-host-entry.js"));
    await mkdir(resolvedPaths.manifestDir, { recursive: true });
    await mkdir(dirname(resolvedPaths.launcherPath), { recursive: true });
    const hostCommandSource = typeof input.hostCommand === "string" && input.hostCommand.trim().length > 0
        ? "explicit"
        : "repo_owned_default";
    const bundledEntryPath = hostCommandSource === "explicit" ? null : await ensureBundledNativeHostRuntime(resolvedPaths.channelRoot);
    const bundleRuntimeWritten = bundledEntryPath !== null;
    const hostCommand = hostCommandSource === "explicit"
        ? input.hostCommand.trim()
        : `${quoteShellToken(process.execPath)} ${quoteShellToken(bundledEntryPath)}`;
    const legacyProfileDir = hostCommandSource === "explicit"
        ? await shouldExportLegacyProfileDirForExplicitHost({
            command: "runtime.install",
            cwd: resolvedPaths.worktreePath,
            hostCommand,
            profileDir
        })
            ? profileDir
            : undefined
        : undefined;
    await writeFile(resolvedPaths.launcherPath, buildLauncherScript({
        command: "runtime.install",
        hostCommand,
        profileRoot,
        legacyProfileDir
    }), "utf8");
    await writeManagedInstallMetadata({
        channelRoot: resolvedPaths.channelRoot,
        profileRoot,
        bundleRuntimeExpected: bundleRuntimeWritten
    });
    await chmod(resolvedPaths.launcherPath, 0o755);
    const manifest = {
        name: input.nativeHostName,
        description: NATIVE_HOST_DESCRIPTION,
        path: resolvedPaths.launcherPath,
        type: "stdio",
        allowed_origins: [allowedOrigin]
    };
    await writeFile(resolvedPaths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (previousManagedInstall &&
        normalizePathForBoundaryCheck(previousManagedInstall.channelRoot) !==
            normalizePathForBoundaryCheck(resolvedPaths.channelRoot)) {
        await rm(previousManagedInstall.channelRoot, { recursive: true, force: true });
    }
    if (previousLegacyLauncherPath) {
        await rm(previousLegacyLauncherPath, { force: true });
    }
    return {
        operation: "install",
        native_host_name: input.nativeHostName,
        browser_channel: input.browserChannel,
        extension_id: input.extensionId,
        install_scope: resolvedPaths.installScope,
        install_key: resolvedPaths.installKey,
        install_root: normalizePathForOutput(resolvedPaths.channelRoot),
        manifest_dir: normalizePathForOutput(resolvedPaths.manifestDir),
        manifest_path: normalizePathForOutput(resolvedPaths.manifestPath),
        manifest_path_source: resolvedPaths.manifestPathSource,
        launcher_dir: normalizePathForOutput(dirname(resolvedPaths.launcherPath)),
        launcher_path: normalizePathForOutput(resolvedPaths.launcherPath),
        launcher_path_source: resolvedPaths.launcherPathSource,
        host_command: hostCommand,
        host_command_source: hostCommandSource,
        profile_root: normalizePathForOutput(profileRoot),
        profile_dir: normalizePathForOutput(profileDir),
        profile_scoped_bridge_socket_path: normalizePathForOutput(profileDir ? resolveProfileScopedNativeBridgeSocketPath(profileDir) : null),
        allowed_origins: [allowedOrigin],
        persistent_extension_identity: {
            extension_id: input.extensionId,
            native_host_name: input.nativeHostName,
            browser_channel: input.browserChannel,
            manifest_path: normalizePathForOutput(resolvedPaths.manifestPath)
        },
        existed_before: {
            manifest: manifestExisted,
            launcher: launcherExisted,
            bundle_runtime: bundleRuntimeExisted
        },
        write_result: {
            manifest: manifestExisted ? "overwritten" : "created",
            launcher: launcherExisted ? "overwritten" : "created",
            bundle_runtime: bundleRuntimeWritten ? (bundleRuntimeExisted ? "overwritten" : "created") : "unchanged"
        },
        created: {
            manifest: true,
            launcher: true,
            bundle_runtime: bundleRuntimeWritten
        }
    };
};
export const uninstallNativeHost = async (input) => {
    const resolvedPaths = resolveInstallPaths({
        command: "runtime.uninstall",
        cwd: input.cwd,
        nativeHostName: input.nativeHostName,
        browserChannel: input.browserChannel,
        manifestDir: input.manifestDir,
        launcherPath: input.launcherPath
    });
    await assertNoSymlinkAncestorBetween({
        command: "runtime.uninstall",
        field: "manifest_dir",
        fromDir: resolvedPaths.manifestRoot,
        targetDir: resolvedPaths.manifestDir
    });
    await assertNotSymlink("runtime.uninstall", "manifest_path", resolvedPaths.manifestPath);
    const currentRegistration = await readNativeHostRegistrationManifest(resolvedPaths.manifestPath);
    const legacyLauncherPath = resolvedPaths.hasCustomLauncherPath
        ? null
        : resolveLegacyDefaultLauncherPath(resolvedPaths.manifestDir, input.nativeHostName);
    const registeredLauncherPath = currentRegistration?.launcherPath ?? null;
    const registeredManagedInstall = registeredLauncherPath
        ? inspectManagedNativeHostInstall(registeredLauncherPath)
        : null;
    const shouldDeleteExplicitLauncher = resolvedPaths.hasCustomLauncherPath;
    const shouldDeleteRegisteredLegacyLauncher = !resolvedPaths.hasCustomLauncherPath &&
        registeredLauncherPath !== null &&
        legacyLauncherPath !== null &&
        registeredLauncherPath === legacyLauncherPath;
    const shouldDeleteRegisteredManagedLauncher = !resolvedPaths.hasCustomLauncherPath && registeredManagedInstall !== null;
    const launcherPath = shouldDeleteExplicitLauncher || !registeredLauncherPath ? resolvedPaths.launcherPath : registeredLauncherPath;
    const managedInstall = shouldDeleteRegisteredManagedLauncher ? registeredManagedInstall : null;
    const launcherPathSource = resolvedPaths.hasCustomLauncherPath
        ? "custom"
        : managedInstall
            ? "repo_owned_default"
            : "browser_default";
    if (shouldDeleteExplicitLauncher || managedInstall) {
        await assertNoSymlinkAncestorBetween({
            command: "runtime.uninstall",
            field: "launcher_path",
            fromDir: managedInstall?.launcherRoot ?? resolvedPaths.launcherRoot,
            targetDir: dirname(launcherPath)
        });
        await assertNotSymlink("runtime.uninstall", "launcher_path", launcherPath);
    }
    if (legacyLauncherPath && legacyLauncherPath !== launcherPath) {
        await assertNotSymlink("runtime.uninstall", "launcher_path", legacyLauncherPath);
    }
    const manifestExisted = await pathExists(resolvedPaths.manifestPath);
    const launcherExisted = shouldDeleteExplicitLauncher || shouldDeleteRegisteredLegacyLauncher || managedInstall
        ? await pathExists(launcherPath)
        : false;
    const bundleRuntimeExisted = managedInstall ? await pathExists(managedInstall.runtimeRoot) : false;
    const legacyLauncherExisted = legacyLauncherPath && legacyLauncherPath !== launcherPath
        ? await pathExists(legacyLauncherPath)
        : false;
    await rm(resolvedPaths.manifestPath, { force: true });
    if (managedInstall) {
        await rm(managedInstall.channelRoot, { recursive: true, force: true });
    }
    else if (shouldDeleteExplicitLauncher || shouldDeleteRegisteredLegacyLauncher) {
        await rm(launcherPath, { force: true });
    }
    if (legacyLauncherPath && legacyLauncherPath !== launcherPath) {
        await rm(legacyLauncherPath, { force: true });
    }
    return {
        operation: "uninstall",
        native_host_name: input.nativeHostName,
        browser_channel: input.browserChannel,
        install_scope: managedInstall?.installScope ?? resolvedPaths.installScope,
        install_key: managedInstall?.installKey ?? resolvedPaths.installKey,
        install_root: normalizePathForOutput(managedInstall?.channelRoot ?? resolvedPaths.channelRoot),
        manifest_dir: normalizePathForOutput(resolvedPaths.manifestDir),
        manifest_path: normalizePathForOutput(resolvedPaths.manifestPath),
        manifest_path_source: resolvedPaths.manifestPathSource,
        launcher_dir: normalizePathForOutput(dirname(launcherPath)),
        launcher_path: normalizePathForOutput(launcherPath),
        launcher_path_source: launcherPathSource,
        legacy_launcher_path: normalizePathForOutput(legacyLauncherPath && legacyLauncherPath !== launcherPath ? legacyLauncherPath : null),
        removed: {
            manifest: manifestExisted,
            launcher: launcherExisted,
            bundle_runtime: bundleRuntimeExisted,
            legacy_launcher: legacyLauncherExisted
        },
        remove_result: {
            manifest: manifestExisted ? "removed" : "already_absent",
            launcher: shouldDeleteExplicitLauncher || shouldDeleteRegisteredLegacyLauncher || managedInstall
                ? launcherExisted
                    ? "removed"
                    : "already_absent"
                : "preserved_non_managed",
            bundle_runtime: bundleRuntimeExisted ? "removed" : "already_absent",
            legacy_launcher: legacyLauncherExisted ? "removed" : "already_absent"
        },
        idempotent: !manifestExisted && !launcherExisted && !bundleRuntimeExisted && !legacyLauncherExisted
    };
};
