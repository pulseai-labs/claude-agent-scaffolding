#!/usr/bin/env bash
# lib/severity.sh — 5-tier severity rubric (SPEC §9.3).

# csa_severity_rank <tier> → integer 5..1, or 0 for unknown.
csa_severity_rank() {
  case "${1:-}" in
    critical) printf '5' ;;
    high)     printf '4' ;;
    medium)   printf '3' ;;
    low)      printf '2' ;;
    info)     printf '1' ;;
    *)        printf '0' ;;
  esac
}

# csa_severity_compare <a> <b> → -1, 0, or 1.
csa_severity_compare() {
  local ra; ra="$(csa_severity_rank "$1")"
  local rb; rb="$(csa_severity_rank "$2")"
  if [[ "$ra" -lt "$rb" ]]; then printf '%s' "-1"
  elif [[ "$ra" -gt "$rb" ]]; then printf '%s' "1"
  else printf '%s' "0"
  fi
}

# csa_severity_valid <tier> → exit 0 if recognized, 1 otherwise.
csa_severity_valid() {
  [[ "$(csa_severity_rank "$1")" -gt 0 ]]
}
