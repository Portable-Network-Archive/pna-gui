// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use libpna::{Archive, EntryBuilder, EntryName, WriteOption};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use tauri::MenuEntry;
#[cfg(not(target_os = "macos"))]
use tauri::Submenu;
use tauri::{api::dialog::FileDialogBuilder, CustomMenuItem, Menu, Window};

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

#[tauri::command(async)]
fn create(
    window: Window,
    archive_finish_event: String,
    entry_start_event: String,
    name: &str,
    files: Vec<PathBuf>,
    save_dir: PathBuf,
    option: PnaOption,
) -> tauri::Result<()> {
    Ok(_create(
        name,
        files,
        &save_dir,
        option,
        |e, path| {
            match e {
                Event::Start => (),
                Event::Finish => {
                    window.emit(&archive_finish_event, path).unwrap();
                    open::that(&save_dir).unwrap();
                }
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
    Ok(_extract(
        path.as_ref(),
        |e, name| match e {
            Event::Start => (),
            Event::Finish => open::that(name).unwrap(),
        },
        |e, name| match e {
            Event::Start => window.emit(&event, name).unwrap(),
            Event::Finish => (),
        },
    )?)
}

enum Event {
    Start,
    Finish,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
enum Compression {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "zlib")]
    Zlib,
    #[serde(rename = "zstd")]
    ZStandard,
    #[serde(rename = "xz")]
    XZ,
}

impl From<Compression> for libpna::Compression {
    fn from(value: Compression) -> Self {
        match value {
            Compression::None => Self::No,
            Compression::Zlib => Self::Deflate,
            Compression::ZStandard => Self::ZStandard,
            Compression::XZ => Self::XZ,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct PnaOption {
    compression: Compression,
}

fn _create<OnChangeArchive, OnChangeEntry>(
    name: &str,
    files: Vec<PathBuf>,
    save_dir: &Path,
    option: PnaOption,
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
    for file in files.iter() {
        on_change_entry(Event::Start, file.as_ref());
        let mut f = fs::File::open(file)?;
        let option = WriteOption::builder()
            .compression(option.compression.into())
            .build();
        let mut entry = EntryBuilder::new_file(EntryName::from_lossy(file), option)?;
        io::copy(&mut f, &mut entry)?;
        archive.add_entry(entry.build()?)?;
        on_change_entry(Event::Finish, file.as_ref());
    }
    archive.finalize()?;
    on_change_archive(Event::Finish, &archive_file_path);
    Ok(())
}

fn _extract<OnChangeArchive, OnChangeEntry>(
    path: &Path,
    on_change_archive: OnChangeArchive,
    on_change_entry: OnChangeEntry,
) -> io::Result<()>
where
    OnChangeEntry: Fn(Event, &Path),
    OnChangeArchive: Fn(Event, &Path),
{
    let file_name: &Path = path.file_stem().unwrap_or("pna".as_ref()).as_ref();
    let out_dir = if let Some(parent) = path.parent() {
        parent.join(file_name)
    } else {
        file_name.to_owned()
    };
    on_change_archive(Event::Start, &out_dir);
    let file = fs::File::open(path)?;
    let mut archive = libpna::Archive::read_header(file)?;
    for entry in archive.entries() {
        let entry = entry?;
        if libpna::DataKind::File != entry.header().data_kind() {
            continue;
        }
        let name = entry.header().path().as_path();
        on_change_entry(Event::Start, name);
        let out_path = out_dir.join(name);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut writer = fs::File::create(out_path)?;
        let mut reader = entry.reader(libpna::ReadOption::with_password::<String>(None))?;
        io::copy(&mut reader, &mut writer)?;
        on_change_entry(Event::Finish, name);
    }
    on_change_archive(Event::Finish, &out_dir);
    Ok(())
}

const MENU_UPDATE_CHECK: &str = "update check";
const MENU_EXTRACT_TAB: &str = "extract tab";
const MENU_CREATE_TAB: &str = "create tab";

fn main() {
    let context = tauri::generate_context!();
    let mut menu = Menu::os_default(&context.package_info().name);
    let update_check = CustomMenuItem::new(MENU_UPDATE_CHECK, "Check for updates...");
    let extract_tab = CustomMenuItem::new(MENU_EXTRACT_TAB, "Extract");
    let create_tab = CustomMenuItem::new(MENU_CREATE_TAB, "Create");
    #[cfg(target_os = "macos")]
    if let MenuEntry::Submenu(sub_menu) = &mut menu.items[0] {
        let items = &mut sub_menu.inner.items;
        items.insert(1, MenuEntry::CustomItem(update_check));
    }
    #[cfg(target_os = "macos")]
    if let MenuEntry::Submenu(sub_menu) = &mut menu.items[3] {
        let items = &mut sub_menu.inner.items;
        items.insert(0, MenuEntry::CustomItem(extract_tab.accelerator("Cmd+1")));
        items.insert(1, MenuEntry::CustomItem(create_tab.accelerator("Cmd+2")));
    }
    #[cfg(not(target_os = "macos"))]
    {
        menu = menu.add_submenu(Submenu::new("Tools", Menu::new().add_item(update_check)));
        menu = menu.add_item(extract_tab.accelerator("Ctrl+1"));
        menu = menu.add_item(create_tab.accelerator("Ctrl+2"));
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
                MENU_EXTRACT_TAB => {
                    event.window().emit("switch_tab", "extract").unwrap();
                }
                MENU_CREATE_TAB => {
                    event.window().emit("switch_tab", "create").unwrap();
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
