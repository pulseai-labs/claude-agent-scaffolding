// One stderr line per event; the service's journal keeps it.
export const log = (line: string): void => {
  process.stderr.write(`bot-on-openbot: ${line.split("\n")[0]}\n`);
};
