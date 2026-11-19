"""
PythonVx tracer.

Runs a user's program under ``sys.settrace`` and records every step
(line executed, function called, value returned, exception raised) together
with a snapshot of the call stack and of every object reachable from it.

The result is written as JSON to an output file (never to stdout, so the
user's own prints can't corrupt it).

Usage:
    python tracer.py run        <request.json> <response.json>
    python tracer.py introspect <request.json> <response.json>
    python tracer.py version

Only the standard library is used. Supports Python 3.8+.
"""

import ast
import builtins
import inspect
import io
import keyword
import json
import linecache
import os
import sys
import time
import tokenize
import traceback
import types

USER_FILE = "<main.py>"
FORMAT_VERSION = 2

# Limits that keep the trace small and the UI responsive.
MAX_ITEMS = 60          # elements shown per list/dict/set/attrs
MAX_STR = 240           # characters shown per string / repr
MAX_OBJECTS = 300       # heap objects captured per step
MAX_DEPTH = 8           # nesting depth followed from a variable


def _short(text, limit=MAX_STR):
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


_ADDR = None


def _safe_repr(value):
    global _ADDR
    try:
        t = type(value)
        if _is_user_type(t) and t.__repr__ is object.__repr__:
            return "%s object" % t.__qualname__
        text = repr(value)
        if " at 0x" in text:
            if _ADDR is None:
                import re
                _ADDR = re.compile(r" at 0x[0-9a-fA-F]+")
            text = _ADDR.sub("", text)
        return _short(text)
    except Exception as exc:  # user __repr__ can fail
        return "<%s object (repr failed: %s)>" % (type(value).__name__, type(exc).__name__)


def _type_name(value):
    t = type(value)
    mod = getattr(t, "__module__", "builtins")
    if mod in ("builtins", "__main__", None):
        return t.__name__
    return "%s.%s" % (mod, t.__qualname__ if hasattr(t, "__qualname__") else t.__name__)


def _is_user_type(t):
    return getattr(t, "__module__", None) == "__main__"


class Console(io.TextIOBase):
    """Collects everything the program prints (stdout and stderr)."""

    def __init__(self, store, limit=200_000):
        self._store = store
        self._limit = limit

    def writable(self):
        return True

    def write(self, s):
        if not isinstance(s, str):
            raise TypeError("write() argument must be str, not %s" % type(s).__name__)
        if self._store["size"] < self._limit:
            chunk = s[: self._limit - self._store["size"]]
            self._store["parts"].append(chunk)
            self._store["size"] += len(chunk)
            if len(chunk) < len(s):
                self._store["truncated"] = True
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return False

    @property
    def encoding(self):
        return "utf-8"


