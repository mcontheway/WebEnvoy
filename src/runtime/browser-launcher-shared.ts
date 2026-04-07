export type BrowserLaunchErrorCode =
  | "BROWSER_NOT_FOUND"
  | "BROWSER_LAUNCH_FAILED"
  | "BROWSER_INVALID_ARGUMENT";

export class BrowserLaunchError extends Error {
  readonly code: BrowserLaunchErrorCode;

  constructor(code: BrowserLaunchErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BrowserLaunchError";
    this.code = code;
  }
}
