CREATE TABLE writer_leases (
  session_id TEXT PRIMARY KEY,
  token      TEXT NOT NULL,
  pid        INTEGER NOT NULL
) STRICT;
