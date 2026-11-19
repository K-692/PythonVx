// Examples come from the sample programs in /samples (one .py file each).
// Each file starts with a small header:
//   # Title: Variables & printing
//   # Group: Basics
//   # Input: Grace|1990        (optional: lines for input(), separated by |)

export type ExampleGroup = 'Basics' | 'Functions' | 'Data' | 'Classes' | 'Standard library';

export interface Example {
  id: string;
  title: string;
  group: ExampleGroup;
  code: string;
  stdin?: string;
}

const files = import.meta.glob('../../samples/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function parse(path: string, raw: string): Example {
  const id = path.split('/').pop()!.replace(/\.py$/, '');
  const meta: Record<string, string> = {};
  const body: string[] = [];
  let inHeader = true;
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    const m = inHeader && line.match(/^#\s*(Title|Group|Input):\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
    else {
      inHeader = false;
      body.push(line);
    }
  }
  return {
    id,
    title: meta.title || id,
    group: (meta.group as ExampleGroup) || 'Basics',
    code: body.join('\n').replace(/\n+$/, '\n'),
    stdin: meta.input ? meta.input.split('|').join('\n') + '\n' : undefined,
  };
}

export const EXAMPLES: Example[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, raw]) => parse(path, raw));

export const DEFAULT_EXAMPLE: Example = EXAMPLES[0] ?? { id: 'empty', title: 'Empty', group: 'Basics', code: 'print("Hello, world!")\n' };
