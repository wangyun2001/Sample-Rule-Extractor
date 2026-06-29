use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use chrono::Utc;
use tauri::{AppHandle, Emitter};

use crate::models::{PythonLogEvent, RunScriptRequest, RunScriptResult};
use crate::script::resolve_runtime_root;

const PYTHON_RUNNER: &str = include_str!("../../../python_runtime/runner.py");

fn validate_run_id(run_id: &str) -> Result<(), String> {
    if run_id.is_empty() || !run_id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err(format!(
            "Invalid run_id: '{}'. Only alphanumeric, hyphens and underscores allowed.",
            run_id
        ));
    }
    Ok(())
}

fn validate_python_bin(bin: &str) -> Result<(), String> {
    let path = std::path::Path::new(bin);
    let basename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let allowed = ["python", "python3", "py", "python.exe", "python3.exe", "py.exe"];
    if !allowed.contains(&basename) {
        return Err(format!(
            "Invalid python_bin: '{}'. Must be python/python3/py.",
            bin
        ));
    }
    Ok(())
}

fn validate_path_safe(path: &str) -> Result<(), String> {
    if path.contains('\0') {
        return Err("Path contains null bytes".into());
    }
    if path.len() > 4096 {
        return Err("Path too long".into());
    }
    Ok(())
}

fn emit_log(app: &AppHandle, run_id: &str, level: &str, message: impl Into<String>) {
    let payload = PythonLogEvent {
        run_id: run_id.to_string(),
        level: level.to_string(),
        message: message.into(),
    };
    let _ = app.emit("python-log", payload);
}

#[tauri::command]
pub(crate) fn run_generated_script(
    app: AppHandle,
    payload: RunScriptRequest,
) -> Result<RunScriptResult, String> {
    // Security validations
    validate_run_id(&payload.run_id)?;
    if let Some(ref bin) = payload.python_bin {
        validate_python_bin(bin)?;
    }
    validate_path_safe(&payload.input_path)?;
    validate_path_safe(&payload.output_dir)?;

    let runtime_root = resolve_runtime_root();
    let generated_dir = runtime_root.join("generated");
    fs::create_dir_all(&generated_dir).map_err(|e| e.to_string())?;

    let script_path = generated_dir.join(format!("extract-{}.py", payload.run_id));
    let config_path = generated_dir.join(format!("config-{}.json", payload.run_id));
    let runner_path = runtime_root.join("runner.py");

    fs::write(&runner_path, PYTHON_RUNNER).map_err(|e| e.to_string())?;
    fs::write(&script_path, payload.extract_py.as_bytes()).map_err(|e| e.to_string())?;
    fs::write(&config_path, payload.config_json.as_bytes()).map_err(|e| e.to_string())?;

    emit_log(
        &app,
        &payload.run_id,
        "system",
        format!(
            "run python script with script={} config={}",
            script_path.to_string_lossy(),
            config_path.to_string_lossy()
        ),
    );

    let python_bin = payload.python_bin.unwrap_or_else(|| "python".to_string());
    let mut child = Command::new(&python_bin)
        .arg(&runner_path)
        .arg("--script")
        .arg(&script_path)
        .arg("--config")
        .arg(&config_path)
        .arg("--input")
        .arg(&payload.input_path)
        .arg("--output-dir")
        .arg(&payload.output_dir)
        .arg("--format")
        .arg(&payload.output_format)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn python process: {}", e))?;

    let output_path_holder = Arc::new(Mutex::new(String::new()));

    let stdout_handle = if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        let run_id = payload.run_id.clone();
        let output_path_clone = output_path_holder.clone();
        Some(thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(path) = line.strip_prefix("OUTPUT_FILE::") {
                    if let Ok(mut guard) = output_path_clone.lock() {
                        *guard = path.trim().to_string();
                    }
                }
                emit_log(&app_clone, &run_id, "stdout", line);
            }
        }))
    } else {
        None
    };

    let stderr_handle = if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        let run_id = payload.run_id.clone();
        Some(thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                emit_log(&app_clone, &run_id, "stderr", line);
            }
        }))
    } else {
        None
    };

    let status = child.wait().map_err(|e| e.to_string())?;
    if let Some(handle) = stdout_handle {
        let _ = handle.join();
    }
    if let Some(handle) = stderr_handle {
        let _ = handle.join();
    }

    let output_file = output_path_holder
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    if !status.success() {
        return Err(format!(
            "script execution failed, exit_code={}",
            status.code().unwrap_or(-1)
        ));
    }

    let output_file = if output_file.is_empty() {
        PathBuf::from(&payload.output_dir)
            .join(format!(
                "extract_result_{}.{}",
                Utc::now().format("%Y%m%d%H%M%S"),
                payload.output_format
            ))
            .to_string_lossy()
            .to_string()
    } else {
        output_file
    };

    Ok(RunScriptResult {
        run_id: payload.run_id,
        output_file,
        exit_code: status.code().unwrap_or(0),
    })
}
