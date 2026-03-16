#!/usr/bin/env tsx
import { runX32E2E } from './scripts/x32-e2e.js';

runX32E2E().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
