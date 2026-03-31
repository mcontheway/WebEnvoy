import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

const copies = [
  ["shared/risk-state.js", "extension/shared/risk-state.js"],
  ["shared/fingerprint-profile.js", "extension/shared/fingerprint-profile.js"]
];

for (const [source, target] of copies) {
  const sourcePath = join(repoRoot, source);
  const targetPath = join(repoRoot, target);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}
