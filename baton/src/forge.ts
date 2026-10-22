// The forge seam: what the engine reads about a pull request and how it merges one.
// The `gh` implementation and the merge arm of the tick arrive with merge stages.

export type PrView = {
  state: "OPEN" | "MERGED" | "CLOSED";
  head: string;
  base: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  checks: "green" | "red" | "pending" | "none";
};

export interface Forge {
  view(url: string): Promise<PrView>;
  merge(url: string, headOid: string): Promise<void>;
}
