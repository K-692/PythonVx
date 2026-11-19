"""Smoke tests for tracer.py.  Run:  python test_tracer.py"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TRACER = os.path.join(HERE, "tracer.py")


def trace(code, stdin="", max_steps=2000, time_limit=10):
    with tempfile.TemporaryDirectory() as tmp:
        req = os.path.join(tmp, "req.json")
        out = os.path.join(tmp, "out.json")
        with open(req, "w", encoding="utf-8") as fh:
            json.dump({"code": code, "stdin": stdin, "max_steps": max_steps, "time_limit": time_limit}, fh)
        proc = subprocess.run([sys.executable, "-X", "utf8", TRACER, "run", req, out],
                              capture_output=True, text=True, cwd=tmp, timeout=time_limit + 20)
        assert proc.returncode == 0, proc.stderr
        with open(out, encoding="utf-8") as fh:
            return json.load(fh)


def introspect(request):
    with tempfile.TemporaryDirectory() as tmp:
        req = os.path.join(tmp, "req.json")
        out = os.path.join(tmp, "out.json")
        with open(req, "w") as fh:
            json.dump(request, fh)
        subprocess.run([sys.executable, TRACER, "introspect", req, out], check=True, timeout=60)
        with open(out, encoding="utf-8") as fh:
            return json.load(fh)


def var(step, name, frame=-1):
    for n, v in step["stack"][frame]["vars"]:
        if n == name:
            return v
    raise KeyError(name)


CASES = []


def case(fn):
    CASES.append(fn)
    return fn


@case
def basics():
    r = trace("x = 5\nx += 1\nnums = [1]\nnums.append(x)\nprint(x, nums)\n")
    assert r["error"] is None
    assert r["stdout"] == "6 [1, 6]\n"
    last = r["steps"][-1]
    assert var(last, "x")["v"] == "6"
    obj = r["objects"][last["heap"][str(var(last, "nums")["ref"])]]
    assert obj["k"] == "list" and obj["len"] == 2


@case
def functions_and_return():
    r = trace("def add(a, b):\n    return a + b\ny = add(2, 3)\n")
    events = [s["event"] for s in r["steps"]]
    assert "call" in events and "return" in events
    ret = [s for s in r["steps"] if s["event"] == "return" and "ret" in s][0]
    assert ret["ret"]["v"] == "5"


@case
def recursion_frames():
    r = trace("def f(n):\n    return 1 if n < 2 else n * f(n - 1)\nf(4)\n")
    assert max(len(s["stack"]) for s in r["steps"]) == 5


@case
def classes():
    r = trace("class A:\n    def __init__(self):\n        self.v = [1]\na = A()\n")
    last = r["steps"][-1]
    inst = r["objects"][last["heap"][str(var(last, "a")["ref"])]]
    assert inst["k"] == "instance" and inst["attrs"][0][0] == "v"


@case
def stdlib_modules():
    code = (
        "import math, random, datetime, collections, json, itertools, re, statistics, decimal, fractions\n"
        "import heapq, bisect, functools, string, textwrap, pathlib, enum, dataclasses, uuid, hashlib, time\n"
        "c = collections.Counter('hello')\n"
        "d = datetime.date(2024, 1, 2)\n"
        "q = collections.deque([1, 2])\n"
        "P = collections.namedtuple('P', 'x y')\n"
        "p = P(1, 2)\n"
        "print(math.sqrt(16), c['l'], d.year, list(q), p.x, json.dumps([1]), statistics.mean([1, 3]))\n"
    )
    r = trace(code)
    assert r["error"] is None, r["error"]
    assert r["stdout"] == "4.0 2 2024 [1, 2] 1 [1] 2\n"


@case
def input_from_box():
    r = trace("n = input('n? ')\nprint(int(n) * 2)\n", stdin="21\n")
    assert r["stdout"] == "n? 21\n42\n"


@case
def missing_input():
    r = trace("x = input()\n")
    assert r["error"]["type"] == "EOFError"


@case
def runtime_error():
    r = trace("a = 1\nb = 0\nc = a / b\n")
    assert r["error"]["type"] == "ZeroDivisionError" and r["error"]["line"] == 3
    assert "tracer.py" not in r["error"]["traceback"]


@case
def syntax_error():
    r = trace("x = (1,\n")
    assert r["error"]["type"] == "SyntaxError" and r["steps"] == []


@case
def step_limit_keeps_full_output():
    r = trace("t = 0\nfor i in range(10000):\n    t += i\nprint(t)\n", max_steps=100)
    assert len(r["steps"]) == 100 and r["step_limit_hit"]
    assert r["stdout"] == "49995000\n"


@case
def infinite_loop_is_stopped():
    r = trace("while True:\n    pass\n", time_limit=2)
    assert r["limit"] == "time"


@case
def sys_exit():
    r = trace("import sys\nprint('a')\nsys.exit(2)\n")
    assert r["exit_code"] == 2 and r["error"] is None


@case
def cycles_and_unicode():
    r = trace("a = [1]\na.append(a)\ns = 'héllo 🐍'\nprint(s)\n")
    assert r["stdout"] == "héllo 🐍\n"


@case
def introspection():
    mods = introspect({"modules": True})["modules"]
    assert "math" in mods and "collections" in mods
    members = {m["name"] for m in introspect({"target": "math"})["members"]}
    assert "sqrt" in members
    members = {m["name"] for m in introspect({"target": "builtins.list"})["members"]}
    assert "append" in members


if __name__ == "__main__":
    failed = 0
    for fn in CASES:
        try:
            fn()
            print("ok   ", fn.__name__)
        except Exception as exc:  # noqa
            failed += 1
            print("FAIL ", fn.__name__, "-", repr(exc))
    print("%d passed, %d failed (Python %s)" % (len(CASES) - failed, failed, sys.version.split()[0]))
    sys.exit(1 if failed else 0)
