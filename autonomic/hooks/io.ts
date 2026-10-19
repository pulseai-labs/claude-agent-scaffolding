// The sh scripts autonomic appends and touches with. The host has no append, so appends
// go through sh. The helpers that run them live in register.tsx: the validator follows $
// only into functions declared in the hooks module itself.

export const APPEND = 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"'
export const TOUCH = 'mkdir -p "$(dirname "$1")" && touch "$1"'
// The park store's write (0.10.0 Task 5; skill-first Q2: a path this plugin wrote). One run under
// umask 077 creates the directory 0700 and the file 0600 before any content lands, writes the park
// from stdin (never argv: the file holds the exact call), and re-asserts both modes. A file that
// already exists is narrowed before it is rewritten.
export const PARK_WRITE = 'umask 077 && mkdir -p "$(dirname "$1")" && chmod 700 "$(dirname "$1")" && { chmod 600 "$1" 2>/dev/null || true; } && cat > "$1" && chmod 600 "$1"'
// The one-use claim on a park's release (0.10.0 fix B2): noclobber makes ">" create-or-fail, so
// exactly one overlapping release wins an approval. The marker sits beside the park file.
export const CLAIM = 'umask 077; set -C; : > "$1"'
