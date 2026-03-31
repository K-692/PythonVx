use std::process::Command;
use std::io::Write;
use std::env;
use std::fs;

// The python tracer logic embedded directly to avoid shipping sidecar files for now 
// depending on virtual environments.
const TRACER_SCRIPT: &str = r#"
import sys
import json
import traceback
import io
import ast
import tokenize
import builtins

class DecomposeAugAssign(ast.NodeTransformer):
    pass # Replaced by tokenizer approach below

class MethodChainRecorder(ast.NodeTransformer):
    def visit_Call(self, node):
        self.generic_visit(node)
        if hasattr(node, "func") and isinstance(node.func, ast.Attribute):
            if hasattr(node.func, 'end_col_offset') and hasattr(node, 'lineno'):
                new_node = ast.Call(
                    func=ast.Name(id='__record_chain', ctx=ast.Load()),
                    args=[
                        ast.Constant(value=node.lineno),
                        ast.Constant(value=node.func.end_col_offset),
                        ast.Constant(value=node.func.attr),
                        node
                    ],
                    keywords=[]
                )
                return ast.copy_location(new_node, node)
        return node

class ScaffoldBuilder:
    def __init__(self, code):
        self.code = code
        self.lines = {}
        self.functions = []
        self.classes = []
        self.assignments = []

    def build(self):
        try:
            tree = ast.parse(self.code)
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    self.functions.append({
                        "name": node.name,
                        "args": [arg.arg for arg in node.args.args],
                        "startLine": node.lineno,
                        "endLine": getattr(node, "end_lineno", node.lineno)
                    })
                elif isinstance(node, ast.ClassDef):
                    self.classes.append({
                        "name": node.name,
                        "bases": [b.id for b in node.bases if getattr(b, "id", None)],
                        "startLine": node.lineno,
                        "endLine": getattr(node, "end_lineno", node.lineno)
                    })
                elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                    self.assignments.append({
                        "startLine": node.lineno,
                        "endLine": getattr(node, "end_lineno", node.lineno)
                    })
        except SyntaxError:
            pass

        tokens = tokenize.generate_tokens(io.StringIO(self.code).readline)
        
        for tok in tokens:
            if tok.type == tokenize.ENDMARKER:
                continue
            
            line_no = tok.start[0]
            if line_no not in self.lines:
                text = tok.line.rstrip('\n')
                indent_cols = len(text) - len(text.lstrip())
                self.lines[line_no] = {
                    "line": line_no,
                    "text": text,
                    "tokens": [],
                    "indentCols": indent_cols
                }
                
            if tok.type in (tokenize.NEWLINE, tokenize.NL, tokenize.INDENT, tokenize.DEDENT):
                continue
                
            is_var = tok.type == tokenize.NAME and tok.string not in ["def", "class", "return", "if", "for", "while", "in", "and", "or", "not", "is", "elif", "else", "import", "from", "as", "True", "False", "None"]
            
            self.lines[line_no]["tokens"].append({
                "type": "variable" if is_var else "syntax",
                "value": tok.string,
                "startCol": tok.start[1],
                "endCol": tok.end[1]
            })
            
        return {
            "classes": self.classes,
            "functions": self.functions,
            "assignments": self.assignments,
            "lines": [self.lines[k] for k in sorted(self.lines.keys())]
        }

