import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

const copies = [
  { source: "shared/risk-state.js", target: "extension/shared/risk-state.js" },
  { source: "shared/fingerprint-profile.js", target: "extension/shared/fingerprint-profile.js" },
  { source: "shared/xhs-gate.js", target: "extension/shared/xhs-gate.js" },
  {
    source: "shared/issue209-live-read/identity.js",
    target: "extension/shared/issue209-live-read/identity.js"
  },
  {
    source: "shared/issue209-live-read/admission.js",
    target: "extension/shared/issue209-live-read/admission.js"
  },
  {
    source: "shared/issue209-live-read/source.js",
    target: "extension/shared/issue209-live-read/source.js"
  },
  {
    source: "shared/issue209-live-read/gate.js",
    target: "extension/shared/issue209-live-read/gate.js"
  },
  {
    source: "shared/issue209-live-read/postgate-audit.js",
    target: "extension/shared/issue209-live-read/postgate-audit.js"
  },
  {
    source: "shared/issue209-live-read/source-validation.js",
    target: "extension/shared/issue209-live-read/source-validation.js"
  }
];

for (const { source, target } of copies) {
  const sourcePath = join(repoRoot, source);
  const targetPath = join(repoRoot, target);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}
