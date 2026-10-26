#!/usr/bin/env node
/*
 * Static validator for wmeAlertSystem.js (Node >= 18, no dependencies). Adapted from Waze Chat Plus.
 *
 * Usage:
 *   node scripts/check.mjs             Errors exit 1; warnings are printed but don't fail.
 *   node scripts/check.mjs --release   Also fails on dev leftovers (devVersion = true, stray console.*, // TESTANDO).
 *   node scripts/check.mjs --quiet     Print only problems.
 *
 * Checks:
 *   1. Syntax (`node --check`).
 *   2. `// @version` == `static get VERSION()`.
 *   2b. `CHANGELOG.md` has a `## [<version>]` section for the current version.
 *   3. i18n: only `default` holds every key (an absent key falls back to English); no locale holds a copy of the English text,
 *      nor a key `default` lacks; same %{placeholders} per key; every literal `getTranslation('key')` and notification
 *      `textKeys` entry (`['section.key', …]`) exists in `default`.
 *   4. XSS heuristic (warning): `${ expr }` on an innerHTML/insertAdjacentHTML line that isn't escaped/translated.
 *   5. Line endings: CRLF only (warning on LF lines).
 *   6. Size under Greasy Fork's limit (2 097 152 characters).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT  = join(ROOT, 'wmeAlertSystem.js');
const args    = process.argv.slice(2);
const release = args.includes('--release');
const quiet   = args.includes('--quiet');

const errors   = [];
const warnings = [];
const info     = message => { if (!quiet) console.log(message); };

// 1. Syntax
const syntax = existsSync(SCRIPT) ? spawnSync(process.execPath, ['--check', SCRIPT], { encoding: 'utf8' }) : { status: 1, stderr: 'File missing.' };

if (syntax.status !== 0) {
    console.error(`Syntax error in wmeAlertSystem.js:\n${ syntax.stderr.trim() }`);
    process.exit(1);
}

const source = readFileSync(SCRIPT, 'utf8');
const lines  = source.split(/\r?\n/);

// 2. Version
const headerVersion = source.match(/^\/\/ @version\s+(\S+)/m)?.[1];
const classVersion  = source.match(/static get VERSION\(\) \{\s*return '([^']+)'/)?.[1];

if (!headerVersion || headerVersion !== classVersion)
    errors.push(`\`// @version\` (${ headerVersion }) and \`static get VERSION()\` (${ classVersion }) differ.`);

// 2b. CHANGELOG.md has a section for the current version
const changelogFile = join(ROOT, 'CHANGELOG.md');

if (!existsSync(changelogFile))
    errors.push('CHANGELOG.md is missing.');
else if (headerVersion && !new RegExp(`^## \\[?v?${ headerVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }\\]?(\\s|$)`, 'm').test(readFileSync(changelogFile, 'utf8')))
    errors.push(`CHANGELOG.md has no \`## [${ headerVersion }]\` section.`);

// 3. i18n (same block format as scripts/i18n.mjs)
const blocks = [];
let locale   = null;

for (let i = 0; i < lines.length; i++) {
    const caseMatch = lines[i].match(/^ {12}case '([\w-]+)':\s*$/);

    if (caseMatch)
        locale = caseMatch[1];
    else if (/^ {12}default:\s*$/.test(lines[i]))
        locale = 'default';

    if (locale && /^ {16}translations = \{\s*$/.test(lines[i])) {
        const end  = lines.findIndex((line, index) => index > i && /^ {16}\};\s*$/.test(line));
        const text = lines.slice(i, end + 1).join('\n').replace(/^\s*translations = /, '').replace(/;\s*$/, '');

        blocks.push({ locale, object: new Function(`return (${ text });`)() });
        locale = null;
    }
}

const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) =>
    value && typeof value === 'object' ? flatten(value, `${ prefix }${ key }.`) : [[`${ prefix }${ key }`, value]]);

const placeholders = text => [...String(text).matchAll(/%\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
const reference    = blocks.find(block => block.locale === 'default');

if (!reference) {
    errors.push('i18n: no `default` translations block found.');
} else {
    const referenceKeys = new Map(flatten(reference.object));
    let untranslated    = 0;

    for (const block of blocks) {
        if (block === reference)
            continue;

        const keys    = new Map(flatten(block.object));
        const copies  = [...keys.keys()].filter(key => keys.get(key) === referenceKeys.get(key));
        const extra   = [...keys.keys()].filter(key => !referenceKeys.has(key));
        const badVars = [...referenceKeys.keys()].filter(key => keys.has(key) && placeholders(keys.get(key)) !== placeholders(referenceKeys.get(key)));

        untranslated += [...referenceKeys.keys()].filter(key => !keys.has(key)).length;

        if (copies.length)
            errors.push(`i18n ${ block.locale }: copies of the English text in ${ copies.join(', ') } (run scripts/i18n.mjs slim).`);

        if (extra.length)
            warnings.push(`i18n ${ block.locale }: keys not in default: ${ extra.join(', ') }.`);

        if (badVars.length)
            errors.push(`i18n ${ block.locale }: %{placeholders} differ from default in ${ badVars.join(', ') }.`);
    }

    const usedKeys = [...new Set([...source.matchAll(/getTranslation\(\s*'([\w.]+)'|\[\s*'(\w+\.[\w.]+)'/g)].map(match => match[1] || match[2]))];
    const unknown  = usedKeys.filter(key => typeof referenceKeys.get(key) !== 'string');

    if (unknown.length)
        errors.push(`i18n: the script uses keys missing from \`default\`: ${ unknown.join(', ') }.`);

    info(`i18n: ${ blocks.length } locale blocks, ${ referenceKeys.size } keys (${ usedKeys.length } literal keys used), ${ untranslated } untranslated values (English fallback).`);
}

// 4. XSS heuristic
const SAFE_INTERPOLATION = /^(this\.(escapeHtml|getTranslation|renderParagraphs|scriptName|scriptVersion)\b|[\w.]*[Ii]d\b|\d)/;

lines.forEach((line, index) => {
    if (!/innerHTML|insertAdjacentHTML/.test(line))
        return;

    for (const match of line.matchAll(/\$\{\s*([^}]+?)\s*\}/g)) {
        if (!SAFE_INTERPOLATION.test(match[1]))
            warnings.push(`L${ index + 1 }: \`\${ ${ match[1] } }\` goes into HTML — escapeHtml() it unless it is trusted markup.`);
    }
});

// 5. Line endings
const lfLines = (source.match(/(^|[^\r])\n/g) || []).length;

if (lfLines)
    warnings.push(`${ lfLines } LF line endings (the project uses CRLF).`);

// 6. Size on Greasy Fork
const GREASY_FORK_LIMIT = 2097152;
const share             = `${ Math.round(source.length / GREASY_FORK_LIMIT * 100) }% of Greasy Fork's limit`;

if (source.length > GREASY_FORK_LIMIT)
    errors.push(`The library has ${ source.length } characters, over Greasy Fork's limit of ${ GREASY_FORK_LIMIT }.`);
else
    info(`Size: ${ source.length } characters (${ share }).`);

// Release-only checks
if (release) {
    if (/this\.devVersion\s*=\s*true/.test(source))
        errors.push('Release: `this.devVersion = true` (set it to false).');

    lines.forEach((line, index) => {
        if (/TESTANDO/.test(line))
            errors.push(`Release: L${ index + 1 } has // TESTANDO code.`);

        if (/\bconsole\.(log|warn|error|info|debug)\(/.test(line) && !/^\s*(\/\/|\*)/.test(line))
            errors.push(`Release: L${ index + 1 } uses console.* directly (use this.logDebug).`);
    });
}

warnings.forEach(warning => console.warn(`warning: ${ warning }`));
errors.forEach(error => console.error(`error: ${ error }`));

if (errors.length)
    process.exit(1);

info(`OK: wmeAlertSystem.js v${ headerVersion }${ release ? ' (release checks)' : '' }.`);
