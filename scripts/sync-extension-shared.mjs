import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

const copies = [
  ["shared/risk-state.js", "extension/shared/risk-state.js"],
  ["shared/fingerprint-profile.js", "extension/shared/fingerprint-profile.js"],
  ["shared/xhs-gate.js", "extension/shared/xhs-gate.js"],
  ["shared/issue209-live-read/identity.js", "extension/shared/issue209-live-read/identity.js"],
  ["shared/issue209-live-read/admission.js", "extension/shared/issue209-live-read/admission.js"],
  ["shared/issue209-live-read/source.js", "extension/shared/issue209-live-read/source.js"],
  ["shared/issue209-live-read/gate.js", "extension/shared/issue209-live-read/gate.js"],
  [
    "shared/issue209-live-read/postgate-audit.js",
    "extension/shared/issue209-live-read/postgate-audit.js"
  ]
];

for (const [source, target] of copies) {
  const sourcePath = join(repoRoot, source);
  const targetPath = join(repoRoot, target);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}
