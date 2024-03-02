use std::{fs, io, path::Path};

use libpna::{Archive, Encryption};

pub(crate) fn is_encrypted<P: AsRef<Path>>(path: P) -> io::Result<bool> {
    let file = fs::File::open(path)?;
    let mut archive = Archive::read_header(file)?;
    for entry in archive.entries_skip_solid() {
        let entry = entry?;
        match entry.header().encryption() {
            Encryption::No => (),
            Encryption::Aes | Encryption::Camellia => return Ok(true),
        }
    }
    Ok(false)
}
