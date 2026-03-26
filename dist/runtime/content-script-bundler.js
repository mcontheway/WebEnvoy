import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
const CONTENT_SCRIPT_ENTRY_PATH = "build/content-script.js";
const sanitizeModuleId = (value) => value.replace(/\\/g, "/");
const sanitizeBinding = (value) => value.trim().replace(/\s+/g, " ");
const resolveDependencyPath = (fromFile, specifier) => {
    if (!specifier.startsWith(".")) {
        throw new Error(`unsupported bare import in staged content script: ${specifier}`);
    }
    return resolve(dirname(fromFile), specifier);
};
const parseNamedImports = (clause) => {
    const inner = clause.replace(/^\{/, "").replace(/\}$/, "");
    const parts = inner
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const mapped = parts.map((part) => {
        const aliasParts = part.split(/\s+as\s+/);
        if (aliasParts.length === 2) {
            return `${sanitizeBinding(aliasParts[0])}: ${sanitizeBinding(aliasParts[1])}`;
        }
        return sanitizeBinding(part);
    });
    return `{ ${mapped.join(", ")} }`;
};
const buildImportReplacement = (clause, dependencyId) => {
    const normalizedClause = clause.trim();
    if (normalizedClause.startsWith("{")) {
        const named = parseNamedImports(normalizedClause);
        return `const ${named} = __webenvoy_require(${JSON.stringify(dependencyId)});`;
    }
    if (normalizedClause.startsWith("* as ")) {
        const namespaceName = sanitizeBinding(normalizedClause.slice("* as ".length));
        return `const ${namespaceName} = __webenvoy_require(${JSON.stringify(dependencyId)});`;
    }
    if (normalizedClause.includes(",")) {
        const [defaultPart, restPart] = normalizedClause.split(",", 2);
        const defaultName = sanitizeBinding(defaultPart);
        const namedPart = restPart.trim();
        const named = parseNamedImports(namedPart);
        return [
            `const __webenvoy_dep_${defaultName} = __webenvoy_require(${JSON.stringify(dependencyId)});`,
            `const ${defaultName} = __webenvoy_dep_${defaultName}.default;`,
            `const ${named} = __webenvoy_dep_${defaultName};`
        ].join("\n");
    }
    const defaultName = sanitizeBinding(normalizedClause);
    return `const ${defaultName} = __webenvoy_require(${JSON.stringify(dependencyId)}).default;`;
};
const parseExportBlock = (body) => body
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
    const aliasParts = part.split(/\s+as\s+/);
    if (aliasParts.length === 2) {
        return {
            local: sanitizeBinding(aliasParts[0]),
            exported: sanitizeBinding(aliasParts[1])
        };
    }
    return {
        local: sanitizeBinding(part),
        exported: sanitizeBinding(part)
    };
});
const transformModuleCode = (input) => {
    const exportBindings = [];
    const dependencyIds = [];
    const addDependency = (dependencyId) => {
        if (!dependencyIds.includes(dependencyId)) {
            dependencyIds.push(dependencyId);
        }
    };
    let transformed = input.source;
    if (/\bexport\s+default\b/.test(transformed)) {
        throw new Error("unsupported export default in staged content script bundle");
    }
    transformed = transformed.replace(/^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?\s*$/gm, (_match, clause, specifier) => {
        const dependencyPath = resolveDependencyPath(input.sourceFilePath, specifier);
        const dependencyId = input.moduleIdOfPath(dependencyPath);
        addDependency(dependencyId);
        return buildImportReplacement(clause, dependencyId);
    });
    transformed = transformed.replace(/^\s*export\s*\{([\s\S]*?)\};?\s*$/gm, (_match, body) => {
        exportBindings.push(...parseExportBlock(body));
        return "";
    });
    transformed = transformed.replace(/\bexport\s+async\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g, (_match, name) => {
        exportBindings.push({ local: name, exported: name });
        return `async function ${name}`;
    });
    transformed = transformed.replace(/\bexport\s+(const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g, (_match, kind, name) => {
        exportBindings.push({ local: name, exported: name });
        return `${kind} ${name}`;
    });
    const exportStatements = exportBindings
        .map((binding) => `__webenvoy_exports[${JSON.stringify(binding.exported)}] = ${binding.local};`)
        .join("\n");
    const finalCode = exportStatements.length > 0 ? `${transformed}\n${exportStatements}\n` : `${transformed}\n`;
    return {
        moduleId: input.moduleIdOfPath(input.sourceFilePath),
        code: finalCode,
        dependencyIds
    };
};
const buildBundleSource = (modules, entryModuleId) => {
    const moduleFactories = modules
        .map((module) => `${JSON.stringify(module.moduleId)}: (__webenvoy_require, __webenvoy_exports) => {\n${module.code}\n}`)
        .join(",\n");
    return [
        "(() => {",
        '  "use strict";',
        "  const __webenvoy_modules = {",
        moduleFactories,
        "  };",
        "  const __webenvoy_cache = Object.create(null);",
        "  const __webenvoy_require = (moduleId) => {",
        "    if (__webenvoy_cache[moduleId]) {",
        "      return __webenvoy_cache[moduleId];",
        "    }",
        "    const factory = __webenvoy_modules[moduleId];",
        "    if (typeof factory !== \"function\") {",
        "      throw new Error(`missing bundled module: ${moduleId}`);",
        "    }",
        "    const exports = {};",
        "    __webenvoy_cache[moduleId] = exports;",
        "    factory(__webenvoy_require, exports);",
        "    return exports;",
        "  };",
        `  __webenvoy_require(${JSON.stringify(entryModuleId)});`,
        "})();",
        ""
    ].join("\n");
};
export const bundleStagedContentScript = async (input) => {
    const repoRootDir = dirname(input.extensionSourceDir);
    const entrySourcePath = join(input.extensionSourceDir, CONTENT_SCRIPT_ENTRY_PATH);
    const stagedEntryPath = join(input.stagedExtensionDir, CONTENT_SCRIPT_ENTRY_PATH);
    const transformedByModuleId = new Map();
    const visitingModuleIds = new Set();
    const moduleIdOfPath = (absolutePath) => sanitizeModuleId(relative(repoRootDir, absolutePath));
    const visitModule = async (moduleSourcePath) => {
        const moduleId = moduleIdOfPath(moduleSourcePath);
        if (transformedByModuleId.has(moduleId)) {
            return;
        }
        if (visitingModuleIds.has(moduleId)) {
            return;
        }
        visitingModuleIds.add(moduleId);
        const source = await readFile(moduleSourcePath, "utf8");
        const transformed = transformModuleCode({
            source,
            sourceFilePath: moduleSourcePath,
            moduleIdOfPath
        });
        transformedByModuleId.set(moduleId, transformed);
        for (const dependencyId of transformed.dependencyIds) {
            const dependencyPath = join(repoRootDir, dependencyId);
            await visitModule(dependencyPath);
        }
        visitingModuleIds.delete(moduleId);
    };
    await visitModule(entrySourcePath);
    const entryModuleId = moduleIdOfPath(entrySourcePath);
    const moduleList = [...transformedByModuleId.values()];
    const bundleSource = buildBundleSource(moduleList, entryModuleId);
    await writeFile(stagedEntryPath, bundleSource, "utf8");
};
