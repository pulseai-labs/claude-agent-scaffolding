---
scenario_id: 03-release-grooming-reads-queue
expected_outcome: groom-queue-into-map
expected_reason: At plan-release grooming, the open from: requests are read by label-prefix filter and each gets a disposition. #90 serves r4's goal and is pulled onto the feature map with source intake (feature_add ... intake) and ranked with the rest. #88 is a small request pulse-guard-ai cannot fake, so it is routed to /ossify:patch rather than waiting for r4. #91 is deferred with a reason, since it does not serve r4's promise and the requester has a workaround. The exit criterion for the consumer reads "pulse-guard-ai can adopt <capability set>", with the set left open until r4's last spine is planned. Dispositions go in RELEASE.md and as a comment on each issue.
---
PulseHive (`pulseai-labs/PulseHive`, `gh` authenticated). Release r3 closed; the
operator is planning r4, whose goal is "large-result queries work for
pulse-guard-ai". The feature map holds five entries: "cursor-based pagination",
"query timeouts", "metrics export", "admin CLI", "TLS client certs".

Open issues whose labels start `from:`:
- #88 `from:pulse-guard-ai` — "don't retry HTTP 409; the retry is inside
  `Client::send`, so we cannot stop it from a wrapper" (one function, `RetryPolicy::should_retry`)
- #90 `from:pulse-guard-ai` — "stream query results instead of buffering the whole result set"
- #91 `from:pulsedb` — "expose connection-pool stats; we poll `/health` for now and it's enough"

There are no other open `from:` issues.

The operator says: "/ossify:plan-release — plan r4."
