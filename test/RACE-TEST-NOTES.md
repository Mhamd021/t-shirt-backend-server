# Race test mutation notes

Mutation checks were run against the local `shirtfull_test` database. Each
production change below was temporary and was restored immediately after its
focused test run. After all restores, the full suite passed (66 integration
tests). Results are from local runs by the author.

## Summary table

| Production code mutated                          | Mutation                                                   | Test(s) that went red                    | Notes                                                            |
| ------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `OrderService.transition()`                      | removed `status: order.status` from the `updateMany` where | cancel-versus-poller test                | stale cancel overwrote the claimed order                         |
| `OrderService.transition()` (via `updateStatus`) | same removal                                               | all 30 confirm-race iterations           | both printer and admin calls succeeded                           |
| `OrderService.create()`                          | removed `FOR UPDATE`                                       | deterministic lock-held test only        | the 30 free-running iterations stayed green                      |
| `DesignService.update()`                         | commented out `FOR UPDATE`                                 | deterministic lock-held test only        | 65 passed, 1 failed; the 30 free-running iterations stayed green |
| `OrderNotifierService.tick()`                    | removed `SKIP LOCKED`                                      | locked-row test                          | both pollers stayed blocked                                      |
| `OrderNotifierService.tick()`                    | bare `now()` instead of UTC wall time                      | non-UTC timezone test                    | due order stayed `PENDING`                                       |
| `OrderNotifierService.tick()`                    | removed `status = 'PENDING'` from the claim                | cancelled-order test and two-poller test | see details below                                                |
| `OrderNotifierService.tick()`                    | claim split into plain `SELECT` then `UPDATE`, no lock     | two-poller test and locked-row test      | see details below                                                |
| `DesignService.remove()`                         | removed `FOR UPDATE`                                       | remove-versus-create lock test           | removal ended in Prisma FK error instead of expected 409         |

## Cancel versus poller

- Mutation: removed `status: order.status` from `OrderService.transition()`'s
  `updateMany` filter.
- Test: `rejects a stale cancellation when the poller claims the order after
the transition read`.
- Result: failed as expected. The stale cancellation resolved successfully and
  changed the poller-claimed order to `CANCELLED`, rather than rejecting with
  `Order changed, please retry`.

## Confirm race (printer and admin)

- Mutation: same removal of the status predicate in `transition()`.
- Test: `allows exactly one printer/admin to confirm a SENT order`.
- Result: 30 of 30 iterations failed. In every iteration both calls were
  fulfilled (expected one fulfilled, one rejected), and the order ended
  `CONFIRMED`.
- Reading: this test detects the missing guard reliably, because the bug shows
  up in the results of the two calls, not only in the final database state.

## Design update versus order creation

- Initial mutation: removed `FOR UPDATE` from the order-creation transaction.
- Result: the 30 free-running race iterations all passed. That result showed
  those iterations alone did not reliably detect the missing lock.
- Reason: the broken interleaving (update checks "no orders", create inserts,
  update writes) ends in the same final state as the harmless ordering where
  the update finishes first. The order stores only `designId`, no snapshot, so
  no assertion on final state can tell the two apart.
- Follow-up: added a deterministic contention test that pauses order creation
  after its design-lock query and checks whether the design update can finish
  while order creation is paused.
- First version of that test hooked the first `$queryRaw` of the update
  transaction. When the lock query was deleted from `DesignService.update()`,
  the hook never fired and the test hung until the 5 s timeout (and left an
  open transaction that failed the next test). Fixed by racing the update task
  itself against a 500 ms timer and releasing the paused create in a `finally`.
- Repeated mutation 1: removed `FOR UPDATE` from order creation again.
  Result: the deterministic test failed as expected.
- Mutation 2: commented out the `FOR UPDATE` query in `DesignService.update()`.
  Result: 65 passed, 1 failed. The 500 ms "update did not finish" assertion
  still passed (the update blocks on its own write while create holds the row),
  and the failure came from the later assertion that the update result is
  `rejected` (received `fulfilled`). The 30 free-running iterations passed.
- Status of the 30-iteration test: it passes with and without the lock, so it
  is a smoke test only. It does not protect against a lock regression.

