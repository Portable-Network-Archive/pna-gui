use std::{env, fs, io::Write, path::PathBuf};

use libpna::{Archive, Encryption, EntryBuilder, EntryName, WriteOptions};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: generate_e2e_fixture <output.pna>")?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }

    let file = fs::File::create(&output)?;
    let mut archive = Archive::write_header(file)?;
    for (path, content) in [
        (
            "docs/readme.txt",
            "PNA desktop E2E fixture: real Rust preview content.\n",
        ),
        ("src/main.rs", "fn main() { println!(\"fixture\"); }\n"),
    ] {
        let options = WriteOptions::builder()
            .encryption(Encryption::Aes)
            .password(Some("secret"))
            .build();
        let mut entry = EntryBuilder::new_file(EntryName::from(path), options)?;
        entry.write_all(content.as_bytes())?;
        archive.add_entry(entry.build()?)?;
    }
    archive.finalize()?;
    println!("{}", output.display());
    Ok(())
}
