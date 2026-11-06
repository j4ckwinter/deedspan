# deedspan

deedspan is a typescript sdk for exposing application actions to agents. define the input, connect your existing function, and get a trace of every call.

your application keeps control of permissions, approvals and saved data.

## try it out

use Node.js 24 or newer.

```sh
git clone https://github.com/j4ckwinter/deedspan.git
cd deedspan
npm ci
npm run dev
```

open <http://127.0.0.1:3000> and run the launch-notes scenario in **scripted demo** mode. no model or credentials needed. turn on the wrong-project regression to see the workbench catch a bad result, even when the agent says it succeeded.

for Ollama, Windows setup and model checks, see [local development](docs/local-development.md).

## use it

this is a local developer preview, not yet published to npm. build an installable archive from the checkout:

```sh
npm run preview:pack
```

then install the printed archive path in your application:

```sh
npm install /path/to/deedspan-0.1.0-preview.1.tgz zod@4.6.7
```

register an action:

```ts
import { ToolRegistry } from 'deedspan';
import { z } from 'zod';

const tools = new ToolRegistry();
tools.register({
  name: 'search_products',
  description: 'Search products by name.',
  input: z.object({ query: z.string().min(1) }).strict(),
  authorize: () => currentUser.canSearch,
  execute: ({ query }) => searchProducts(query),
});

const availableTools = tools.list();
const result = await tools.call('search_products', { query: 'notebook' });
```

`currentUser` and `searchProducts` come from your app. keep permission checks in the backend that owns the data too.

the [integration guide](docs/integration.md) covers connecting a model, handling results and using traces. React and experimental WebMCP support are optional; the core works without either.

## a bit more

- [drafts example](examples/drafts/README.md): create and update drafts with approval, retries and conflict checks.
- [inventory example](examples/inventory/README.md): reserve finite stock and retrieve the saved result.
- [developer preview](docs/developer-preview.md): package installation and checks.
- [verification record](docs/verification.md): what we tested, what passed and the known limitations.
