#!/usr/bin/env node
import { main } from '../src/cli/ada-audit.mjs';
process.exitCode = await main();