class Snapshotter:
    """Turns live Python objects into JSON-friendly descriptions.

    Primitive values are inlined. Everything else becomes a reference to an
    entry in a heap. Identical object snapshots are stored once in a shared
    pool, so a long trace stays compact.
    """

    def __init__(self):
        self.pool = []          # list of serialized heap objects
        self.pool_index = {}    # json text -> index in pool
        self.ids = {}           # id(obj) -> small number shown in the UI

    def small_id(self, obj):
        key = id(obj)
        num = self.ids.get(key)
        if num is None:
            num = len(self.ids) + 1
            self.ids[key] = num
        return num

    # -- values -------------------------------------------------------
    def value(self, v, heap, depth):
        if v is None or isinstance(v, bool):
            return {"t": type(v).__name__, "v": repr(v)}
        if type(v) in (int, float, complex):
            return {"t": type(v).__name__, "v": _short(repr(v))}
        if type(v) is str:
            return {"t": "str", "v": _short(repr(v)), "len": len(v)}
        if type(v) in (bytes, bytearray) and len(v) <= 64:
            return {"t": type(v).__name__, "v": _short(repr(v))}
        oid = self.small_id(v)
        if oid not in heap and len(heap) < MAX_OBJECTS:
            heap[oid] = None  # reserve (stops infinite recursion on cycles)
            if depth < MAX_DEPTH:
                heap[oid] = self.describe(v, heap, depth + 1)
            else:
                heap[oid] = {"k": "other", "type": _type_name(v), "repr": _safe_repr(v)}
        elif oid not in heap:
            return {"t": _type_name(v), "v": _safe_repr(v)}
        return {"ref": oid}

    def _items(self, seq, heap, depth):
        out = []
        for i, x in enumerate(seq):
            if i >= MAX_ITEMS:
                break
            out.append(self.value(x, heap, depth))
        return out

    def describe(self, v, heap, depth):
        tname = _type_name(v)
        try:
            # Classic containers (and their stdlib subclasses: Counter,
            # OrderedDict, defaultdict, namedtuple, ...).
            if isinstance(v, dict):
                entries = []
                for i, (k, val) in enumerate(v.items()):
                    if i >= MAX_ITEMS:
                        break
                    entries.append([self.value(k, heap, depth), self.value(val, heap, depth)])
                return {"k": "dict", "type": tname, "entries": entries, "len": len(v)}
            if isinstance(v, tuple) and hasattr(type(v), "_fields"):
                fields = list(type(v)._fields)
                return {"k": "namedtuple", "type": tname, "fields": fields[:MAX_ITEMS],
                        "items": self._items(v, heap, depth), "len": len(v)}
            if isinstance(v, (list, tuple)):
                kind = "list" if isinstance(v, list) else "tuple"
                return {"k": kind, "type": tname, "items": self._items(v, heap, depth), "len": len(v)}
            if isinstance(v, (set, frozenset)):
                try:
                    ordered = sorted(v)
                except Exception:
                    ordered = list(v)
                return {"k": "set", "type": tname, "items": self._items(ordered, heap, depth), "len": len(v)}
            if type(v).__name__ == "deque" and type(v).__module__ == "collections":
                return {"k": "list", "type": tname, "items": self._items(v, heap, depth), "len": len(v)}
            if isinstance(v, range):
                return {"k": "other", "type": "range", "repr": repr(v)}
            if isinstance(v, (bytes, bytearray)):
                return {"k": "other", "type": tname, "repr": _safe_repr(v), "len": len(v)}
            if isinstance(v, str):
                return {"k": "other", "type": "str", "repr": _safe_repr(v), "len": len(v)}

            # Code-related objects.
            if isinstance(v, types.ModuleType):
                return {"k": "module", "type": "module", "name": v.__name__,
                        "doc": _first_doc_line(v)}
            if isinstance(v, (types.FunctionType, types.LambdaType)):
                return {"k": "function", "type": "function", "name": v.__qualname__,
                        "sig": _signature(v), "user": v.__code__.co_filename == USER_FILE,
                        "line": v.__code__.co_firstlineno if v.__code__.co_filename == USER_FILE else None}
            if isinstance(v, types.MethodType):
                return {"k": "function", "type": "method", "name": getattr(v.__func__, "__qualname__", "method"),
                        "sig": _signature(v), "user": False,
                        "self": self.value(v.__self__, heap, depth)}
            if isinstance(v, (types.BuiltinFunctionType, types.BuiltinMethodType)) or callable(v) and type(v).__name__ in (
                    "method_descriptor", "wrapper_descriptor", "method-wrapper", "builtin_function_or_method", "functools.partial"):
                return {"k": "function", "type": "built-in function", "name": getattr(v, "__qualname__", getattr(v, "__name__", "?")),
                        "sig": _signature(v), "user": False}
            if isinstance(v, type):
                attrs = []
                if _is_user_type(v):
                    for name, val in list(vars(v).items()):
                        if name.startswith("__") and name.endswith("__") and not isinstance(val, types.FunctionType):
                            continue
                        attrs.append([name, self.value(val, heap, depth)])
                        if len(attrs) >= MAX_ITEMS:
                            break
                bases = [b.__name__ for b in v.__bases__ if b is not object]
                return {"k": "class", "type": "class", "name": v.__qualname__, "bases": bases,
                        "attrs": attrs, "user": _is_user_type(v)}

            # Instances of classes defined in the user's program: show attributes.
            if _is_user_type(type(v)):
                attrs = []
                d = getattr(v, "__dict__", None)
                if isinstance(d, dict):
                    for name, val in list(d.items()):
                        attrs.append([str(name), self.value(val, heap, depth)])
                        if len(attrs) >= MAX_ITEMS:
                            break
                for name in getattr(type(v), "__slots__", ()) or ():
                    if hasattr(v, name):
                        attrs.append([name, self.value(getattr(v, name), heap, depth)])
                return {"k": "instance", "type": type(v).__qualname__, "attrs": attrs,
                        "repr": _safe_repr(v) if type(v).__repr__ is not object.__repr__ else None}

            # Anything else (datetime, Decimal, Path, re.Match, generators, files...)
            info = {"k": "other", "type": tname, "repr": _safe_repr(v)}
            try:
                if hasattr(v, "__len__"):
                    info["len"] = len(v)
            except Exception:
                pass
            return info
        except Exception as exc:
            return {"k": "other", "type": tname, "repr": "<could not inspect: %s>" % type(exc).__name__}

    def intern(self, obj):
        text = json.dumps(obj, sort_keys=True, separators=(",", ":"))
        idx = self.pool_index.get(text)
        if idx is None:
            idx = len(self.pool)
            self.pool.append(obj)
            self.pool_index[text] = idx
        return idx


