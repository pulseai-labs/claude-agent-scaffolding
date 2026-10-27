CREATE TABLE orchestration_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    command_id TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
  );
CREATE INDEX orchestration_events_aggregate
    ON orchestration_events(aggregate_type, aggregate_id, sequence);
CREATE INDEX orchestration_events_command
    ON orchestration_events(command_id);
CREATE INDEX orchestration_events_thread_type
    ON orchestration_events(aggregate_id, event_type, sequence) WHERE aggregate_type = 'thread';
