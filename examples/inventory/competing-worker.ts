import { Inventory, inventoryTools } from './inventory.js';
import { z } from 'zod';

const config = z
  .object({
    INVENTORY_DB: z.string(),
    INVENTORY_SESSION: z.string(),
    INVENTORY_OPERATION: z.string().uuid(),
  })
  .parse(process.env);
const app = new Inventory(config.INVENTORY_DB, 'worker-local-password');
try {
  const result = await inventoryTools(app, config.INVENTORY_SESSION).call(
    'reserve_inventory',
    {
      operationId: config.INVENTORY_OPERATION,
      productId: 'notebook',
      quantity: 4,
    },
  );
  process.stdout.write(JSON.stringify(result));
} finally {
  app.close();
}
