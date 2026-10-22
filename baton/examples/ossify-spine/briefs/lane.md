# Lane

Run `skill://run-spine` as `<spine> --external-executor --detach`. Its caller-supplied procedure is this:

- For each request, write ossify's request record — its seven fields, unchanged, as one flat JSON object — plus `round` (1-based round number), `order` (1-based declared position) and `issued_at` (UTC ISO time), to the queue directory as `<work item>.json`: write a temp name without `.json` first, then `mv` it into place.
- Then write the lane done file (`lane.done`) and end. Never execute, launch or wait for an item.

If the read-out shows every round complete, write the rounds done file (`rounds.done`) instead, and do not run `/close`. A halt row, a refusal, or a spine with more than one target_repo is a stop.
