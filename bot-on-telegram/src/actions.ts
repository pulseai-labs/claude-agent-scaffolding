export type Runner = (argv: string[]) => Promise<{ rc: number; stdout: string; stderr: string }>;

const TIMEOUT_MS = 60_000;

// No shell: argv goes straight to exec. A binary that cannot start is a failed result, not a throw.
export const defaultRunner: Runner = async (argv) => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch {
    return { rc: 127, stdout: "", stderr: `${argv[0]}: could not start` };
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, TIMEOUT_MS);
  try {
    const [stdout, stderr, rc] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    if (timedOut) return { rc: rc === 0 ? 124 : rc, stdout, stderr: `${argv[0]}: timed out after 60 s\n${stderr}` };
    return { rc, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

export const unpark = (run: string, unit: string, runner: Runner = defaultRunner) =>
  runner(["baton", "unpark", run, unit]);

export const unparkTo = (run: string, unit: string, stage: string, runner: Runner = defaultRunner) =>
  runner(["baton", "unpark", run, unit, "--to", stage]);

export const disarm = (run: string, runner: Runner = defaultRunner) => runner(["baton", "disarm", run]);

export const merge = (prUrl: string, headSha: string, runner: Runner = defaultRunner) =>
  runner(["gh", "pr", "merge", prUrl, "--merge", "--match-head-commit", headSha]);

export const prView = (prUrl: string, runner: Runner = defaultRunner) =>
  runner(["gh", "pr", "view", prUrl, "--json", "number,baseRefName"]);
