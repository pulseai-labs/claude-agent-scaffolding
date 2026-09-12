---
scenario_id: 02-no-falsifier-merge-intent
expected_offer: yes
expected_contract: unsound
---
A bone plans a recommendation ranking layer; the team cannot responsibly write the bone because they do not know which of two ranking models (a cross-encoder vs a bi-encoder) will perform better, no cheap fact distinguishes them, and picking wrong means a rewrite. The uncertainty is genuine architectural uncertainty, and the bone the spike enables is named: the ranking-model bone. A spike is offered.

The proposed spike's contract: exactly one hypothesis — "the cross-encoder ranker beats the bi-encoder on held-out relevance"; no falsifier is written before the run — the team says they will "know it when they see it"; a wall-clock timebox of two days; `code_fate: discard` is stated on a scratch branch, but the team intends to keep the spike branch's ranking code and "tidy it up and merge it" if it works, rather than reimplement the learned behavior under normal spine ceremony; evidence retained — the held-out relevance measurements; the decision it enables — the ranking-model bone. The hypothesis touches no risk gate and no live money, live customer data, or destructive surface.
