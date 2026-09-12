---
scenario_id: 03-bounded-defect-not-inflated
expected_register: no
expected_controls: none
---
A feature adds a list-view that re-renders in the wrong sort order on rapid clicks; the bug is annoying but bounded and locally reversible — a refresh restores the correct order, no data is moved or destroyed, no identity or ordering ledger is touched, and a test failure would fully capture it. The skeleton reaches this surface in Release 0. The team proposes registering a risk gate for it with a human confirm and an audit trail over the touch surface `src/ui/**`. No bone about the list-view design applies.