def _first_doc_line(obj):
    try:
        doc = getattr(obj, "__doc__", None)
        if isinstance(doc, str):
            for line in doc.strip().splitlines():
                line = line.strip()
                if line:
                    return _short(line, 160)
    except Exception:
        pass
    return ""


def _signature(obj):
    try:
        return str(inspect.signature(obj))
    except Exception:
        return "(...)"


def _frame_name(code):
    name = code.co_name
    pretty = {
        "<module>": "Global",
        "<listcomp>": "list comprehension",
        "<dictcomp>": "dict comprehension",
        "<setcomp>": "set comprehension",
        "<genexpr>": "generator expression",
        "<lambda>": "lambda",
    }
    return pretty.get(name, getattr(code, "co_qualname", name))


HIDDEN_GLOBALS = {"__builtins__", "__name__", "__doc__", "__package__", "__loader__",
                  "__spec__", "__annotations__", "__file__", "__cached__"}

# ----------------------------------------------------------------------
# Static structure of the program (drives the block diagram in the UI)
# ----------------------------------------------------------------------

def _char_col(line_text, byte_col):
    """ast columns are UTF-8 byte offsets; the UI works in characters."""
    try:
        return len(line_text.encode("utf-8")[:byte_col].decode("utf-8", "ignore"))
    except Exception:
        return byte_col


class CallRecorder(ast.NodeTransformer):
    """Wraps every call ``f(x)`` as ``__pvx_call__(line, col, f(x))`` so the
    value each call produced can be shown next to the function's name."""

    def __init__(self, lines):
        self.lines = lines

    def visit_Call(self, node):
        self.generic_visit(node)
        f = node.func
        if isinstance(f, ast.Name):
            line, bcol = f.lineno, f.col_offset
        elif isinstance(f, ast.Attribute) and getattr(f, "end_lineno", None):
            line, bcol = f.end_lineno, f.end_col_offset - len(f.attr.encode("utf-8"))
        else:
            return node
        text = self.lines[line - 1] if 0 < line <= len(self.lines) else ""
        wrapped = ast.Call(
            func=ast.Name(id="__pvx_call__", ctx=ast.Load()),
            args=[ast.Constant(value=line), ast.Constant(value=_char_col(text, bcol)), node],
            keywords=[],
        )
        return ast.copy_location(wrapped, node)


