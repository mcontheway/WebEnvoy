import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK_DIR = join(tmpdir(), "webenvoy-browser-env-test-lock");
const ACQUIRE_TIMEOUT_MS = 120_000;
const RETRY_INTERVAL_MS = 50;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const acquireBrowserEnvTestLock = async (): Promise<void> => {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  while (true) {
    try {
      await mkdir(LOCK_DIR);
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error("timed out acquiring browser env test lock");
      }
      await sleep(RETRY_INTERVAL_MS);
    }
  }
};

export const releaseBrowserEnvTestLock = async (): Promise<void> => {
  await rm(LOCK_DIR, { recursive: true, force: true });
};
