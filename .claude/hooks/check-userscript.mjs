#!/usr/bin/env node
/*
 * PostToolUse hook: after any edit to wmeAlertSystem.js, run scripts/check.mjs (syntax, version sync, i18n keys/placeholders,
 * XSS heuristic, CRLF, size). Exit code 2 feeds stderr back to Claude so it can fix the problem.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

let input = '';

for await (const chunk of process.stdin)
    input += chunk;

const filePath = JSON.parse(input || '{}').tool_input?.file_path ?? '';

if (!/wmeAlertSystem\.js$/i.test(filePath))
    process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const check      = spawnSync(process.execPath, [join(projectDir, 'scripts', 'check.mjs'), '--quiet'], { encoding: 'utf8' });
const output     = (check.stdout + check.stderr).trim();

if (check.status !== 0) {
    console.error(`scripts/check.mjs failed (missing i18n keys are expected mid-change — finish them with scripts/i18n.mjs set before ending the task):\n${ output }`);
    process.exit(2);
}

// Warnings don't block, but Claude should see them
if (output) {
    console.error(`scripts/check.mjs warnings (not blocking):\n${ output }`);
    process.exit(2);
}
