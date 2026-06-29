mod analysis;
mod commands;
mod llm;
mod models;
mod script;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::clipboard::read_selected_text,
            commands::clipboard::read_clipboard_text,
            commands::clipboard::copy_to_clipboard,
            commands::clipboard::select_input_path,
            commands::clipboard::select_output_dir,
            commands::llm::test_llm_api,
            commands::llm::classify_scene_ai,
            commands::llm::optimize_prompt_template,
            commands::llm::generate_field_alias_map_ai,
            commands::analysis::analyze_rules_ai,
            commands::analysis::analyze_rules_ai_stream,
            commands::script::generate_script_ai,
            commands::script::generate_script_ai_stream,
            commands::runner::run_generated_script
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