class PythonVisualizerTracer:
    def __init__(self, code):
        self.code_lines = code.splitlines()
        self.code = code
        self.timeline = []
        self.step_count = 0
        self.stdout_tracker = None

    def set_stdout_tracker(self, tracker):
        self.stdout_tracker = tracker

    def serialize_value(self, val):
        if isinstance(val, (int, float, str, bool, type(None))):
            return repr(val)
        elif isinstance(val, list):
            return f"[{', '.join(self.serialize_value(x) for x in val)}]"
        elif isinstance(val, dict):
            return f"{{{', '.join(f'{self.serialize_value(k)}: {self.serialize_value(v)}' for k, v in val.items())}}}"
        elif callable(val):
            # Check if it's a built-in function to provide better UI hints
            is_builtin = getattr(val, "__module__", None) == "builtins"
            name = getattr(val, "__name__", "anon")
            return f"<{'built-in ' if is_builtin else ''}function {name}>"
        elif type(val).__name__ == 'module':
            return f"<module '{getattr(val, '__name__', 'unknown')}'>"
        else:
            return repr(val)

    def serialize_scope(self, frame_locals):
        scope = {}
        for k, v in frame_locals.items():
            if k.startswith('__') or k in ['sys', 'json', 'traceback', 'io', 'ast', 'tokenize', 'builtins', 'PythonVisualizerTracer', 'ScaffoldBuilder']:
                continue
            try:
                scope[k] = self.serialize_value(v)
            except Exception:
                scope[k] = "<unserializable>"
        return scope

    def trace_dispatch(self, frame, event, arg):
        if frame.f_code.co_filename != "<string>":
            return self.trace_dispatch
            
        if event in ("line", "return", "exception"):
            lineno = frame.f_lineno
            if 0 < lineno <= len(self.code_lines):
                code_line = self.code_lines[lineno - 1].strip()
            else:
                code_line = ""
                
            stack = []
            f = frame
            while f is not None:
                if f.f_code.co_filename == "<string>":
                    name = f.f_code.co_name
                    if name == "<module>":
                        name = "Global Scope"
                    scope_vars = self.serialize_scope(f.f_locals)
                    stack.insert(0, {
                        "name": name,
                        "scope": scope_vars
                    })
                f = f.f_back

            if self.timeline and hasattr(self, 'chain_buffer') and self.chain_buffer:
                if "chain_returns" not in self.timeline[-1]:
                    self.timeline[-1]["chain_returns"] = []
                self.timeline[-1]["chain_returns"].extend(self.chain_buffer)
                self.chain_buffer.clear()

            stdout_str = self.stdout_tracker.getvalue() if self.stdout_tracker else ""
            
            return_data = None
            if event == "return":
                return_data = {
                    "function": frame.f_code.co_name,
                    "value": self.serialize_value(arg)
                }

            self.step_count += 1
            self.timeline.append({
                "step": self.step_count,
                "line": lineno,
                "code": code_line,
                "stack": stack,
                "stdout": stdout_str,
                "event": event,
                "return_data": return_data,
                "chain_returns": []
            })
            
        return self.trace_dispatch

    def run(self):
        self.chain_buffer = []
        def __record_chain(line, col, method_name, val):
            self.chain_buffer.append({"line": line, "col": col, "method": method_name, "value": self.serialize_value(val)})
            return val

        global_ns = {"__name__": "__main__", "__builtins__": __builtins__, "__record_chain": __record_chain}
        # Use global_ns for both globals and locals to ensure module-level imports are shared correctly
        local_ns = global_ns
        
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        safe_stdout = io.StringIO()
        safe_stderr = io.StringIO()
        sys.stdout = safe_stdout
        sys.stderr = safe_stderr
        
        self.set_stdout_tracker(safe_stdout)
        
        try:
            tree = ast.parse(self.code)
            tree = MethodChainRecorder().visit(tree)
            ast.fix_missing_locations(tree)
            compiled_code = compile(tree, "<string>", "exec")
            
            sys.settrace(self.trace_dispatch)
            exec(compiled_code, global_ns, local_ns)
        except Exception as e:
            self.timeline.append({
                "step": self.step_count + 1,
                "line": -1,
                "code": "",
                "error": traceback.format_exc(),
                "stack": [],
                "stdout": safe_stdout.getvalue(),
                "event": "error"
            })
        finally:
            sys.settrace(None)
            sys.stdout = old_stdout
            sys.stderr = old_stderr
            
        return self.timeline

if __name__ == "__main__":
    with open(sys.argv[1], 'r') as f:
        source_code = f.read()
    
    # Pre-process: Decompose augmented assignments while perfectly preserving newlines
    try:
        import io, tokenize
        tokens = list(tokenize.generate_tokens(io.StringIO(source_code).readline))
        new_tokens = []
        for i, tok in enumerate(tokens):
            if tok.type == tokenize.OP and tok.string in ('+=', '-=', '*=', '/=', '//=', '%=', '**='):
                prev_name = None
                for j in range(i-1, -1, -1):
                    if tokens[j].type == tokenize.NAME:
                        prev_name = tokens[j].string
                        break
                
                op = tok.string[:-1] if tok.string not in ('//=', '**=') else tok.string[:-1]
                if tok.string == '//=': op = '//'
                if tok.string == '**=': op = '**'
                
                new_tokens.append((tokenize.OP, '='))
                if prev_name:
                    new_tokens.append((tokenize.NAME, prev_name))
                new_tokens.append((tokenize.OP, op))
            else:
                new_tokens.append((tok.type, tok.string))
        
        encoded_source = tokenize.untokenize(new_tokens)
        if isinstance(encoded_source, bytes):
            source_code = encoded_source.decode('utf-8')
        else:
            source_code = encoded_source
    except Exception:
        pass # Fallback to original

    # Generate static scaffold
    builder = ScaffoldBuilder(source_code)
    scaffold = builder.build()
    
    # Trace dynamic execution
    tracer = PythonVisualizerTracer(source_code)
    timeline = tracer.run()
    
    # Output unified timeline structure
    output = {
        "scaffold": scaffold,
        "timeline": timeline
    }
    sys.stdout.write(json.dumps(output, indent=2))
"#;

#[tauri::command]
async fn run_python(code: String) -> Result<String, String> {
    // 1. Write the code to a temporary file
    let temp_dir = env::temp_dir();
    let code_path = temp_dir.join("user_code.py");
    fs::write(&code_path, code).map_err(|e| e.to_string())?;

    // 2. Write the tracer script to a temporary file
    let script_path = temp_dir.join("tracer.py");
    fs::write(&script_path, TRACER_SCRIPT).map_err(|e| e.to_string())?;

    // 3. Execute python from the active virtualenv using standard standard path or plain `python`
    // Assuming `python` points to the active `venv` or `python3` natively.
    let python_cmd = if cfg!(target_os = "windows") { "python" } else { "python3" };

    let output = Command::new(python_cmd)
        .arg(&script_path)
        .arg(&code_path)
        .output()
        .map_err(|e| format!("Failed to execute python: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // It's possible the user's code threw a compilation error that didn't reach the tracer's try/catch
        return Err(format!("Python Execution Error:\n{}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![run_python])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