def build_scaffold(code, tree):
    lines = code.splitlines()
    store = set()     # (line, col) of names being assigned
    defs = set()      # (line, col) of def/class names
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            store.add((node.lineno, _char_col(lines[node.lineno - 1], node.col_offset)))
        elif isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store) and getattr(node, "end_lineno", None):
            text = lines[node.end_lineno - 1]
            store.add((node.end_lineno, _char_col(text, node.end_col_offset - len(node.attr.encode("utf-8")))))
        elif isinstance(node, ast.arg):
            store.add((node.lineno, _char_col(lines[node.lineno - 1], node.col_offset)))

    # Tokens, per physical line.
    tokens = {}
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(code).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        toks = []
    significant = [t for t in toks if t.type not in (tokenize.NL, tokenize.NEWLINE, tokenize.INDENT,
                                                       tokenize.DEDENT, tokenize.ENDMARKER, tokenize.COMMENT)]
    nxt = {}
    for a, b in zip(significant, significant[1:]):
        nxt[id(a)] = b
    prev_sig = None
    chain = None
    after_def = False
    for t in toks:
        if t.type in (tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER):
            continue
        row = t.start[0]
        text = t.string
        if t.start[0] != t.end[0]:
            text = text.split("\n", 1)[0] + " …"
        entry = {"s": text, "c": t.start[1]}
        if t.type == tokenize.COMMENT:
            entry["k"] = "comment"
        elif t.type == tokenize.NAME and (keyword.iskeyword(t.string) or t.string in ("match", "case") and after_def is None):
            entry["k"] = "kw"
        elif t.type == tokenize.NAME:
            entry["k"] = "name"
            is_attr = prev_sig is not None and prev_sig.string == "."
            chain = (chain + "." + t.string) if (is_attr and chain) else t.string
            entry["chain"] = chain
            if is_attr:
                entry["attr"] = True
            if (row, t.start[1]) in store:
                entry["store"] = True
            n = nxt.get(id(t))
            if n is not None and n.string == "(":
                entry["call"] = True
            if after_def:
                entry["def"] = True
        elif t.type == tokenize.NUMBER:
            entry["k"] = "num"
        elif t.type == tokenize.STRING or (hasattr(tokenize, "FSTRING_START") and t.type in (
                tokenize.FSTRING_START, tokenize.FSTRING_MIDDLE, tokenize.FSTRING_END)):
            entry["k"] = "str"
        else:
            entry["k"] = "op"
        if t.type != tokenize.COMMENT:
            if t.type != tokenize.NAME and t.string != ".":
                chain = None
            after_def = t.type == tokenize.NAME and t.string in ("def", "class")
            prev_sig = t
        tokens.setdefault(row, []).append(entry)

    def is_code_line(n):
        if not (0 < n <= len(lines)):
            return False
        st = lines[n - 1].strip()
        return bool(st) and not st.startswith("#")

    def first_line(node):
        decos = getattr(node, "decorator_list", None) or []
        return min([node.lineno] + [d.lineno for d in decos])

    def block(node, qual):
        start = first_line(node)
        end = getattr(node, "end_lineno", node.lineno) or node.lineno
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            kind = "def"
        elif isinstance(node, ast.ClassDef):
            kind = "class"
        elif any(isinstance(getattr(node, f, None), list) and getattr(node, f) and isinstance(getattr(node, f)[0], (ast.stmt, ast.excepthandler))
                 for f in ("body", "orelse", "handlers", "finalbody")) or type(node).__name__ == "Match":
            kind = type(node).__name__.lower().replace("async", "")
        else:
            return {"k": "stmt", "l": start, "e": end}

        inner_qual = qual
        info = {"k": kind, "l": start, "e": end, "line": node.lineno}
        if kind == "def":
            inner_qual = (qual + "." if qual else "") + node.name
            info["name"] = node.name
            info["qual"] = inner_qual
            a = node.args
            params = [x.arg for x in getattr(a, "posonlyargs", [])] + [x.arg for x in a.args]
            if a.vararg:
                params.append("*" + a.vararg.arg)
            params += [x.arg for x in a.kwonlyargs]
            if a.kwarg:
                params.append("**" + a.kwarg.arg)
            info["args"] = params
        elif kind == "class":
            inner_qual = (qual + "." if qual else "") + node.name
            info["name"] = node.name
            info["qual"] = inner_qual
            info["bases"] = [ast.get_source_segment(code, b) or "?" for b in node.bases]

        children = []
        for field in ("body", "orelse", "handlers", "finalbody"):
            for child in getattr(node, field, None) or []:
                if isinstance(child, ast.excepthandler):
                    clause = {"k": "except", "l": child.lineno, "e": child.end_lineno, "line": child.lineno,
                              "items": []}
                    sub = [block(c, inner_qual) for c in child.body]
                    clause["items"] = _with_headers(clause, sub, is_code_line)
                    children.append(clause)
                else:
                    children.append(block(child, inner_qual))
        for case in getattr(node, "cases", None) or []:
            ln = case.pattern.lineno
            clause = {"k": "case", "l": ln, "e": case.body[-1].end_lineno, "line": ln, "items": []}
            clause["items"] = _with_headers(clause, [block(c, inner_qual) for c in case.body], is_code_line)
            children.append(clause)

        # Fold "elif" chains into the parent "if" so they render side by side.
        flat = []
        for ch in children:
            if (kind == "if" and ch["k"] == "if" and 0 < ch["l"] <= len(lines)
                    and lines[ch["l"] - 1].lstrip().startswith("elif")):
                flat.extend(ch["items"])
            else:
                flat.append(ch)
        info["items"] = _with_headers(info, flat, is_code_line)
        return info

    module = {"k": "module", "l": 1, "e": len(lines), "items": [block(n, "") for n in tree.body]}
    return {"lines": {str(k): v for k, v in tokens.items()}, "blocks": module}


