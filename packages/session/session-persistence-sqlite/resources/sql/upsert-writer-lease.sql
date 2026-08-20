INSERT INTO writer_leases (session_id, token, pid)
VALUES (?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
  token = excluded.token,
  pid = excluded.pid;
