# PythonVx

**See your Python code run, one step at a time.**

PythonVx is a desktop app for people who are learning Python — or who have never programmed before. Type (or pick) a program, press **Run**, and then walk through it line by line. For every step PythonVx shows:

- **which line just ran and which runs next**, right in the editor, with the new values written next to the code;
- **a plain-English explanation** of what happened (“Created `total` = 0”, “Calling `area(width = 3, height = 4)`”, “`nums` was modified → [1, 2, 3]”);
- **every variable**, grouped by function call (frames), with arrows to the **lists, dictionaries and objects** they point to;
- **the program's output** as it is printed, and a box to type answers for `input()`;
- **friendly error messages** that explain what an error means and how to fix it.

It works with the whole Python standard library — `math`, `random`, `datetime`, `collections`, `json`, `re`, `itertools`, `functools`, `statistics`, `dataclasses`, `pathlib`, `asyncio` and the rest — because it runs your code with the real Python installed on your computer. Editor autocomplete and hover help are generated from that interpreter too, so every built-in module is covered.

---

## Download

| System | Installer |
| :--- | :--- |
| **Windows 10/11** | [`PythonVx_x.y.z_x64-setup.exe` or `.msi`](https://github.com/K-692/PythonVx/releases/latest) |
| **macOS – Apple Silicon (M1–M4)** | [`PythonVx_x.y.z_aarch64.dmg`](https://github.com/K-692/PythonVx/releases/latest) |
| **macOS – Intel** | [`PythonVx_x.y.z_x64.dmg`](https://github.com/K-692/PythonVx/releases/latest) |
| **Linux** | [`.AppImage`, `.deb`, `.rpm`](https://github.com/K-692/PythonVx/releases/latest) |

All installers are on the [latest release page](https://github.com/K-692/PythonVx/releases/latest).

### Requirements

PythonVx needs **Python 3.8 or newer**. If you don't have it yet, install it from [python.org/downloads](https://www.python.org/downloads/) — on Windows, tick **“Add python.exe to PATH”** in the installer. PythonVx finds Python automatically (including Homebrew, pyenv, conda and the Windows `py` launcher). If it can't, open **Settings** (⚙) and paste the interpreter's full path.

### First launch on macOS

The app is not notarized by Apple. If macOS says *“PythonVx can't be opened”* or *“is damaged”*, either right-click the app in **Applications** and choose **Open**, or run:

```bash
xattr -cr /Applications/PythonVx.app
```

### First launch on Windows

If SmartScreen shows *“Windows protected your PC”*, click **More info → Run anyway**.

---

## How to use it

1. **Write code** in the editor on the left, or choose one of the **Examples** (variables, loops, functions, recursion, lists, dictionaries, classes, errors, and standard-library tours).
2. Press **Run** (or **Ctrl/⌘ + Enter**). With **Auto-run** on, PythonVx re-runs a moment after you stop typing.
3. **Step through** with the arrow buttons, the ← / → keys, or drag the timeline. Press **Space** (or ▶) to play it like a movie; pick a speed from 0.25× to 8×.
4. Read the explanation card at the top right, watch the variables and objects change (changed values flash yellow), and follow the output at the bottom.
5. If your program uses `input()`, type the answers into **Program input** — one line per `input()` call.

| What you see | Meaning |
| --- | --- |
| Yellow arrow / highlight in the editor | The line Python will run **next** |
| Green highlight | The line that **just ran** |
| `◂ x = 5` after a line | Values that line created or changed |
| Purple dot with an arrow | A variable that **refers to** an object (two names can point to the same list!) |
| Red marker on the timeline | Where the error happened — click it to jump there |

### Settings

- **Python interpreter** – auto-detect, or a specific path (with a *Test* button).
- **Maximum steps** (default 2000) – long programs are still run to completion so the output is complete, but only the first N steps are recorded.
- **Time limit** (default 10 s) – stops programs that never finish (e.g. `while True:` loops).
- Editor font size, inline values, auto-run.

Files your programs create with relative paths (e.g. `open("notes.txt", "w")`) are saved in a scratch folder that you can open from Settings. `time.sleep()` calls are shortened while tracing so you don't have to wait.

---

## How it works

```
┌──────────────── PythonVx desktop app (Tauri) ────────────────┐
│  React + Monaco UI  ──invoke──▶  Rust backend                 │
│        ▲                           │ finds Python, starts it   │
│        │ JSON trace                ▼ with a timeout            │
│        └──────────────  python tracer.py run req.json out.json │
└───────────────────────────────────────────────────────────────┘
```

1. **The tracer** ([`python-visualizer/src-tauri/python/tracer.py`](python-visualizer/src-tauri/python/tracer.py), standard library only) compiles your code and runs it under `sys.settrace`. At every line, call, return and exception it records the call stack, every local variable, and a snapshot of every reachable object (lists, dicts, sets, tuples, named tuples, instances of your classes; anything else — `datetime`, `Decimal`, `Path`, … — is shown by its `repr`). Identical object snapshots are stored once, so traces stay small. Output, `input()`, `sys.exit()`, uncaught exceptions, step and time limits are all handled, and the trace is written to a file so your `print`s can never corrupt it.
2. **The Rust backend** ([`src-tauri/src/lib.rs`](python-visualizer/src-tauri/src/lib.rs)) locates a Python ≥ 3.8 interpreter, runs the tracer in a private temporary folder (no console window on Windows), enforces a hard timeout, and returns the JSON. It also answers autocomplete questions (“what's inside `collections`?”) by asking the same interpreter.
3. **The UI** ([`src/`](python-visualizer/src)) — React, Zustand, a locally bundled Monaco editor (works offline) and Framer Motion — turns the trace into the editor highlights, explanations, frames, objects and arrows.

---

## Building from source

Prerequisites: **Node.js 18+**, **Rust** (stable, via [rustup](https://rustup.rs)), **Python 3.8+**, and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/K-692/PythonVx.git
cd PythonVx/python-visualizer
npm install
npm run tauri dev        # run the app in development mode
```

Build the installers for your current platform:

```bash
npm run tauri build      # output: src-tauri/target/release/bundle/
```

Run the tracer's tests:

```bash
python src-tauri/python/test_tracer.py
```

### Releasing

Pushing a version tag builds Windows, macOS (Apple Silicon and Intel) and Linux installers on GitHub Actions and publishes them as a release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The version number lives in `python-visualizer/package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.

---

## Project layout

```
python-visualizer/
├── src/                      React UI
│   ├── components/           Toolbar, CodeEditor, Visualizer, Console, Settings, StatusBar
│   ├── lib/                  runner (backend calls), explain (plain-English steps),
│   │                         completions (autocomplete/hover), monacoSetup
│   ├── examples.ts           built-in example programs
│   └── store.ts              app state
└── src-tauri/
    ├── python/tracer.py      the execution tracer (embedded into the app at build time)
    ├── python/test_tracer.py tracer tests
    └── src/lib.rs            Python discovery, process control, commands
```

## Limitations

- Only the main thread is traced (code in other threads runs normally but isn't stepped through).
- Code inside library modules isn't stepped into — you see the call and its result.
- GUI toolkits (`tkinter`, `turtle`) and programs that wait for a network or a keyboard won't behave like they do in a terminal.
- Your code runs with your user's permissions, just like running `python` yourself — only run code you trust.

## Contributing

Bug reports and pull requests are welcome — open an issue for anything that looks wrong or confusing, especially explanations that could be clearer for beginners.

## License

[MIT](LICENSE)
