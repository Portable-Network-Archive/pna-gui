use std::{fs, io, path::Path};

use libpna::{Archive, Encryption, ReadEntry};

pub(crate) fn is_encrypted<P: AsRef<Path>>(path: P) -> io::Result<bool> {
    let file = fs::File::open(path)?;
    let mut archive = Archive::read_header(file)?;
    for entry in archive.entries() {
        let encryption = match entry? {
            ReadEntry::Normal(entry) => entry.encryption(),
            ReadEntry::Solid(entry) => entry.encryption(),
        };
        match encryption {
            Encryption::No => (),
            Encryption::Aes
            | Encryption::Camellia
            | Encryption::Reserved(_)
            | Encryption::Private(_) => return Ok(true),
        }
    }
    Ok(false)
}
