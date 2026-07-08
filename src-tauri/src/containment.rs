// src-tauri/src/containment.rs — filesystem containment (S22 / D33). This is a hard security
// boundary: the webview must be physically unable to read or write outside a registered vault
// root. Every path-touching command resolves through `contained_path`, which:
//   1. canonicalizes the claimed root and verifies it is a registered root (resolves symlinks);
//   2. rejects `..`, absolute, or prefix components in the vault-relative path;
//   3. canonicalizes the deepest existing ancestor of the target and verifies it is still
//      inside the canonical root — defeating a symlink planted inside the vault that points out.
//
// There is deliberately NO generic `read_file(absolutePath)` command anywhere in the app.

use std::path::{Component, Path, PathBuf};

/// The shared ignore set (S22): dotfiles / dot-directories anywhere in the relative path.
/// Covers `.denote/`, `.git/`. Applied by `list_vault_files` and the watcher alike.
pub fn is_ignored(rel: &str) -> bool {
    rel.split('/').any(|seg| seg.starts_with('.')) || rel.ends_with(".denote-tmp")
}

/// Resolve a vault-relative path to an absolute path guaranteed to be inside `root`, where
/// `root` must be one of the `registered` canonical roots. Returns an `fs`-kind error string
/// on any containment violation.
pub fn contained_path(registered: &[PathBuf], root: &str, rel: &str) -> Result<PathBuf, String> {
    let canon_root = std::fs::canonicalize(root)
        .map_err(|e| format!("cannot canonicalize vault root: {e}"))?;
    if !registered.iter().any(|r| r == &canon_root) {
        return Err("vault root is not registered".into());
    }

    let rel_path = Path::new(rel);
    for comp in rel_path.components() {
        match comp {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("path escapes vault: {rel}")),
        }
    }

    let target = canon_root.join(rel_path);

    // Symlink-escape check: canonicalize the deepest ancestor that exists on disk and confirm
    // it remains under the canonical root.
    let anchor = deepest_existing(&target);
    let canon_anchor = std::fs::canonicalize(&anchor)
        .map_err(|e| format!("cannot canonicalize path: {e}"))?;
    if !canon_anchor.starts_with(&canon_root) {
        return Err(format!("path escapes vault (symlink): {rel}"));
    }

    Ok(target)
}

fn deepest_existing(path: &Path) -> PathBuf {
    let mut p = path;
    loop {
        if p.exists() {
            return p.to_path_buf();
        }
        match p.parent() {
            Some(parent) => p = parent,
            None => return p.to_path_buf(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn canon(p: &Path) -> PathBuf {
        fs::canonicalize(p).unwrap()
    }

    #[test]
    fn accepts_paths_inside_the_root() {
        let dir = tempdir();
        let root = canon(&dir);
        let registered = vec![root.clone()];
        let ok = contained_path(&registered, dir.to_str().unwrap(), "notes/a.md").unwrap();
        assert!(ok.starts_with(&root));
    }

    #[test]
    fn rejects_parent_traversal() {
        let dir = tempdir();
        let registered = vec![canon(&dir)];
        let err = contained_path(&registered, dir.to_str().unwrap(), "../escape.md");
        assert!(err.is_err(), "../ must be rejected");
    }

    #[test]
    fn rejects_absolute_rel() {
        let dir = tempdir();
        let registered = vec![canon(&dir)];
        let err = contained_path(&registered, dir.to_str().unwrap(), "/etc/passwd");
        assert!(err.is_err(), "absolute rel must be rejected");
    }

    #[test]
    fn rejects_unregistered_root() {
        let dir = tempdir();
        let registered: Vec<PathBuf> = vec![]; // nothing registered
        let err = contained_path(&registered, dir.to_str().unwrap(), "a.md");
        assert!(err.is_err(), "unregistered root must be rejected");
    }

    #[test]
    fn rejects_symlink_escape() {
        let dir = tempdir();
        let outside = tempdir();
        fs::write(outside.join("secret.txt"), b"top secret").unwrap();
        // Plant a symlink INSIDE the vault pointing to the outside directory.
        let link = dir.join("escape");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let registered = vec![canon(&dir)];
        let err = contained_path(&registered, dir.to_str().unwrap(), "escape/secret.txt");
        assert!(err.is_err(), "symlink escape must be rejected");
    }

    #[test]
    fn ignore_set_matches_dotdirs() {
        assert!(is_ignored(".denote/meta.json"));
        assert!(is_ignored(".git/config"));
        assert!(is_ignored("a/.hidden/x.md"));
        assert!(is_ignored("notes/a.md.denote-tmp"), "atomic-write tmp files are ignored (S7)");
        assert!(!is_ignored("notes/a.md"));
    }

    // Minimal unique temp dir without pulling in a crate.
    fn tempdir() -> PathBuf {
        let mut p = std::env::temp_dir();
        let uniq = format!(
            "denote-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        p.push(uniq);
        fs::create_dir_all(&p).unwrap();
        p
    }
}
