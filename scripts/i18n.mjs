#!/usr/bin/env node
/*
 * i18n helper for WME Alert System — operates on the `getTranslationsFor()` switch blocks of wmeAlertSystem.js
 * (adapted from Waze Chat Plus; en-AU and en-GB have no block: they use `default`).
 *
 * Usage:
 *   node scripts/i18n.mjs locales                     List locale blocks (44 cases + default).
 *   node scripts/i18n.mjs check [--untranslated]      Report untranslated keys (absent: they fall back to English), extra keys
 *                                                     and copies of the English text vs `default` (en-US).
 *                                                     --untranslated lists the untranslated keys instead of counting them.
 *   node scripts/i18n.mjs get <key.path>              Print the value of a key in every locale (JSON).
 *   node scripts/i18n.mjs set <key.path> <file.json>  Insert/replace a key in every locale.
 *                                                     file.json = { "default": "...", "pt-BR": "...", ... }
 *                                                     Locales missing from the file, or with the English text, get no line
 *                                                     (the script falls back to English per key; an old line is removed).
 *                                                     A missing `section` is created (alphabetical position).
 *   node scripts/i18n.mjs remove <key.path>           Remove a key from every locale.
 *   node scripts/i18n.mjs slim                        Remove every value identical to English outside `default` (and the
 *                                                     sections left empty).
 *
 * Only string leaves one level below a top-level key are supported by set/remove
 * (e.g. `newKey`, `buttons.newKey`).
 * Only `default` holds every key; the other locales hold only their real translations (same rule as Waze Chat Plus).
 * Exit code 1 when `check` finds copies of the English text or an operation fails.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE        = join(dirname(fileURLToPath(import.meta.url)), '..', 'wmeAlertSystem.js');
const PACKED_KEYS = [];             // Sections with several `key: 'value'` pairs per line (none in this project).
const MANUAL_KEYS = [];             // Sections whose values are objects; not handled by set/remove (none in this project).
const TOP_INDENT  = 20;
const SUB_INDENT  = 24;

const [command, ...args] = process.argv.slice(2);

function fail(message) {
    console.error(message);
    process.exit(1);
}

/** Splits the file into lines and locates every `translations = { ... };` block. */
function parseBlocks(source) {
    const lines  = source.split(/\r?\n/);
    const blocks = [];
    let locale   = null;

    for (let i = 0; i < lines.length; i++) {
        // Patterns tolerate trailing whitespace: some lines in the userscript have it.
        const caseMatch = lines[i].match(/^ {12}case '([\w-]+)':\s*$/);

        if (caseMatch)
            locale = caseMatch[1];
        else if (/^ {12}default:\s*$/.test(lines[i]))
            locale = 'default';

        if (locale && /^ {16}translations = \{\s*$/.test(lines[i])) {
            const end = lines.findIndex((line, index) => index > i && /^ {16}\};\s*$/.test(line));

            if (end === -1)
                fail(`Unterminated translations block for locale "${ locale }" at line ${ i + 1 }`);

            const text = lines.slice(i, end + 1).join('\n').replace(/^\s*translations = /, '').replace(/;\s*$/, '');

            blocks.push({ locale, start: i, end, object: new Function(`return (${ text });`)() });
            locale = null;
            i      = end;
        }
    }

    if (!blocks.some(block => block.locale === 'default'))
        fail('Could not find the `default:` translations block.');

    return { lines, blocks };
}

function flatten(object, prefix = '', out = {}) {
    for (const [key, value] of Object.entries(object)) {
        const path = prefix ? `${ prefix }.${ key }` : key;

        if (value && typeof value === 'object')
            flatten(value, path, out);
        else
            out[path] = value;
    }

    return out;
}

function getPath(object, path) {
    return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), object);
}

function quote(value) {
    return `'${ String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') }'`;
}

/** Returns [from, to] line range (exclusive of braces) and the indent of the keys inside it. */
function findParentRange(lines, block, parentKey) {
    if (!parentKey)
        return { from: block.start + 1, to: block.end, indent: TOP_INDENT };

    if (MANUAL_KEYS.includes(parentKey))
        fail(`"${ parentKey }" holds object values; edit it manually.`);

    const open = lines.findIndex((line, index) => index > block.start && index < block.end && new RegExp(`^ {${ TOP_INDENT }}${ parentKey }: \\{\\s*$`).test(line));

    if (open === -1)
        return null;

    const close = lines.findIndex((line, index) => index > open && new RegExp(`^ {${ TOP_INDENT }}\\},?\\s*$`).test(line));

    return { from: open + 1, to: close, indent: SUB_INDENT, packed: PACKED_KEYS.includes(parentKey) };
}

