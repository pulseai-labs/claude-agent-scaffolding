// The sh scripts autonomic appends and touches with. The host has no append, so appends
// go through sh. The helpers that run them live in register.tsx: the validator follows $
// only into functions declared in the hooks module itself.

export const APPEND = 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"'
export const TOUCH = 'mkdir -p "$(dirname "$1")" && touch "$1"'
