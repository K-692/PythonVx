//! PythonVx backend.
//!
//! The frontend sends Python source code; we run it under the tracer
//! (`python/tracer.py`, embedded at compile time) using the Python
//! interpreter installed on the user's machine, and hand back the JSON trace.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const TRACER_SCRIPT: &str = include_str!("../python/tracer.py");
const MIN_PYTHON: (u32, u32) = (3, 8);

static RUN_COUNTER: AtomicU64 = AtomicU64::new(0);
/// Interpreter found by auto-detection (cached for the session).
static DETECTED: Mutex<Option<PythonInfo>> = Mutex::new(None);

#[derive(Clone, Serialize)]
pub struct PythonInfo {
    path: String,
    version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOptions {
    code: String,
    #[serde(default)]
    stdin: String,
    #[serde(default = "default_steps")]
    max_steps: u32,
    #[serde(default = "default_time")]
    time_limit: f64,
    #[serde(default)]
    python_path: Option<String>,
}

fn default_steps() -> u32 {
    2000
}
fn default_time() -> f64 {
    10.0
}

fn new_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env_remove("PYTHONSTARTUP");
    cmd
}

/// Candidate interpreters, most likely first. Desktop apps on macOS start
/// with a minimal PATH, so common install locations are listed explicitly.
fn candidates() -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();

    if cfg!(target_os = "windows") {
        list.push("py".into()); // Python launcher (handled specially)
        list.push("python".into());
        list.push("python3".into());
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let base = Path::new(&local).join("Programs").join("Python");
            if let Ok(entries) = fs::read_dir(&base) {
                let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
                dirs.sort();
                dirs.reverse();
                for d in dirs {
                    list.push(d.join("python.exe").to_string_lossy().into_owned());
                }
            }
        }
    } else {
        for p in [
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
        ] {
            list.push(p.into());
        }
        if !home.is_empty() {
            list.push(format!("{home}/.pyenv/shims/python3"));
            list.push(format!("{home}/miniconda3/bin/python3"));
            list.push(format!("{home}/anaconda3/bin/python3"));
            list.push(format!("{home}/.local/bin/python3"));
        }
        list.push("python3".into());
        list.push("/usr/bin/python3".into());
        list.push("python".into());
    }
    list
}

fn program_and_args(python: &str) -> (String, Vec<String>) {
    if python == "py" {
        ("py".into(), vec!["-3".into()])
    } else {
        (python.into(), vec![])
    }
}

fn parse_version(v: &str) -> Option<(u32, u32)> {
    let mut it = v.trim().split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next()?.parse().ok()?;
    Some((major, minor))
}