function splitKey(path) {
    const parts = path.split('.');

    if (parts.length > 2 || parts.some(part => !/^\w+$/.test(part)))
        fail(`Unsupported key "${ path }". Use "key" or "section.key".`);

    return parts.length === 2 ? { parent: parts[0], leaf: parts[1] } : { parent: null, leaf: parts[0] };
}

/** Matches `leaf: 'value',` anywhere on a packed line (plus the separator that follows it). */
function packedToken(leaf) {
    return new RegExp(`(?<=^|[\\s{,])${ leaf }: '(?:[^'\\\\]|\\\\.)*',?[ \\t]*`);
}

function findLeafLine(lines, range, leaf) {
    const pattern = range.packed ? packedToken(leaf) : new RegExp(`^ {${ range.indent }}${ leaf }: `);

    for (let i = range.from; i < range.to; i++)
        if (pattern.test(lines[i]))
            return i;

    return -1;
}

/** Removes a leaf line (not packed) and its section when that leaves it empty. Returns true when a line was removed. */
function removeLeaf(lines, block, parent, leaf) {
    const range = findParentRange(lines, block, parent);
    const line  = range ? findLeafLine(lines, range, leaf) : -1;

    if (line === -1)
        return false;

    lines.splice(line, 1);

    if (parent && range.to - range.from == 1)
        lines.splice(range.from - 1, 2);

    return true;
}

/** Applies edits bottom-up so earlier line indexes stay valid. */
function editBlocks(source, editor) {
    const { lines, blocks } = parseBlocks(source);

    [...blocks].reverse().forEach(block => editor(lines, block));

    const output = lines.join(EOL);

    parseBlocks(output); // Sanity check: the result must still evaluate.

    writeFileSync(FILE, output);
}

const source = readFileSync(FILE, 'utf8');
const EOL    = source.includes('\r\n') ? '\r\n' : '\n'; // The library uses CRLF; preserve whatever it has.

