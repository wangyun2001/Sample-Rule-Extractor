// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use std::process::Command;
use std::io::{BufRead, BufReader};

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
#[tauri::command]
fn get_selected_text() -> String {
    // In a real implementation, this would use platform-specific APIs
    // to get the current text selection from the OS.
    // For now, we fallback to clipboard or return a placeholder.
    "Placeholder for selected text from OS".to_string()
}

#[tauri::command]
async fn run_python_script(
    app_handle: tauri::AppHandle,
    script_path: String,
    input_path: String,
    output_dir: String,
    format: String
) -> Result<String, String> {
    let output = Command::new("python3")
        .arg(script_path)
        .arg("--input")
        .arg(input_path)
        .arg("--output")
        .arg(output_dir)
        .arg("--format")
        .arg(format)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_selected_text,
            run_python_script
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
