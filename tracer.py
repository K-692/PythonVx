import sys
import json
import traceback
import copy

class PythonVisualizerTracer:
    def __init__(self, code):
        self.code_lines = code.splitlines()
        self.code = code
        self.timeline = []
        self.step_count = 0
        self.previous_scope = {}

    def serialize_value(self, val):
        if isinstance(val, (int, float, str, bool, type(None))):
            return repr(val)
        elif isinstance(val, list):
            return f"[{', '.join(self.serialize_value(x) for x in val)}]"
        elif isinstance(val, dict):
            return f"{{{', '.join(f'{self.serialize_value(k)}: {self.serialize_value(v)}' for k, v in val.items())}}}"
        else:
            return repr(val)

    def serialize_scope(self, frame_locals):
        scope = {}
        for k, v in frame_locals.items():
            if k.startswith('__') or k in ['sys', 'json', 'traceback', 'copy']:
                continue
            try:
                scope[k] = self.serialize_value(v)
            except Exception:
                scope[k] = "<unserializable>"
        return scope

    def trace_dispatch(self, frame, event, arg):
        # We only want to trace user code, not system modules
        if frame.f_code.co_filename != "<string>":
            return self.trace_dispatch
            
        if event in ("line", "return", "exception"):
            lineno = frame.f_lineno
            if 0 < lineno <= len(self.code_lines):
                code_line = self.code_lines[lineno - 1].strip()
            else:
                code_line = ""
                
            current_scope = self.serialize_scope(frame.f_locals)
            
            # compute changes
            changes = {}
            for k, v in current_scope.items():
                if k not in self.previous_scope or self.previous_scope[k] != v:
                    changes[k] = v
                    
            if event == "line" or changes:
                self.step_count += 1
                self.timeline.append({
                    "step": self.step_count,
                    "line": lineno,
                    "code": code_line,
                    "changes": changes,
                    "scope": current_scope,
                    "event": event
                })
            
            self.previous_scope = copy.deepcopy(current_scope)
            
        return self.trace_dispatch

    def run(self):
        # Prepare the global namespace
        global_ns = {"__name__": "__main__", "__builtins__": __builtins__}
        local_ns = {}
        
        try:
            compiled_code = compile(self.code, "<string>", "exec")
            sys.settrace(self.trace_dispatch)
            exec(compiled_code, global_ns, local_ns)
        except Exception as e:
            self.timeline.append({
                "step": self.step_count + 1,
                "line": -1,
                "code": "",
                "error": traceback.format_exc(),
                "event": "error"
            })
        finally:
            sys.settrace(None)

        return self.timeline

if __name__ == "__main__":
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'r') as f:
            source_code = f.read()
    else:
        # Default test code if run without arguments
        source_code = """
        print("Hello World")
        """
    tracer = PythonVisualizerTracer(source_code)
    timeline = tracer.run()
    # Output JSON to stdout so Tauri can parse it
    print(json.dumps(timeline, indent=2))
