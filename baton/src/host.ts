// The host interface: the one seam between the engine and whatever runs agent threads.
// The engine sees only these types; a host adapter maps them onto a real thread service.

export type LaunchRequest = {
  nonce: string;
  /** Must contain `[baton <nonce>]` so a lost launch can be found again by nonce. */
  title: string;
  project: string;
  instance: string;
  model: string;
  cwd: string;
  message: string;
};

export type ThreadStatus = {
  /**
   * `interrupted`: the turn was stopped from outside (often an operator about to steer). The
   * engine treats it like `completed`: outcomes, then the quiet window, never an immediate drop.
   */
  state: "active" | "completed" | "interrupted" | "failed" | "waiting" | "gone";
  /** Opaque mark that changes whenever the thread does. */
  activity: string;
};

/** The host refused the credentials. */
export class HostAuthError extends Error {
  constructor(message = "host authentication failed") {
    super(message);
    this.name = "HostAuthError";
  }
}

/** The host could not be reached. */
export class HostDownError extends Error {
  constructor(message = "host unreachable") {
    super(message);
    this.name = "HostDownError";
  }
}

/** A launch the host refused for a reason of its own (no such project, detached HEAD). */
export class LaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchError";
  }
}

// No host error other than HostAuthError and HostDownError reaches the engine as an
// exception; LaunchError is a refusal the host is sure of. A launch whose outcome the host
// cannot tell (the thread may exist) throws HostDownError, so the engine keeps the session
// and finds the thread again by nonce.
export interface Host {
  /** The directory the thread will start in. Stateless across ticks. */
  bind(project: string, cwd: string, nonce: string, mode: "worktree" | "root"): Promise<string>;
  /** Runs when a stage visit ends, after the claim is removed; a no-op when `dir` equals `cwd`. */
  release(project: string, cwd: string, dir: string): Promise<void>;
  launch(r: LaunchRequest): Promise<{ threadId: string }>;
  status(threadId: string): Promise<ThreadStatus>;
  interrupt(threadId: string, reason: string): Promise<void>;
  findByNonce(project: string, nonce: string): Promise<string[]>;
}