switch (command) {
    case 'locales': {
        console.log(parseBlocks(source).blocks.map(block => block.locale).join('\n'));

        break;
    }

    case 'check': {
        const { blocks }       = parseBlocks(source);
        const reference        = flatten(blocks.find(block => block.locale === 'default').object);
        const referenceKeys    = Object.keys(reference);
        const showUntranslated = args.includes('--untranslated');
        let copies             = 0;
        let untranslatedTotal  = 0;

        for (const block of blocks) {
            if (block.locale === 'default')
                continue;

            const flat         = flatten(block.object);
            const untranslated = referenceKeys.filter(key => !(key in flat));
            const extra        = Object.keys(flat).filter(key => !(key in reference));
            const same         = referenceKeys.filter(key => key in flat && flat[key] === reference[key]);

            copies            += same.length;
            untranslatedTotal += untranslated.length;

            if (untranslated.length || extra.length || same.length) {
                console.log(`[${ block.locale }]`);

                if (untranslated.length) console.log(`  untranslated (${ untranslated.length })${ showUntranslated ? `: ${ untranslated.join(', ') }` : '' }`);
                if (extra.length) console.log(`  extra: ${ extra.join(', ') }`);
                if (same.length) console.log(`  copies of English (${ same.length }, run slim): ${ same.join(', ') }`);
            }
        }

        console.log(`${ blocks.length } locale blocks, ${ referenceKeys.length } keys in default, ${ untranslatedTotal } untranslated values (English fallback). ${ copies ? 'COPIES OF ENGLISH FOUND.' : 'No copies of English.' }`);
        process.exit(copies ? 1 : 0);
    }

    case 'get': {
        if (!args[0])
            fail('Usage: get <key.path>');

        const result = {};

        parseBlocks(source).blocks.forEach(block => (result[block.locale] = getPath(block.object, args[0]) ?? null));
        console.log(JSON.stringify(result, null, 2));

        break;
    }

    case 'set': {
        if (!args[0] || !args[1])
            fail('Usage: set <key.path> <file.json>');

        const { parent, leaf } = splitKey(args[0]);
        const values           = JSON.parse(readFileSync(args[1], 'utf8'));

        if (typeof values.default !== 'string')
            fail('The JSON file must contain a string "default" (en-US) value.');

        const fallbacks = [];

        editBlocks(source, (lines, block) => {
            const value = block.locale === 'default' ? values.default : values[block.locale];

            // English fallback: no copy of the English text outside `default`
            if (block.locale !== 'default' && (typeof value !== 'string' || value === values.default)) {
                fallbacks.push(block.locale);
                removeLeaf(lines, block, parent, leaf);

                return;
            }

            let range = findParentRange(lines, block, parent);

            if (!range) {
                // New section: created empty, before the first top-level key that sorts after it
                const topPattern = new RegExp(`^ {${ TOP_INDENT }}(\\w+): `);
                let insertAt     = block.end;

                for (let i = block.start + 1; i < block.end; i++) {
                    const match = lines[i].match(topPattern);

                    if (match && match[1].localeCompare(parent) > 0) {
                        insertAt = i;

                        break;
                    }
                }

                lines.splice(insertAt, 0, `${ ' '.repeat(TOP_INDENT) }${ parent }: {`, `${ ' '.repeat(TOP_INDENT) }},`);

                range = findParentRange(lines, { ...block, end: block.end + 2 }, parent);
            }

            const pair     = `${ leaf }: ${ quote(value) },`;
            const newLine  = ' '.repeat(range.indent) + pair;
            const existing = findLeafLine(lines, range, leaf);

            if (existing !== -1) {
                lines[existing] = range.packed ? lines[existing].replace(packedToken(leaf), pair + ' ').trimEnd() : newLine;

                return;
            }

            if (range.packed) {
                // Append on its own line before the closing brace; the last packed line may lack a trailing comma.
                if (!/[,{]\s*$/.test(lines[range.to - 1]))
                    lines[range.to - 1] = lines[range.to - 1].trimEnd() + ',';

                lines.splice(range.to, 0, newLine);

                return;
            }

            // Insert before the first sibling that sorts after the new key (keeps the mostly-alphabetical order).
            const siblingPattern = new RegExp(`^ {${ range.indent }}(\\w+): `);
            let insertAt         = range.to;

            for (let i = range.from; i < range.to; i++) {
                const match = lines[i].match(siblingPattern);

                if (match && match[1].localeCompare(leaf) > 0) {
                    insertAt = i;

                    break;
                }
            }

            // Appending after the last key: it may lack a trailing comma.
            if (insertAt > range.from && !/[,{]\s*$/.test(lines[insertAt - 1]))
                lines[insertAt - 1] = lines[insertAt - 1].trimEnd() + ',';

            lines.splice(insertAt, 0, newLine);
        });

        console.log(`Set "${ args[0] }" in all locales.`);

        if (fallbacks.length)
            console.log(`English fallback (no line) for: ${ fallbacks.join(', ') }`);

        break;
    }

    case 'slim': {
        const { blocks } = parseBlocks(source);
        const reference  = flatten(blocks.find(block => block.locale === 'default').object);
        let removed      = 0;

        editBlocks(source, (lines, block) => {
            if (block.locale === 'default')
                return;

            const same = Object.entries(flatten(block.object)).filter(([key, value]) => reference[key] === value).map(([key]) => key);

            // Bottom-up inside the block too, so the line indexes found stay valid
            for (const key of same.reverse()) {
                const { parent, leaf } = splitKey(key);

                if (removeLeaf(lines, block, parent, leaf))
                    removed++;
            }
        });

        console.log(`Removed ${ removed } copies of the English text.`);

        break;
    }

    case 'remove': {
        if (!args[0])
            fail('Usage: remove <key.path>');

        const { parent, leaf } = splitKey(args[0]);
        let removed            = 0;

        editBlocks(source, (lines, block) => {
            const range = findParentRange(lines, block, parent);
            const line  = range ? findLeafLine(lines, range, leaf) : -1;

            if (line === -1)
                return;

            removed++;

            if (!range.packed)
                return void removeLeaf(lines, block, parent, leaf);

            lines[line] = lines[line].replace(packedToken(leaf), '').trimEnd();

            if (!lines[line].trim())
                lines.splice(line, 1);
        });

        console.log(`Removed "${ args[0] }" from ${ removed } locale blocks.`);

        break;
    }

    default:
        fail('Commands: locales | check [--untranslated] | get <key> | set <key> <file.json> | remove <key> | slim');
}
