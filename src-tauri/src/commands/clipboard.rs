use std::thread;
use std::time::Duration;

use anyhow::Context;
use arboard::Clipboard;
use enigo::{Enigo, Key, KeyboardControllable};
use rfd::FileDialog;

use crate::models::SampleAcquireResult;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn read_clipboard_text_internal() -> anyhow::Result<String> {
    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    let content = clipboard.get_text().context("failed to read clipboard text")?;
    Ok(content)
}

fn write_clipboard_text_internal(text: &str) -> anyhow::Result<()> {
    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    clipboard
        .set_text(text.to_string())
        .context("failed to write clipboard text")
}

fn trigger_copy_shortcut() -> anyhow::Result<()> {
    let mut enigo = Enigo::new();
    #[cfg(target_os = "macos")]
    {
        enigo.key_down(Key::Meta);
        enigo.key_click(Key::Layout('c'));
        enigo.key_up(Key::Meta);
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo.key_down(Key::Control);
        enigo.key_click(Key::Layout('c'));
        enigo.key_up(Key::Control);
    }
    Ok(())
}

fn acquire_sample(prefer_selection: bool) -> Result<SampleAcquireResult, String> {
    let clipboard_before = read_clipboard_text_internal().unwrap_or_default();
    let mut picked_text = String::new();

    if prefer_selection {
        if trigger_copy_shortcut().is_ok() {
            thread::sleep(Duration::from_millis(140));
            if let Ok(after) = read_clipboard_text_internal() {
                if !after.trim().is_empty() && after != clipboard_before {
                    picked_text = after;
                }
            }
        }
    }

    if !picked_text.trim().is_empty() {
        return Ok(SampleAcquireResult {
            text: picked_text,
            source_type: "selected_text".to_string(),
            fallback_used: false,
            message: "sample text acquired from external selected text".to_string(),
        });
    }

    let fallback = read_clipboard_text_internal().map_err(|e| e.to_string())?;
    if fallback.trim().is_empty() {
        return Err(
            "no selected text or clipboard text available, please copy sample text first"
                .to_string(),
        );
    }

    Ok(SampleAcquireResult {
        text: fallback,
        source_type: "clipboard".to_string(),
        fallback_used: true,
        message: "external selection failed, fallback to clipboard text".to_string(),
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) fn read_selected_text() -> Result<SampleAcquireResult, String> {
    acquire_sample(true)
}

#[tauri::command]
pub(crate) fn read_clipboard_text() -> Result<SampleAcquireResult, String> {
    acquire_sample(false)
}

#[tauri::command]
pub(crate) fn copy_to_clipboard(text: String) -> Result<(), String> {
    write_clipboard_text_internal(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn select_input_path(allow_dir: bool) -> Result<Option<String>, String> {
    let path = if allow_dir {
        FileDialog::new().pick_folder()
    } else {
        FileDialog::new().pick_file()
    };
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn select_output_dir() -> Result<Option<String>, String> {
    let path = FileDialog::new().pick_folder();
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}
