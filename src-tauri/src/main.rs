// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io, path::Path};

use libpna::{Archive, EntryBuilder, WriteOption};
#[cfg(not(target_os = "macos"))]
use tauri::Submenu;
use tauri::{api::dialog::FileDialogBuilder, CustomMenuItem, Menu, MenuEntry, Window};

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
#[tauri::command]
fn open_pna_file_picker(window: Window, event: String) {
    FileDialogBuilder::new()
        .add_filter("pna", &["pna"])
        .pick_file(move |path| {
            path.and_then(|p| window.emit(&event, p).ok());
        });
}

#[tauri::command]
fn open_files_picker(window: Window, event: String) {
    FileDialogBuilder::new().pick_files(move |paths| {
        paths.and_then(|p| window.emit(&event, p).ok());
    })
}

#[tauri::command]
fn open_dir_picker(window: Window, event: String) {
    FileDialogBuilder::new().pick_folder(move |path| {
        path.and_then(|p| window.emit(&event, p).ok());
    })
}

#[tauri::command]
fn create(
    window: Window,
    archive_finish_event: String,
    entry_start_event: String,
    name: &str,
    files: Vec<&str>,
    save_dir: &str,
) -> tauri::Result<()> {
    Ok(_create(
        name,
        files,
        save_dir.as_ref(),
        |e, path| {
            match e {
                Event::Start => (),
                Event::Finish => window.emit(&archive_finish_event, path).unwrap(),
            };
        },
        |e, path| match e {
            Event::Start => window.emit(&entry_start_event, path).unwrap(),
            Event::Finish => (),
        },
    )?)
}

#[tauri::command(async)]
fn extract(window: Window, event: String, path: &str) -> tauri::Result<()> {
    Ok(_extract(path.as_ref(), |name| {
        let _ = window.emit(&event, name);
    })?)
}

enum Event {
    Start,
    Finish,
}

fn _create<OnChangeArchive, OnChangeEntry>(
    name: &str,
    files: Vec<&str>,
    save_dir: &Path,
    on_change_archive: OnChangeArchive,
    on_change_entry: OnChangeEntry,
) -> io::Result<()>
where
    OnChangeArchive: Fn(Event, &Path),
    OnChangeEntry: Fn(Event, &Path),
{
    fs::create_dir_all(save_dir)?;
    let archive_file_path = save_dir.join(name);
    on_change_archive(Event::Start, &archive_file_path);
    let archive_file = fs::File::create(&archive_file_path)?;
    let mut archive = Archive::write_header(archive_file)?;
    for file in files {
        on_change_entry(Event::Start, file.as_ref());
        let mut f = fs::File::open(file)?;
        let option = WriteOption::builder()
            .compression(libpna::Compression::ZStandard)
            .build();
        let mut entry = EntryBuilder::new_file(file.try_into().map_err(io::Error::other)?, option)?;
        io::copy(&mut f, &mut entry)?;
        archive.add_entry(entry.build()?)?;
        on_change_entry(Event::Finish, file.as_ref());
    }
    archive.finalize()?;
    on_change_archive(Event::Finish, &archive_file_path);
    Ok(())
}

fn _extract<OnStart>(path: &Path, on_start_extract_entry: OnStart) -> io::Result<()>
where
    OnStart: Fn(&Path),
{
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
        .invoke_handler(tauri::generate_handler![
            create,
            extract,
            open_pna_file_picker,
            open_files_picker,
            open_dir_picker,
        ])
        .run(context)
        .expect("error while running tauri application");
}