The `FOR UPDATE` lock in order creation and in design update, and the status
predicate in `OrderService.transition()`, were restored before the final test
run.

## Concurrent pollers and timezone

- Mutation: removed `SKIP LOCKED` from the notifier claim query.
- Test: `does not wait on a row claimed by another transaction using SKIP
LOCKED`.
- Result: failed as expected because both poller ticks remained blocked while
  another transaction held the due order's row lock.
- Mutation: changed the due-time comparison from UTC wall time back to bare
  `now()`.
- Test: `claims only due orders while the database session timezone is
non-UTC`.
- Result: failed as expected; the due order remained `PENDING`.

`SKIP LOCKED` and the UTC-normalized due-time comparison were restored before
the final test run.

## Poller claim: status predicate removed

- Mutation: in the inner `SELECT` of `tick()`, removed `status = 'PENDING'` so
  the claim only filtered on `sendAt`.
- First attempt discarded: the edit produced invalid SQL (`syntax error at or
near "<="`), so every poller test failed for the wrong reason. Redone with
  only the one condition removed.
- Result:
  - `does not email a customer-cancelled order when the poller runs afterward`
    failed: the mailer was called once and the order ended `SENT`.
  - `sends only one email when two pollers claim the same due order
concurrently` failed: two emails instead of one.
- Reading: the status predicate in the claim protects two things, not one. It
  stops a cancelled order from being claimed, and it stops an already claimed
  order from being claimed again by the next poller.

## Poller claim: non-atomic claim

- Mutation: replaced the single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE
SKIP LOCKED)` with a plain `SELECT` of due ids followed by one `UPDATE` per
  id, no lock, no status condition in the update.
- Result:
  - `sends only one email when two pollers claim the same due order
concurrently` failed (2 emails instead of 1).
  - `does not wait on a row claimed by another transaction using SKIP LOCKED`
    failed (`completedBeforeUnlock` was false).
- Limit: the two-poller test loops over 30 orders inside one test, so a single
  failure does not report how many of the 30 orders were double-sent.

## Wrong-database cleanup refusal

- Created a disposable PostgreSQL database with a name other than
  `shirtfull_test` using the local Docker PostgreSQL service.
- The same database identity check used by integration-suite `beforeAll`
  refused the connection.
- The cleanup helper also refused the wrong database before issuing `TRUNCATE`.
- A sentinel row in the disposable database remained unchanged, and the
  disposable database was dropped after the probe.

## Design removal versus order creation

- Test: `waits for order creation before refusing removal of the newly ordered
design`.
- Interleaving: pause order creation after its design-row lock is acquired,
  start removal, verify removal remains pending, then release order creation.
- Expected result: order creation commits; removal resumes, sees that the
  design has an order, and rejects with HTTP 409 without deleting the design.
- Mutation: temporarily removed `FOR UPDATE` from `DesignService.remove()`.
- Result: the test failed as expected. Removal rejected with a Prisma foreign
  key error rather than the promised 409, demonstrating the missing
  serialization guard.
- The lock was restored and the focused integration test passed afterward.

## Create rejects foreign image IDs

- Added a unit test that passes a `publicId` from another user's folder to
  `DesignService.create()`.
- Result: the request is rejected before `design.create()` is called.

## Not yet verified

- `OrderService.findOne` printer visibility (`where: { id, AND: where }`):
  the code is changed, but there are no tests yet. Needed: printer reading a
  `PENDING` order gets 404; `SENT` succeeds; `CANCELLED` with
  `printerNotifiedAt` null gets 404; `CANCELLED` with it set succeeds.
- `"updatedAt" = now()` in the claim SQL: check the column type. If it is
  `timestamp without time zone`, it should use `now() AT TIME ZONE 'UTC'` like
  `sendAt`, and the timezone test should also assert `updatedAt`.
- `(status, sendAt)` index: present in the schema, migration still to be
  generated and reviewed.
- Manual stage A (poller off) and stage B (poller on) checks, including a
  wrong-Resend-key run.
- Deleting a design that has orders (409 instead of 500), double-click
  duplicate orders, admin double-resend.