def _with_headers(info, children, is_code_line):
    """Lines of a compound statement not covered by a child (``if ...:``,
    ``else:``, ``finally:``, decorators) become header rows."""
    covered = set()
    for ch in children:
        covered.update(range(ch["l"], ch["e"] + 1))
    items = list(children)
    for n in range(info["l"], info["e"] + 1):
        if n not in covered and is_code_line(n):
            items.append({"k": "hdr", "l": n, "e": n})
    items.sort(key=lambda x: (x["l"], 0 if x["k"] == "hdr" else 1))
    return items


class Tracer:
    def __init__(self, code, stdin_text, max_steps, time_limit):
        self.code = code
        self.lines = code.splitlines()
        self.stdin_text = stdin_text
        self.max_steps = max_steps
        self.time_limit = time_limit
        self.steps = []
        self.snap = Snapshotter()
        self.console = {"parts": [], "size": 0, "truncated": False}
        self.frame_ids = {}       # id(frame) -> frame number
        self.frame_counter = 0
        self.prev_sigs = {}       # frame number -> {var: signature}
        self.raising = set()      # frame numbers with an exception in flight
        self.line_step = {}       # frame number -> index of its current "line" step
        self.start = 0.0
        self.limit_hit = None
        self.sleep_capped = False

    # -- helpers -------------------------------------------------------
    def frame_id(self, frame, fresh=False):
        # A frame's id() can be reused after it finishes, so every "call"
        # event hands out a brand-new number.
        key = id(frame)
        fid = self.frame_ids.get(key)
        if fid is None or fresh:
            self.frame_counter += 1
            fid = self.frame_counter
            self.frame_ids[key] = fid
        return fid

    def user_frames(self, frame):
        frames = []
        f = frame
        while f is not None:
            if f.f_code.co_filename == USER_FILE:
                frames.append(f)
            f = f.f_back
        frames.reverse()
        return frames

    def frame_locals(self, f):
        try:
            items = list(f.f_locals.items())
        except Exception:
            return []
        out = []
        is_module = f.f_code.co_name == "<module>"
        is_class = self.frame_kind(f) == "class"
        for name, val in items:
            if is_module and name in HIDDEN_GLOBALS:
                continue
            if is_class and name.startswith("__") and name.endswith("__") and not isinstance(val, types.FunctionType):
                continue
            if name.startswith(".") or name == "__return__":
                continue
            if f.f_code.co_name in ("<listcomp>", "<dictcomp>", "<setcomp>", "<genexpr>") and name.startswith("."):
                continue
            out.append((name, val))
        return out

    @staticmethod
    def frame_kind(f):
        name = f.f_code.co_name
        if name == "<module>":
            return "module"
        if name in ("<listcomp>", "<dictcomp>", "<setcomp>", "<genexpr>"):
            return "comprehension"
        if not (f.f_code.co_flags & inspect.CO_NEWLOCALS) and "__qualname__" in f.f_locals:
            return "class"
        return "function"

    @staticmethod
    def signature(ref, heap_map):
        if "ref" in ref:
            return ("r", ref["ref"], heap_map.get(ref["ref"]))
        return ("v", ref.get("t"), ref.get("v"))

    def record(self, frame, event, arg):
        heap = {}
        stack = []
        if event == "call":
            self.frame_id(frame, fresh=True)
        frames = self.user_frames(frame)
        for f in frames:
            variables = []
            for name, val in self.frame_locals(f):
                variables.append([name, self.snap.value(val, heap, 0)])
            stack.append({
                "id": self.frame_id(f),
                "name": _frame_name(f.f_code),
                "kind": self.frame_kind(f),
                "line": f.f_lineno,
                "vars": variables,
            })

        heap_map = {}
        for oid, obj in heap.items():
            if obj is not None:
                heap_map[oid] = self.snap.intern(obj)

        # What changed in the active frame since its previous step?
        changes = []
        if stack:
            top = stack[-1]
            prev = self.prev_sigs.get(top["id"])
            sigs = {}
            for name, ref in top["vars"]:
                sig = self.signature(ref, heap_map)
                sigs[name] = sig
                if prev is None:
                    if event != "call":
                        changes.append([name, "new"])
                elif name not in prev:
                    changes.append([name, "new"])
                elif prev[name] != sig:
                    changes.append([name, "changed"])
            if prev:
                for name in prev:
                    if name not in sigs:
                        changes.append([name, "deleted"])
            self.prev_sigs[top["id"]] = sigs
            # Mutations of objects shared with outer frames (e.g. a list
            # passed into a function) are shown on those frames too.
            for outer in stack[:-1]:
                p = self.prev_sigs.get(outer["id"])
                s = {n: self.signature(r, heap_map) for n, r in outer["vars"]}
                if p is not None:
                    for n, sig in s.items():
                        if p.get(n) != sig:
                            changes.append([n, "changed", outer["id"]])
                self.prev_sigs[outer["id"]] = s

        step = {
            "line": frame.f_lineno,
            "event": event,
            "stack": stack,
            "heap": heap_map,
            "out": self.console["size"],
            "changes": changes,
        }
        fid = stack[-1]["id"] if stack else None
        if event == "exception":
            self.raising.add(fid)
        elif event == "line":
            self.raising.discard(fid)
        if event == "return" and fid in self.raising:
            # The function is being exited because of an uncaught exception.
            self.raising.discard(fid)
            step["unwinding"] = True
        elif event == "return" and stack and stack[-1]["kind"] == "function":
            ret_heap = {}
            ref = self.snap.value(arg, ret_heap, 0)
            for oid, obj in ret_heap.items():
                if obj is not None and oid not in heap_map:
                    heap_map[oid] = self.snap.intern(obj)
            step["ret"] = ref
        elif event == "exception":
            exc_type, exc_value = arg[0], arg[1]
            step["exc"] = {"type": exc_type.__name__, "msg": _short(str(exc_value), 400)}
        if event == "line" and fid is not None:
            self.line_step[fid] = len(self.steps)
        if event == "return" and stack:
            self.prev_sigs.pop(stack[-1]["id"], None)
            self.line_step.pop(stack[-1]["id"], None)
            self.frame_ids.pop(id(frame), None)
        self.steps.append(step)

    def on_call_result(self, line, col, value):
        """Attach the value of a call to the step of the line that made it."""
        if self.limit_hit:
            return
        try:
            caller = sys._getframe(2)
        except ValueError:
            return
        fid = self.frame_ids.get(id(caller))
        idx = self.line_step.get(fid)
        if idx is None:
            return
        if value is None or isinstance(value, bool):
            desc = [repr(value), type(value).__name__]
        elif type(value) in (int, float, complex, str):
            desc = [_short(repr(value), 60), type(value).__name__]
        else:
            desc = [_short(_safe_repr(value), 60), _type_name(value)]
        calls = self.steps[idx].setdefault("calls", [])
        if len(calls) < 50:
            calls.append([line, col] + desc)

    # -- the trace function -------------------------------------------
    def trace(self, frame, event, arg):
        if frame.f_code.co_filename != USER_FILE:
            # Don't trace inside library code; user callbacks invoked by
            # libraries still get their own "call" event.
            return None
        if self.limit_hit:
            return None
        if event == "call":
            if frame.f_code.co_name == "<module>":
                self.frame_id(frame, fresh=True)
                return self.trace
        elif event not in ("line", "return", "exception"):
            return self.trace
        if len(self.steps) >= self.max_steps:
            # Stop recording but let the program finish (untraced, so it is
            # fast) so the user still gets the complete output.
            self.limit_hit = "steps"
            sys.settrace(None)
            f = frame
            while f is not None:
                f.f_trace = None
                f = f.f_back
            return None
        self.record(frame, event, arg)
        return self.trace

    # -- running -------------------------------------------------------
    def run(self):
        result = {
            "version": FORMAT_VERSION,
            "python": "%d.%d.%d" % sys.version_info[:3],
            "steps": self.steps,
            "objects": self.snap.pool,
            "error": None,
            "limit": None,
            "exit_code": None,
        }

        try:
            tree = ast.parse(self.code, USER_FILE)
            try:
                result["scaffold"] = build_scaffold(self.code, tree)
            except Exception:
                result["scaffold"] = None
            recorded = CallRecorder(self.lines).visit(ast.parse(self.code, USER_FILE))
            ast.fix_missing_locations(recorded)
            compiled = compile(recorded, USER_FILE, "exec")
        except SyntaxError as exc:
            result["error"] = {
                "type": type(exc).__name__,
                "msg": exc.msg,
                "line": exc.lineno,
                "col": exc.offset,
                "end_line": getattr(exc, "end_lineno", None),
                "end_col": getattr(exc, "end_offset", None),
                "traceback": "".join(traceback.format_exception_only(type(exc), exc)),
                "phase": "compile",
            }
            result["stdout"] = ""
            return result
        except (ValueError, OverflowError, RecursionError, MemoryError) as exc:
            result["error"] = {"type": type(exc).__name__, "msg": str(exc), "line": None,
                               "traceback": str(exc), "phase": "compile"}
            result["stdout"] = ""
            return result

        # Make tracebacks able to show the user's source lines.
        linecache.cache[USER_FILE] = (len(self.code), None, [l + "\n" for l in self.lines], USER_FILE)

        main_mod = types.ModuleType("__main__")
        main_mod.__file__ = USER_FILE
        main_mod.__builtins__ = builtins
        globs = main_mod.__dict__

        console = Console(self.console)
        real = (sys.stdout, sys.stderr, sys.stdin, sys.argv, builtins.input, sys.modules.get("__main__"))
        stdin = io.StringIO(self.stdin_text)
        real_input = builtins.input

        def traced_input(prompt=""):
            console.write(str(prompt))
            line = stdin.readline()
            if line == "":
                raise EOFError(
                    "input() was called but no input is left. "
                    "Type the values your program needs into the 'Program input' box (one per line).")
            value = line[:-1] if line.endswith("\n") else line
            console.write(value + "\n")
            return value

        # time.sleep would only make you wait; keep it short while tracing.
        real_sleep = time.sleep

        def short_sleep(seconds):
            if seconds > 0.02:
                self.sleep_capped = True
            real_sleep(min(max(seconds, 0), 0.02))

        sys.stdout = console
        sys.stderr = console
        sys.stdin = stdin
        sys.argv = ["main.py"]
        builtins.input = traced_input
        tracer_self = self

        def pvx_call(line, col, value):
            tracer_self.on_call_result(line, col, value)
            return value

        builtins.__pvx_call__ = pvx_call
        time.sleep = short_sleep
        sys.modules["__main__"] = main_mod

        old_limit = sys.getrecursionlimit()
        sys.setrecursionlimit(max(old_limit, 1500))
        self.start = time.perf_counter()
        # Watchdog: interrupt programs that run longer than the time limit
        # (e.g. infinite loops).
        import _thread
        import threading
        timed_out = []

        def on_timeout():
            timed_out.append(True)
            _thread.interrupt_main()

        watchdog = threading.Timer(self.time_limit, on_timeout)
        watchdog.daemon = True
        watchdog.start()
        try:
            sys.settrace(self.trace)
            try:
                exec(compiled, globs)
            finally:
                sys.settrace(None)
        except SystemExit as exc:
            code = exc.code
            result["exit_code"] = code if isinstance(code, int) or code is None else str(code)
            if code not in (None, 0) and not isinstance(code, int):
                console.write(str(code) + "\n")
        except KeyboardInterrupt:
            result["limit"] = "time" if timed_out else "interrupt"
        except BaseException as exc:  # the user's program crashed
            tb = exc.__traceback__
            line = None
            for fs in traceback.extract_tb(tb):
                if fs.filename == USER_FILE:
                    line = fs.lineno
            # Hide tracer frames from the traceback shown to the user.
            while tb is not None and tb.tb_frame.f_code.co_filename != USER_FILE:
                tb = tb.tb_next
            text = "".join(traceback.format_exception(type(exc), exc, tb))
            if isinstance(exc, SyntaxError) and line is None:
                line = exc.lineno
            result["error"] = {
                "type": type(exc).__name__,
                "msg": _short(str(exc), 1000),
                "line": line,
                "traceback": text,
                "phase": "run",
            }
        finally:
            watchdog.cancel()
            sys.settrace(None)
            sys.setrecursionlimit(old_limit)
            sys.stdout, sys.stderr, sys.stdin, sys.argv, builtins.input = real[:5]
            time.sleep = real_sleep
            if real[5] is not None:
                sys.modules["__main__"] = real[5]
            builtins.input = real_input
            try:
                del builtins.__pvx_call__
            except AttributeError:
                pass

        if self.limit_hit == "steps":
            result["step_limit_hit"] = True

        result["stdout"] = "".join(self.console["parts"])
        result["stdout_truncated"] = self.console["truncated"]
        result["sleep_capped"] = self.sleep_capped
        result["elapsed_ms"] = int((time.perf_counter() - self.start) * 1000)
        return result


