// The sh scripts autonomic appends and touches with. The host has no append, so appends
// go through sh. The helpers that run them live in register.tsx: the validator follows $
// only into functions declared in the hooks module itself.

export const APPEND = 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"'
export const TOUCH = 'mkdir -p "$(dirname "$1")" && touch "$1"'
// The park store's mode bits (0.10.0 Task 5; skill-first Q2: a path this plugin wrote). The
// host's write sets no mode, so the file is chmodded 0600 and its directory 0700 in one run.
export const CHMOD = 'mkdir -p "$(dirname "$1")" && chmod 700 "$(dirname "$1")" && chmod 600 "$1"'
