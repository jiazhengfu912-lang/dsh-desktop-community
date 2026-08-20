# Agent Note: Cross-process single-writer session durability

Status: implemented

English | [中文](2026-08-19-session-single-writer-durability.zh.md)

## Problem

Session writes were serialized only inside one `PersistenceCoordinator`. A second Host could load and repair an open session while the original Host remained alive, then the superseded Host could append a late tool result from its stale cursor. JSONL used append mode without writer ownership or a revision compare-and-swap, and SQLite transactions did not distinguish one Host generation from another. The resulting duplicate sequence branch was correctly rejected later as a gap in the committed region, but the persistence layer had already accepted the conflicting writes.

## Decision

`PersistenceBackend` requires `acquireWriter` and `releaseWriter`, and every append or repair requires a `WriteExpectation` containing the lease, the revision observed by the coordinator, and the next logical sequence number. A successful mutation returns a `WriteCommit` with the new revision. `PersistenceCoordinator` acquires ownership lazily, advances its cursor and revision only after a successful commit, releases a session lease after retirement, and waits for all chains and lease releases before closing the backend.

The JSONL backend stores an opaque token in a `session.writer` sidecar. Lease takeover, append, repair, and token-matched release all use the same cross-process writer lock, so checking ownership and mutating the log cannot interleave with another Host's takeover. JSONL revisions use device, inode, and byte size instead of Windows timestamps, whose deferred finalization is unsuitable for a write-path compare-and-swap.

The SQLite backend stores ownership in `writer_leases`. Lease checks, revision checks, logical tail checks, event mutation, revision increment, and the returned revision occur within one `BEGIN IMMEDIATE` transaction. Schema version 18 adds the lease table; opening an exact version 17 schema migrates it to 18 in place inside the schema transaction, while any altered version 17 schema still fails ownership validation.

Strict sequence validation remains unchanged. Shared backend tests cover a second Host repairing an open session and a late tool result arriving after takeover. Backend tests cover JSONL locking and revision behavior, SQLite transactional takeover and schema migration, and teardown waiting for lease release before backend close.

## Alternatives considered

**Repair only an affected session log.** Rejected because the still-running superseded Host could append again; writer ownership must be enforced at each durable mutation.

**Rely on the desktop single-instance lock.** Rejected because an orphaned Host can outlive its GUI process, and web or test Hosts do not share the Electron lifecycle.

**Deduplicate events by sequence number while loading.** Rejected because two branches with the same sequence numbers are not equivalent, and silently selecting one would weaken corruption detection.

**Use timestamp revisions with a stabilization delay.** Rejected because this adds latency and does not make Windows timestamp publication an atomic compare-and-swap identity.

**Make the new backend methods optional.** Rejected because a backend without lease and revision enforcement would silently restore the original corruption path.

## Consequences

A live Host whose token is superseded now fails loudly with `SessionWriterSupersededError`; a write based on a changed durable revision fails with `SessionRevisionChangedError`. JSONL creates a writer sidecar and a short-lived lock sibling for each mutation. If a process terminates while holding that lock, the lock helper deliberately does not infer ownership from file age, so orphan lock removal remains an explicit operator action. SQLite databases move from schema 17 to 18 on first open and preserve existing session rows and events. Derived projections remain revision-keyed and rebuild after a committed repair.