# ----------------------------------------------------------------------
# Introspection (powers editor autocomplete for every stdlib module)
# ----------------------------------------------------------------------

def list_modules():
    names = set(getattr(sys, "stdlib_module_names", ()))
    if not names:
        import pkgutil
        names = set(sys.builtin_module_names)
        for m in pkgutil.iter_modules():
            names.add(m.name)
    return sorted(n for n in names if not n.startswith("_") and n not in ("antigravity", "this"))


def describe_members(target):
    import importlib

    obj = None
    if target.startswith("builtins."):
        obj = getattr(builtins, target.split(".", 1)[1], None)
    else:
        try:
            obj = importlib.import_module(target)
        except Exception:
            # maybe "package.attr"
            mod_name, _, attr = target.rpartition(".")
            if mod_name:
                try:
                    obj = getattr(importlib.import_module(mod_name), attr)
                except Exception:
                    obj = None
    if obj is None:
        return {"target": target, "members": [], "found": False}

    members = []
    for name in dir(obj):
        if name.startswith("_"):
            continue
        try:
            val = getattr(obj, name)
        except Exception:
            continue
        if isinstance(val, types.ModuleType):
            kind = "module"
        elif inspect.isclass(val):
            kind = "class"
        elif callable(val):
            kind = "function"
        else:
            kind = "constant"
        entry = {"name": name, "kind": kind, "doc": _first_doc_line(val) if kind != "constant" else _short(_safe_repr(val), 80)}
        if kind in ("function", "class"):
            entry["sig"] = _signature(val)
        members.append(entry)
    return {"target": target, "members": members, "found": True, "doc": _first_doc_line(obj)}


def main(argv):
    if len(argv) >= 2 and argv[1] == "version":
        print("%d.%d.%d" % sys.version_info[:3])
        return 0
    if len(argv) < 4:
        print(__doc__)
        return 2
    mode, req_path, out_path = argv[1], argv[2], argv[3]
    with open(req_path, "r", encoding="utf-8") as fh:
        request = json.load(fh)

    if mode == "run":
        tracer = Tracer(
            request.get("code", ""),
            request.get("stdin", ""),
            int(request.get("max_steps", 2000)),
            float(request.get("time_limit", 10)),
        )
        result = tracer.run()
    elif mode == "introspect":
        if request.get("modules"):
            result = {"modules": list_modules()}
        else:
            result = describe_members(request.get("target", "builtins"))
    else:
        print("unknown mode: " + mode)
        return 2

    tmp = out_path + ".part"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, separators=(",", ":"), default=str)
    os.replace(tmp, out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
