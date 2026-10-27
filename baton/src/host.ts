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

export type PendingOption = { label: string; description?: string };
export type PendingQuestion = { id: string; header: string; question: string; options: PendingOption[]; multiSelect?: boolean };
/** A user-input request a thread has raised and is blocked on. */
export type PendingRequest = { id: string; questions: PendingQuestion[] };

export type ThreadStatus = {
  /**
   * `interrupted`: the turn was stopped from outside (often an operator about to steer). The
   * engine treats it like `completed`: outcomes, then the quiet window, never an immediate drop.
   */
  state: "active" | "completed" | "interrupted" | "failed" | "waiting" | "gone";
  /** Opaque mark that changes whenever the thread does. */
  activity: string;
  /** Set only when the host saw a pending request and could read it; `state` is unaffected. */
  pending?: PendingRequest;
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

/** The host cannot deliver these answers to this request (a shape it cannot answer). */
export class AnswerRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerRefused";
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
  /**
   * End the thread's terminal. A thread that is already gone is not an error. A host that
   * defines it has its terminals closed by the engine at a session end (design §4.7).
   */
  close?(threadId: string): Promise<void>;
  /** The thread's rendered screen as plain text; `""` when the thread is gone. */
  screen?(threadId: string): Promise<string>;
  /** Answer the thread's pending request `requestId`: `answers` maps question id to the chosen label. */
  respond?(threadId: string, requestId: string, answers: Record<string, string>): Promise<void>;
}
