import type * as Monaco from 'monaco-editor';
import { getMembersCached, getModules, cachedMembers } from './runner';
import { useAppStore } from '../store';
import { heapObject } from './explain';
import type { MemberInfo } from '../types';

const KEYWORDS = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
];

/** name used in code -> module path, from import statements. */
function importAliases(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of text.matchAll(/^\s*import\s+([\w., ]+?)\s*(?:#.*)?$/gm)) {
    for (const part of m[1].split(',')) {
      const [mod, alias] = part.trim().split(/\s+as\s+/);
      if (!mod) continue;
      map.set(alias ?? mod.split('.')[0], alias ? mod : mod.split('.')[0]);
    }
  }
  for (const m of text.matchAll(/^\s*from\s+([\w.]+)\s+import\s+\(?([\w, \n]+?)\)?\s*(?:#.*)?$/gm)) {
    for (const part of m[2].split(',')) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (name) map.set(alias ?? name, `${m[1]}.${name}`);
    }
  }
  return map;
}

/** If `name` is a variable in the latest trace, the builtin type to complete for it. */
function typeOfVariable(name: string): string | null {
  const { trace, stepIndex } = useAppStore.getState();
  if (!trace || !trace.steps.length) return null;
  const step = trace.steps[Math.min(stepIndex, trace.steps.length - 1)];
  for (let i = step.stack.length - 1; i >= 0; i--) {
    const found = step.stack[i].vars.find(([n]) => n === name);
    if (!found) continue;
    const ref = found[1];
    if (ref.ref === undefined) return ['str', 'int', 'float', 'bytes', 'complex'].includes(ref.t) ? `builtins.${ref.t}` : null;
    const obj = heapObject(trace, step, ref);
    if (!obj) return null;
    if (['list', 'tuple', 'set', 'dict'].includes(obj.k) && ['list', 'tuple', 'set', 'dict', 'frozenset'].includes(obj.type)) return `builtins.${obj.type}`;
    if (obj.type.includes('.')) return obj.type; // e.g. collections.Counter, datetime.date
    if (obj.k === 'dict') return 'builtins.dict';
    if (obj.k === 'list') return 'builtins.list';
    return null;
  }
  return null;
}

function kindOf(monaco: typeof Monaco, k: MemberInfo['kind']) {
  const K = monaco.languages.CompletionItemKind;
  return k === 'module' ? K.Module : k === 'class' ? K.Class : k === 'function' ? K.Function : K.Constant;
}

function memberItems(monaco: typeof Monaco, members: MemberInfo[], range: Monaco.IRange): Monaco.languages.CompletionItem[] {
  return members.map((m) => ({
    label: m.name,
    kind: kindOf(monaco, m.kind),
    detail: m.sig ? `${m.name}${m.sig}` : m.kind,
    documentation: m.doc,
    insertText: m.name,
    range,
  }));
}

export function registerPythonIntelligence(monaco: typeof Monaco) {
  monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.', ' '],
    async provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
      const text = model.getValue();

      // import xyz / from xyz
      if (/^\s*(import|from)\s+[\w.]*$/.test(before) && !before.includes(' import ')) {
        const typed = before.match(/([\w.]*)$/)?.[1] ?? '';
        if (typed.includes('.')) {
          const pkg = typed.slice(0, typed.lastIndexOf('.'));
          const members = await getMembersCached(pkg);
          return { suggestions: memberItems(monaco, members.filter((m) => m.kind === 'module'), range) };
        }
        const mods = await getModules();
        return {
          suggestions: mods.map((m) => ({ label: m, kind: monaco.languages.CompletionItemKind.Module, insertText: m, range })),
        };
      }
      // from xyz import abc
      const fromMatch = before.match(/^\s*from\s+([\w.]+)\s+import\s+(?:[\w\s,]*,\s*)?$/);
      if (fromMatch) {
        const members = await getMembersCached(fromMatch[1]);
        return { suggestions: memberItems(monaco, members, range) };
      }
      // something.
      const dot = before.match(/([A-Za-z_][\w.]*)\.$/);
      if (dot) {
        const chain = dot[1];
        const aliases = importAliases(text);
        const head = chain.split('.')[0];
        let target: string | null = null;
        if (aliases.has(head)) target = [aliases.get(head)!, ...chain.split('.').slice(1)].join('.');
        else if (!chain.includes('.')) target = typeOfVariable(chain);
        if (target) {
          const members = await getMembersCached(target);
          if (members.length) return { suggestions: memberItems(monaco, members, range) };
        }
        // Unknown object: offer attribute names seen in the code.
        const seen = new Set<string>();
        for (const m of text.matchAll(new RegExp(`\\b${chain.replace(/\./g, '\\.')}\\.([A-Za-z_]\\w*)`, 'g'))) seen.add(m[1]);
        return {
          suggestions: [...seen].map((s) => ({ label: s, kind: monaco.languages.CompletionItemKind.Property, insertText: s, range })),
        };
      }

      // Plain names: keywords, builtins, names defined in the program.
      const suggestions: Monaco.languages.CompletionItem[] = KEYWORDS.map((k) => ({
        label: k,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: k,
        range,
      }));
      const builtins = await getMembersCached('builtins');
      suggestions.push(...memberItems(monaco, builtins.filter((b) => !/Error$|Warning$|Exception$/.test(b.name) || b.name.length < 20), range));
      const own = new Set<string>();
      for (const m of text.matchAll(/^\s*(?:def|class)\s+([A-Za-z_]\w*)/gm)) own.add(m[1]);
      for (const m of text.matchAll(/^\s*([A-Za-z_]\w*)\s*(?:,\s*[A-Za-z_]\w*\s*)*=(?!=)/gm)) own.add(m[1]);
      for (const m of text.matchAll(/\bfor\s+([A-Za-z_]\w*)/g)) own.add(m[1]);
      for (const alias of importAliases(text).keys()) own.add(alias);
      own.forEach((n) =>
        suggestions.push({ label: n, kind: monaco.languages.CompletionItemKind.Variable, insertText: n, range, sortText: '0' + n }),
      );
      return { suggestions };
    },
  });

  // Hover over module.member to see its signature and docs.
  monaco.languages.registerHoverProvider('python', {
    async provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const line = model.getLineContent(position.lineNumber);
      const left = line.slice(0, word.startColumn - 1).match(/([A-Za-z_][\w.]*)\.$/);
      const aliases = importAliases(model.getValue());
      let target: string | null = null;
      let name = word.word;
      if (left) {
        const head = left[1].split('.')[0];
        if (aliases.has(head)) target = [aliases.get(head)!, ...left[1].split('.').slice(1)].join('.');
        else target = typeOfVariable(left[1]);
      } else if (aliases.has(name)) {
        const full = aliases.get(name)!;
        const cut = full.lastIndexOf('.');
        if (cut < 0) return { contents: [{ value: `**module** \`${full}\`` }] };
        target = full.slice(0, cut);
        name = full.slice(cut + 1);
      } else {
        target = 'builtins';
      }
      if (!target) return null;
      const members = cachedMembers.get(target) ?? (await getMembersCached(target));
      const m = members.find((x) => x.name === name);
      if (!m) return null;
      return {
        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
        contents: [{ value: '```python\n' + `${m.name}${m.sig ?? ''}` + '\n```' }, { value: m.doc || m.kind }],
      };
    },
  });
}
