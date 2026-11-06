# Inventory reservation consumer

This independent Node.js application uses the installed `deedspan` package to expose a useful inventory workflow. A caller discovers available products, reserves a quantity, and retrieves the saved reservation. SQLite owns stock, reservations, sessions and audit records. No React or browser is required.

The implementation was developed as an agent-based consumer exercise using the public README and packed declarations. It is not evidence of adoption by an external human developer. It imports no SDK repository internals.

## Install and run

Use Node.js 24 or newer. From the repository root:

```sh
npm run example:install:inventory
npm run build --prefix examples/inventory
npm test --prefix examples/inventory
npm run demo --prefix examples/inventory
```

The installer builds and installs an actual SDK tarball. The manifest's `file:../..` dependency allows ordinary repository installation, but that alone may create a symlink. Use the installer when validating package consumption. Rerun it after SDK changes. The lockfile uses the repository dependency rather than a machine-specific archive path.

The demo uses a fresh temporary database, prints discovered JSON Schemas and real SDK execution traces, verifies the saved rows directly, and removes its database afterward. It demonstrates a successful reservation, replay, retrieval and insufficient stock. It is deterministic and performs no model inference.

## Run a real local model

With a tool-capable model already available in Ollama, run this in PowerShell:

```powershell
$env:MODEL_NAME = 'your-installed-model'
npm run model --prefix examples/inventory
```

`MODEL_BASE_URL` defaults to `http://127.0.0.1:11434/v1`; only loopback HTTP endpoints are accepted. Each run creates an isolated database and report under `examples/inventory/.data/`. `INVENTORY_RUN_DIR` changes the parent directory. The report includes the prompt, tool descriptors, raw model requests and responses, SDK traces, database rows and any failure. Model requests have a two-minute timeout and the run has a five-minute deadline, with at most ten turns and twenty executed tool calls.

The model must search for a recycled notebook, reserve exactly two using the host-generated operation ID, and retrieve the reservation. The runner rejects a reservation outside that task before execution. It independently checks one saved reservation, a stock decrease from five to three, and unchanged pencil stock. It does not execute missing steps on the model's behalf. Reports show the requested model name; they do not record an Ollama model digest or establish general reliability. Restarting this runner starts a new isolated task; automatic resume is not implemented. The saved task file preserves the operation ID for inspection.

## Application authority and retries

`Inventory.login` issues an opaque local session for the seeded `buyer` or `viewer` account after a host-provided shared password check. The model receives neither credentials nor session tokens. This is a local demonstration, not production authentication: accounts are seeded, both accounts use the same password, sessions have no expiration, and database access is trusted. A real deployment must replace this login with its existing identity service.

The application checks the persisted session and buyer role inside `reserve`, even when called directly without the SDK. The SDK is an adapter to this domain method. It cannot grant access. `get` only returns reservations owned by the session's actor. Direct invalid quantities also fail application validation.

Reservation writes run in `BEGIN IMMEDIATE` transactions. The stock update requires sufficient stock and the database forbids a negative balance. An operation ID uniquely identifies a reservation; a retry with the same actor, product and quantity returns the existing row without decrementing stock. Reusing it with changed arguments fails. Stock changes, reservation creation and the success audit record commit together. Rejected authenticated attempts have separate audit records after rollback.

Each reservation audit records `context.callId`, operation ID, actor and outcome. The trace ID identifies an attempt, while the operation ID identifies the durable action. Invalid SDK arguments never reach the application, so their error trace has no corresponding domain audit record. Unauthenticated direct calls also fail before an actor audit record exists. Error messages distinguish forbidden access, missing sessions, operation conflicts and insufficient stock.

## Verification and integration observations

`npm test` uses the actual SDK and SQLite, including two independent child processes competing for four of five notebooks. Exactly one reservation succeeds. Other cases cover SDK and domain validation, viewer denial with SDK bypass, forged sessions, replay, changed-argument conflict, retrieval after reopening the database, metadata-only observers and trace-to-audit correlation.

Initial development tests used an installed `deedspan@0.0.0` tarball with SHA-1 `addd46e3744470e09620bbc4bd81bc8882160432`. The package directory was verified as a regular directory, not a symlink. The root consumer-package check rebuilds the current preview, copies this app outside the repository and repeats build, tests and demo; that is the final preview package evidence.

The original public README explained registration and trace correlation but omitted `list()` discovery, descriptor-to-model mapping and the exact error-output shape. Packed `.d.ts` files supplied discovery and trace types. No additional SDK API was needed. The new public [integration guide](../../docs/integration.md) now explains those integration boundaries. The application supplies its own model loop, transaction, session checks, task constraints and persistence; the SDK does not provide these services.
