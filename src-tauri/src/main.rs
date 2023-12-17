// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io, path::Path};

#[cfg(not(target_os = "macos"))]
use tauri::Submenu;
use tauri::{CustomMenuItem, Menu, MenuEntry, Window};

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
#[tauri::command]
fn create(window: Window, name: &str, files: Vec<&str>) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command(async)]
fn extract(window: Window, path: &str) -> tauri::Result<()> {
    Ok(_extract(path, |name| {
        let _ = window.emit("extract_processing", name);
    })?)
}

fn _extract<OnStart>(path: &str, on_start_extract_entry: OnStart) -> io::Result<()>
where
    OnStart: Fn(&Path),
{
    let path: &Path = path.as_ref();
    let file_name: &Path = path.file_stem().unwrap_or("pna".as_ref()).as_ref();
    let dir = if let Some(parent) = path.parent() {
        parent.join(file_name)
    } else {
        file_name.to_owned()
    };
    let file = fs::File::open(path)?;
    let mut archive = libpna::Archive::read_header(file)?;
    for entry in archive.entries() {
        let entry = entry?;
        if libpna::DataKind::File != entry.header().data_kind() {
            continue;
        }
        let name = entry.header().path().as_path();
        on_start_extract_entry(name);
        let name = dir.join(name);
        if let Some(parent) = name.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut writer = fs::File::create(name)?;
        let mut reader = entry.reader(libpna::ReadOption::with_password::<String>(None))?;
        io::copy(&mut reader, &mut writer)?;
    }
    Ok(())
}

const MENU_UPDATE_CHECK: &str = "update check";

fn main() {
    let context = tauri::generate_context!();
    let mut menu = Menu::os_default(&context.package_info().name);
    let update_check = CustomMenuItem::new(MENU_UPDATE_CHECK, "Check for updates...");
    #[cfg(target_os = "macos")]
    if let MenuEntry::Submenu(sub_menu) = &mut menu.items[0] {
        sub_menu
            .inner
            .items
            .insert(1, MenuEntry::CustomItem(update_check));
    }
    #[cfg(not(target_os = "macos"))]
    {
        menu = menu.add_submenu(Submenu::new("Tools", Menu::new().add_item(update_check)));
    }

    tauri::Builder::default()
        .menu(menu)
        .on_menu_event(|event| {
            match event.menu_item_id() {
                MENU_UPDATE_CHECK => {
                    event
                        .window()
                        .emit_and_trigger("tauri://update", ())
                        .unwrap();
                }
                m => println!("{}", m),
            };
        })
        .invoke_handler(tauri::generate_handler![create, extract])
        .run(context)
        .expect("error while running tauri application");
}
