import { spawn } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface SupervisorArgs {
  browserPath: string;
  launchArgs: string[];
  stateFilePath: string;
  controlFilePath: string;
  launchToken: string;
  profileDir: string;
  runId: string;
}

interface BrowserInstanceState {
  schemaVersion: 1;
  launchToken: string;
  profileDir: string;
  runId: string;
  browserPath: string;
  controllerPid: number;
  browserPid: number;
  launchedAt: string;
  headless: boolean;
  executionSurface: "headless_browser" | "real_browser";
}

interface ShutdownCommand {
  action: "shutdown";
  launchToken: string;
}

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const deleteFileQuietly = async (path: string): Promise<void> => {
  try {
    await unlink(path);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }
};

const parseSupervisorArgs = (argv: string[]): SupervisorArgs => {
  const read = (name: string): string => {
    const index = argv.indexOf(name);
    if (index < 0 || index + 1 >= argv.length) {
      throw new Error(`missing argument: ${name}`);
    }
    const value = argv[index + 1];
    if (value.trim().length === 0) {
      throw new Error(`empty argument: ${name}`);
    }
    return value;
  };

  const launchArgs = JSON.parse(Buffer.from(read("--launch-args-b64"), "base64").toString("utf8")) as unknown;
  if (!Array.isArray(launchArgs) || !launchArgs.every((item) => typeof item === "string")) {
    throw new Error("invalid --launch-args-b64 payload");
  }

  return {
    browserPath: read("--browser-path"),
    launchArgs,
    stateFilePath: read("--state-file"),
    controlFilePath: read("--control-file"),
    launchToken: read("--launch-token"),
    profileDir: read("--profile-dir"),
    runId: read("--run-id")
  };
};

const readShutdownCommand = async (path: string): Promise<ShutdownCommand | null> => {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<ShutdownCommand>;
    if (parsed.action !== "shutdown" || typeof parsed.launchToken !== "string") {
      return null;
    }
    return {
      action: "shutdown",
      launchToken: parsed.launchToken
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return null;
    }
    return null;
  }
};

const run = async (): Promise<void> => {
  const args = parseSupervisorArgs(process.argv.slice(2));
  await mkdir(dirname(args.stateFilePath), { recursive: true });
  await mkdir(dirname(args.controlFilePath), { recursive: true });
  await deleteFileQuietly(args.stateFilePath);
  await deleteFileQuietly(args.controlFilePath);

  const browser = spawn(args.browserPath, args.launchArgs, {
    detached: false,
    stdio: "ignore"
  });
  browser.unref();

  const rawBrowserPid = browser.pid;
  if (typeof rawBrowserPid !== "number" || !Number.isInteger(rawBrowserPid) || rawBrowserPid <= 0) {
    throw new Error("failed to spawn browser child");
  }
  const browserPid = rawBrowserPid;

  const state: BrowserInstanceState = {
    schemaVersion: 1,
    launchToken: args.launchToken,
    profileDir: args.profileDir,
    runId: args.runId,
    browserPath: args.browserPath,
    controllerPid: process.pid,
    browserPid,
    launchedAt: new Date().toISOString(),
    headless: args.launchArgs.includes("--headless=new"),
    executionSurface: args.launchArgs.includes("--headless=new")
      ? "headless_browser"
      : "real_browser"
  };
  await writeFile(args.stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  let shuttingDown = false;
  const finalize = async (): Promise<void> => {
    await deleteFileQuietly(args.stateFilePath);
    await deleteFileQuietly(args.controlFilePath);
  };

  const terminateBrowser = async (): Promise<void> => {
    if (!isProcessAlive(browserPid)) {
      return;
    }
    try {
      process.kill(browserPid, "SIGTERM");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ESRCH") {
        throw error;
      }
      return;
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!isProcessAlive(browserPid)) {
        return;
      }
      await sleep(100);
    }
    if (!isProcessAlive(browserPid)) {
      return;
    }
    try {
      process.kill(browserPid, "SIGKILL");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ESRCH") {
        throw error;
      }
    }
  };

  const shutdown = async (exitCode: number): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      await terminateBrowser();
      await finalize();
      process.exit(exitCode);
    } catch {
      process.exit(1);
    }
  };

  browser.once("error", async () => {
    await shutdown(1);
  });

  browser.once("exit", async () => {
    await shutdown(0);
  });

  process.on("SIGTERM", () => {
    void shutdown(0);
  });
  process.on("SIGINT", () => {
    void shutdown(0);
  });

  while (!shuttingDown) {
    const command = await readShutdownCommand(args.controlFilePath);
    if (command && command.launchToken === args.launchToken) {
      await shutdown(0);
      return;
    }
    await sleep(100);
  }
};

void run().catch(async () => {
  process.exit(1);
});
