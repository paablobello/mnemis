#!/usr/bin/env node
import { dispatch } from './commands.ts';
import { createServices } from './services.ts';

const services = createServices();
const argv = process.argv.slice(2);
const { exitCode } = await dispatch(argv, services);
process.exit(exitCode);
