---
scenario_id: R9-class-with-many-sites
expected_outcome: count-search-capped-list
expected_reason: returning None for a missing config file breaks every caller that chains `.get` on `load_config()` directly — one class, condition 1 (a missing config file is documented valid input and now raises AttributeError, on the path this PR changes; condition 2 also met is acceptable), direction "refuses valid input"; the report states the search (`rg -n 'load_config\('` or an equivalent structural search) and its hit count (40), excludes the definition, the checked call at app/cli/main.py:22, the two tests and the five `(load_config() or {})` calls, and gives the class total of 31 sites — 3 in scope (app/cli/main.py:31, :48, :77) and 28 outside scope; the site list is either complete or capped with the total and the number not shown stated, every listed site marked in or outside scope; a report that silently lists a subset as if complete, counts 40 or 36 sites, folds the 28 outside-scope sites away unmentioned, or makes one class per file fails class_complete
---
Review PR `acme/orbit#455` ("config: tell 'no config file' from 'empty config'"). Invoked as
`/merge-bar:review-pr 455`. Round 1. Everything the review can read is below. A search of the
checkout finds only what is shown.

`gh pr view 455 --json body,headRefOid,baseRefName,files`: `headRefOid`
`5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c`, `baseRefName` `main`, files `app/config.py`,
`app/cli/main.py`, `tests/test_config.py`. `git rev-parse HEAD` prints the same SHA. Single
repo; root `CODING_STANDARDS.md`:

```markdown
- A function's return type is its contract: widening it (adding None) updates every caller
  in the same PR.
```

The PR body (spec: issue #450; no verifier report):

```markdown
## Claim
`load_config()` returns None when no config file exists, so `orbit` can print "no config
found, using defaults" instead of silently using them. Behaviour with a config file present
is unchanged.

## Scope
Touches: `app/config.py`, `app/cli/main.py`, `tests/test_config.py`. Deliberately does not
touch: `app/jobs/`, `app/web/`, `app/plugins/`, `app/mail/`.

## Known limits
- An empty config file still returns `{}` — "empty" and "missing" are the two cases the issue
  asks to tell apart.

## Merge danger
Door: two-way — no data format changes; a revert restores `{}` for a missing file.
Blast radius: every `orbit` entry point reads the config at startup.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`pytest tests/test_config.py` — 6 passed.

## Closes
Closes #450
```

The README, unchanged by this PR: "orbit runs without a config file; every setting has a
default."

The diff:

`app/config.py`:

```python
14  def load_config(path: str | None = None) -> dict | None:
15      p = Path(path or DEFAULT_PATH)
16-     if not p.exists():
17-         return {}
16+     if not p.exists():
17+         return None
18      return tomllib.loads(p.read_text())
```

(The signature changed from `-> dict` to `-> dict | None`.)

`app/cli/main.py`:

```python
22+     cfg = load_config()
23+     if cfg is None:
24+         print("no config found, using defaults", file=sys.stderr)
```

(Lines 31, 48 and 77 are unchanged context in the same file.)

`tests/test_config.py`: tests for a missing file (returns None), an empty file (returns
`{}`), and a populated file. No test runs any entry point without a config file.

`rg -n 'load_config\('` over the whole checkout prints 40 lines:

```text
app/cli/main.py:22:  cfg = load_config()
app/cli/main.py:31:  timeout = load_config().get("timeout", DEFAULTS["timeout"])
app/cli/main.py:48:  region = load_config().get("region", DEFAULTS["region"])
app/cli/main.py:77:  bucket = load_config().get("bucket", DEFAULTS["bucket"])
app/config.py:14:  def load_config(path: str | None = None) -> dict | None:
app/jobs/cleanup.py:10:  log_level = (load_config() or {}).get("log_level", DEFAULTS["log_level"])
app/jobs/cleanup.py:21:  smtp_host = (load_config() or {}).get("smtp_host", DEFAULTS["smtp_host"])
app/jobs/export.py:15:  batch_size = load_config().get("batch_size", DEFAULTS["batch_size"])
app/jobs/export.py:33:  queue = load_config().get("queue", DEFAULTS["queue"])
app/jobs/nightly.py:12:  retries = load_config().get("retries", DEFAULTS["retries"])
app/jobs/nightly.py:19:  log_level = load_config().get("log_level", DEFAULTS["log_level"])
app/jobs/nightly.py:40:  smtp_host = load_config().get("smtp_host", DEFAULTS["smtp_host"])
app/jobs/nightly.py:66:  workers = load_config().get("workers", DEFAULTS["workers"])
app/jobs/reindex.py:8:  cache_dir = load_config().get("cache_dir", DEFAULTS["cache_dir"])
app/jobs/reindex.py:27:  base_url = load_config().get("base_url", DEFAULTS["base_url"])
app/jobs/reindex.py:51:  api_key_env = load_config().get("api_key_env", DEFAULTS["api_key_env"])
app/mail/send.py:14:  region = load_config().get("region", DEFAULTS["region"])
app/mail/send.py:26:  bucket = load_config().get("bucket", DEFAULTS["bucket"])
app/mail/templates.py:33:  cache_dir = (load_config() or {}).get("cache_dir", DEFAULTS["cache_dir"])
app/plugins/base.py:16:  workers = (load_config() or {}).get("workers", DEFAULTS["workers"])
app/plugins/gcs.py:11:  batch_size = load_config().get("batch_size", DEFAULTS["batch_size"])
app/plugins/gcs.py:24:  queue = load_config().get("queue", DEFAULTS["queue"])
app/plugins/gcs.py:39:  sender = load_config().get("sender", DEFAULTS["sender"])
app/plugins/local.py:7:  tz = load_config().get("tz", DEFAULTS["tz"])
app/plugins/local.py:30:  timeout = load_config().get("timeout", DEFAULTS["timeout"])
app/plugins/s3.py:11:  cache_dir = load_config().get("cache_dir", DEFAULTS["cache_dir"])
app/plugins/s3.py:24:  base_url = load_config().get("base_url", DEFAULTS["base_url"])
app/plugins/s3.py:37:  api_key_env = load_config().get("api_key_env", DEFAULTS["api_key_env"])
app/web/auth.py:17:  log_level = load_config().get("log_level", DEFAULTS["log_level"])
app/web/auth.py:58:  smtp_host = load_config().get("smtp_host", DEFAULTS["smtp_host"])
app/web/health.py:9:  workers = load_config().get("workers", DEFAULTS["workers"])
app/web/routes.py:22:  sender = load_config().get("sender", DEFAULTS["sender"])
app/web/routes.py:45:  tz = load_config().get("tz", DEFAULTS["tz"])
app/web/routes.py:61:  timeout = load_config().get("timeout", DEFAULTS["timeout"])
app/web/routes.py:88:  region = load_config().get("region", DEFAULTS["region"])
app/web/routes.py:103:  bucket = load_config().get("bucket", DEFAULTS["bucket"])
app/web/routes.py:118:  retries = (load_config() or {}).get("retries", DEFAULTS["retries"])
app/web/routes.py:140:  retries = load_config().get("retries", DEFAULTS["retries"])
tests/test_config.py:9:  assert load_config(str(tmp_path / "missing.toml")) is None
tests/test_config.py:15:  assert load_config(str(cfg_file)) == {"region": "eu"}
```

Each of those modules runs at import or at its entry point, with no config file as often as
with one. No caller reads the config any other way than through `load_config()`.
