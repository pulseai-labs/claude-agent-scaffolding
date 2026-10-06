import type { NeverRule } from './never'

// The never-approve rules the operator enabled (neverApprove), in the order found.
export const enforced = (found: readonly NeverRule[], enabled: readonly NeverRule[]): NeverRule[] => found.filter(r => enabled.includes(r))
