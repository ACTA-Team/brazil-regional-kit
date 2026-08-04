import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

/*
 * Compile the package's stylesheet ahead of publish.
 *
 * A component library that only renders correctly once the consumer has wired
 * Tailwind with the right theme is importable, not drop-in. Shipping one built
 * CSS file means `import '@brk/ramp-ui/styles.css'` is genuinely enough, with
 * no build configuration on the other side.
 */
const root = path.dirname(fileURLToPath(import.meta.url));
const input = path.join(root, '..', 'src', 'styles.css');
const output = path.join(root, '..', 'dist', 'styles.css');

const css = fs.readFileSync(input, 'utf8');
const result = await postcss([tailwind()]).process(css, { from: input, to: output });

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, result.css);
console.log(`styles.css  ${(result.css.length / 1024).toFixed(1)} KB`);
