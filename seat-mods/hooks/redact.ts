// seat-mods' copy of autonomic's redactor. The waiting-on-operator notice is shown in a
// notification and carried to a bell command, so a credential-shaped string in field 5 must
// not leave the session. Copied byte for byte; tests/test-mod-shell-parity.sh holds SECRETS
// and redact identical to autonomic/hooks/ledger.ts.

// A credential never reaches the committed ledger, a notice or a pain file (PR #681):
// URL user info, NAME_TOKEN=… style assignments, --token/--password values, an
// Authorization or Bearer value — bare or quoted — and known token shapes anywhere.
const VALUE = `(?:"[^"]*"|'[^']*'|[^\\s"']+)`
const HEADER = '[A-Za-z0-9-]*(?:authorization|key|token|secret|cookie|password|session)[A-Za-z0-9-]*'
const SECRETS: ReadonlyArray<[RegExp, string]> = [
  // A quoted header loses everything up to its closing quote: spaces and ; included (round 7).
  [new RegExp(`(["'])(${HEADER}:\\s*)[^"'\\n]*`, 'gi'), '$1$2***'],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@'],
  [new RegExp(`\\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|AUTH)[A-Za-z0-9_]*)=${VALUE}`, 'gi'), '$1=***'],
  [new RegExp(`(--?(?:token|password|passwd|secret|api-?key|auth))(=|\\s+)${VALUE}`, 'gi'), '$1$2***'],
  [/\b(Authorization:\s*)(?:\w+\s+)?[^\s"']+/gi, '$1***'],
  [/\b(Bearer)\s+[^\s"']+/gi, '$1 ***'],
  [/\b([A-Za-z0-9-]*(?:key|token|secret|cookie|password|session)[A-Za-z0-9-]*:\s*)[^\s"']+/gi, '$1***'],
  [/\b(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-|glpat-)[A-Za-z0-9_-]+|\bAKIA[A-Z0-9]{16}\b/g, '***'],
]
export const redact = (s: string): string => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)