/// Ask an interpreter for its version. Returns None if it doesn't work.
fn probe(python: &str) -> Option<PythonInfo> {
    let (prog, args) = program_and_args(python);
    let out = new_command(&prog)
        .args(&args)
        .args(["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let (major, minor) = parse_version(&version)?;
    if (major, minor) < MIN_PYTHON {
        return None;
    }
    Some(PythonInfo { path: python.to_string(), version })
}

fn resolve_python(custom: Option<&str>) -> Result<PythonInfo, String> {
    if let Some(path) = custom.map(str::trim).filter(|p| !p.is_empty()) {
        return probe(path).ok_or_else(|| {
            format!(
                "The Python interpreter set in Settings (\"{path}\") could not be started or is older than {}.{}.\n\
                 Fix the path in Settings, or clear it to let PythonVx find Python automatically.",
                MIN_PYTHON.0, MIN_PYTHON.1
            )
        });
    }
    if let Some(info) = DETECTED.lock().ok().and_then(|g| g.clone()) {
        return Ok(info);
    }
    for c in candidates() {
        if let Some(info) = probe(&c) {
            if let Ok(mut g) = DETECTED.lock() {
                *g = Some(info.clone());
            }
            return Ok(info);
        }
    }
    Err(format!(
        "PythonVx could not find Python {}.{} or newer on this computer.\n\n\
         1. Install Python from https://www.python.org/downloads/ \
         (on Windows tick \"Add python.exe to PATH\").\n\
         2. Restart PythonVx.\n\n\
         If Python is already installed, open Settings and enter the full path to the interpreter.",
        MIN_PYTHON.0, MIN_PYTHON.1
    ))
}

/// A private, uniquely named working directory for one run.
struct Workspace {
    dir: PathBuf,
}

impl Workspace {
    fn new(kind: &str) -> Result<Self, String> {
        let n = RUN_COUNTER.fetch_add(1, Ordering::SeqCst);
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "pythonvx-{}-{}-{}-{}",
            kind,
            std::process::id(),
            n,
            stamp
        ));
        fs::create_dir_all(&dir).map_err(|e| format!("Could not create a temp folder: {e}"))?;
        fs::write(dir.join("tracer.py"), TRACER_SCRIPT)
            .map_err(|e| format!("Could not write the tracer: {e}"))?;
        Ok(Self { dir })
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// Run the tracer in `mode`, wait at most `timeout`, and return the JSON it wrote.
fn run_tracer(
    python: &PythonInfo,
    mode: &str,
    request: &serde_json::Value,
    timeout: Duration,
    cwd: Option<&Path>,
) -> Result<String, String> {
    let ws = Workspace::new(mode)?;
    let req_path = ws.dir.join("request.json");
    let out_path = ws.dir.join("result.json");
    fs::write(&req_path, request.to_string()).map_err(|e| e.to_string())?;

    let (prog, args) = program_and_args(&python.path);
    let mut cmd = new_command(&prog);
    cmd.args(&args)
        .arg("-X")
        .arg("utf8")
        .arg(ws.dir.join("tracer.py"))
        .arg(mode)
        .arg(&req_path)
        .arg(&out_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Programs that create files put them in a scratch folder, not in the
    // app bundle / system directories.
    cmd.current_dir(cwd.unwrap_or(&ws.dir));

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Python ({}): {e}", python.path))?;

    // Drain pipes on threads so a chatty program can't block on a full pipe.
    let mut so = child.stdout.take();
    let mut se = child.stderr.take();
    let t_out = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(s) = so.as_mut() {
            let _ = s.take(64 * 1024).read_to_end(&mut buf);
            let _ = std::io::copy(s, &mut std::io::sink());
        }
        buf
    });
    let t_err = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(s) = se.as_mut() {
            let _ = s.take(64 * 1024).read_to_end(&mut buf);
            let _ = std::io::copy(s, &mut std::io::sink());
        }
        buf
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
            Err(e) => return Err(format!("Lost track of the Python process: {e}")),
        }
    };
    let stdout = String::from_utf8_lossy(&t_out.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&t_err.join().unwrap_or_default()).into_owned();

    let Some(status) = status else {
        return Err(format!(
            "Your program was stopped because it ran for more than {} seconds without finishing.\n\
             Check for loops that never end, or for code waiting on something.",
            timeout.as_secs()
        ));
    };

    match fs::read_to_string(&out_path) {
        Ok(json) => Ok(json),
        Err(_) => {
            let detail = format!("{stderr}{stdout}").trim().to_string();
            Err(if detail.is_empty() {
                format!(
                    "Python exited (code {}) before the trace was written. \
                     The program may have called os._exit() or crashed the interpreter.",
                    status.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".into())
                )
            } else {
                format!("Python stopped unexpectedly:\n{detail}")
            })
        }
    }
}

fn scratch_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("pythonvx-files");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
async fn run_python(options: RunOptions) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let python = resolve_python(options.python_path.as_deref())?;
        let max_steps = options.max_steps.clamp(50, 20_000);
        let time_limit = options.time_limit.clamp(1.0, 120.0);
        let request = serde_json::json!({
            "code": options.code,
            "stdin": options.stdin,
            "max_steps": max_steps,
            "time_limit": time_limit,
        });
        // Hard limit a bit above the tracer's own watchdog.
        let hard = Duration::from_secs_f64(time_limit + 10.0);
        let dir = scratch_dir();
        let json = run_tracer(&python, "run", &request, hard, Some(&dir))?;
        // Wrap the trace with interpreter info without re-parsing it.
        Ok(format!(
            "{{\"interpreter\":{},\"trace\":{}}}",
            serde_json::to_string(&python).unwrap_or_else(|_| "null".into()),
            json
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn introspect(request: serde_json::Value, python_path: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let python = resolve_python(python_path.as_deref())?;
        run_tracer(&python, "introspect", &request, Duration::from_secs(15), None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn detect_python(python_path: Option<String>) -> Result<PythonInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if python_path.as_deref().map(str::trim).unwrap_or("").is_empty() {
            if let Ok(mut g) = DETECTED.lock() {
                *g = None; // force a fresh search
            }
        }
        resolve_python(python_path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn files_dir() -> String {
    scratch_dir().to_string_lossy().into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_python,
            introspect,
            detect_python,
            files_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
