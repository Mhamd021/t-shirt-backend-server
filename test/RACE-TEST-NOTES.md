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

## `resendStuck()` concurrency mutation prediction (written before running)

- Setup: create a `SENT` order with a null `printerNotifiedAt`, then use raw SQL
  to set `updatedAt` ten minutes in the past. Prisma's `@updatedAt` behavior
  makes supplying an old timestamp via Prisma Client unsafe for this setup.
- Concurrent calls: invoke both `resendStuck(id)` promises before awaiting
  either, and await them together with `Promise.allSettled`.
- Mutation: remove the `"updatedAt" <= ...` predicate from the conditional
  claim `UPDATE`.
- Prediction: both updates can succeed because both calls still see a `SENT`
  order with `printerNotifiedAt IS NULL`; the first claim does not set
  `printerNotifiedAt` before commit. I expect two fulfilled calls, zero
  rejections (therefore no 409), and two mail calls. The fulfilled/rejected
  counts and exact mail-call count should all fail their one-winner expectations.
- Strongest duplicate-notification evidence: the exact mail-call count. It
  directly checks the externally visible side effect; the outcome counts also
  assert the service's conflict contract.
- Mutation result: confirmed. With the age predicate removed, the test observed
  two fulfilled calls, zero rejected calls, and two mailer calls. The aggregate
  assertion reported all mismatches together.
- Follow-up reliability run: added a 200 ms delay to the mock mailer and ran
  20 fresh stuck-order races under the same mutation. All 20 iterations went
  red; every iteration had two fulfilled calls, zero rejections, and two mail
  calls. The one-minute-too-recent test also went red deterministically because
  the call resolved instead of rejecting.
- The production age predicate was restored, and the focused tests passed
  against the dedicated test database.
- A second test seeds the same `SENT`/unnotified state with `updatedAt` set by
  raw SQL to one minute ago; it rejects with HTTP 409 and sends no email.

## Printer notification delivery and idempotency key

- The Resend SDK v6.12.2 declarations type a returned error as an object with
  `message`, nullable `statusCode`, and `name` (a Resend error-code string;
  for example, `validation_error`), not as a JavaScript `Error` instance.
- Added notifier tests using that returned response shape. A returned
  `validation_error` becomes `Resend failed: Invalid recipient`; the notifier
  does not call `updateMany`, and the simulated `printerNotifiedAt` stays null.
- A success test checks the SDK receives
  `{ idempotencyKey: 'printer-order/42' }`.

- Mutation check: moved the notified timestamp update before the mail send.
  The failure test went red because `printerNotifiedAt` was set. The production
  order (send first, mark notified only after success) was restored.

## Order creation idempotency
- Mutation prediction, recorded before running the experiment: dropping the
  unique index on `(userId, idempotencyKey)` should let both concurrent
  same-user creates insert an order after serializing on the design lock.
  Both calls should fulfill with different IDs and the database should contain
  two orders, so the one-order/same-ID assertions should fail. Different-key,
  different-user, payload-mismatch, and invalid-header cases should not depend
  on this index mutation.
- Mutation check: dropped `Order_userId_idempotencyKey_key` only on the
  verified `shirtfull_test` database and ran the concurrent same-key test.
  It went red with distinct IDs (`1` and `2`) and two matching database rows.
  Truncated the test data, recreated the unique index, and verified its
  definition before finishing.
- Same-key requests now compare design, size, customer name/email, every
  address field, and notes before returning the original order; changing any
  of these fields is treated as a different order and returns HTTP 422.
- The HTTP request path is verified with Supertest: POST `/orders` with
  `Idempotency-Key` returns 201, and without it returns 400. Authentication
  guards are replaced in this focused test; the real controller, header
  extraction, validation, and database-backed service are exercised.
- This test uses the real order service and a single request each; the header
  contract is checked over HTTP, not as an authenticated end-to-end flow.

## UTC timestamps under a non-UTC session

- Mutation prediction, recorded before running the experiment: changing
  `tick()`'s `"updatedAt"` assignment from `now() AT TIME ZONE 'UTC'` to bare
  `now()` should make the claimed-order timestamp assertion fail by roughly
  the Los Angeles UTC offset (about 7-8 hours), exceeding its 5-second bound.
- Mutation result: confirmed. The test failed with a timestamp difference of
  28,800,142 ms. The mail mock rejects in this test so Prisma's later
  `@updatedAt` write cannot hide the raw claim timestamp.
- Mutation prediction, recorded before running the experiment: making the
  same bare-`now()` change in `resendStuck()` should likewise make its
  post-resend timestamp assertion fail by roughly 7-8 hours.
- Mutation result: confirmed. The test failed with a timestamp difference of
  28,800,064 ms. The mail mock rejects so the test observes the raw
  `resendStuck()` timestamp update before a successful notification's Prisma
  `@updatedAt` write.

## Printer visibility and notification error handling

- Added database-backed printer visibility cases: `PENDING` and unnotified
  `CANCELLED` orders return 404; `SENT` and notified `CANCELLED` orders are
  readable.
- Resend responses for concurrent idempotent requests and payload mismatch
  both map to HTTP 409. Other Resend API errors map to HTTP 502. Notifier tests
  check all three leave `printerNotifiedAt` null and do not call the update.
- The stable `printer-order/<id>` key is checked in the failure path, which
  also asserts the notification timestamp remains null.
- SDK network behavior was checked with a rejected `fetch`: Resend resolves
  with `{ data: null, error: { name: 'application_error', statusCode: null,
  message: 'Unable to fetch data. The request could not be resolved.' },
  headers: null }`. MailService handles this returned error as HTTP 502; the
  notification remains unmarked.
- The design-removal unit test already covers an order in `CANCELLED` status:
  removal rejects with `ConflictException` status 409, retains the design and
  decal, and does not call Cloudinary.
- Mutation prediction, recorded before running: swallowing a generic Resend
  error in MailService should make the notifier's other-error case go red
  because it will mark the order notified after the send method resolves.
- Mutation result: confirmed. Temporarily skipped the generic `error` branch;
  the test went red because `notifyOrder()` resolved instead of rejecting.
  Restored error propagation.

