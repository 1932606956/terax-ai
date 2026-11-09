use crate::modules::git::types::GitChangedFile;

#[derive(Default)]
pub struct PorcelainV2 {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_detached: bool,
    pub files: Vec<GitChangedFile>,
}

pub fn parse_porcelain_v2(stdout: &str) -> PorcelainV2 {
    let mut out = PorcelainV2 {
        branch: "HEAD".into(),
        ..Default::default()
    };
    let mut tokens = stdout.split('\0').filter(|t| !t.is_empty()).peekable();
    while let Some(tok) = tokens.next() {
        if let Some(rest) = tok.strip_prefix("# branch.head ") {
            out.branch = rest.to_string();
            out.is_detached = rest == "(detached)";
            continue;
        }
        if let Some(rest) = tok.strip_prefix("# branch.upstream ") {
            out.upstream = Some(rest.to_string());
            continue;
        }
        if let Some(rest) = tok.strip_prefix("# branch.ab ") {
            let mut parts = rest.split_ascii_whitespace();
            if let Some(a) = parts.next() {
                out.ahead = a.trim_start_matches('+').parse().unwrap_or(0);
            }
            if let Some(b) = parts.next() {
                out.behind = b.trim_start_matches('-').parse().unwrap_or(0);
            }
            continue;
        }
        if tok.starts_with("# ") {
            continue;
        }
        if let Some(rest) = tok.strip_prefix("1 ") {
            if let Some(file) = parse_ordinary(rest) {
                out.files.push(file);
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("2 ") {
            let orig = tokens.next().unwrap_or("").to_string();
            if let Some(file) = parse_renamed(rest, orig) {
                out.files.push(file);
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("u ") {
            if let Some(file) = parse_unmerged(rest) {
                out.files.push(file);
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("? ") {
            out.files.push(make_file('?', '?', false, rest, None));
            continue;
        }
    }
    out
}

fn skip_fields(s: &str, n: usize) -> Option<&str> {
    let mut rest = s;
    for _ in 0..n {
        let idx = rest.find(' ')?;
        rest = &rest[idx + 1..];
    }
    Some(rest)
}

fn parse_ordinary(rest: &str) -> Option<GitChangedFile> {
    let xy = rest.get(..2)?;
    let path = skip_fields(rest, 7)?;
    let (i, w) = xy_chars(xy);
    Some(make_file(i, w, sub_module(rest), path, None))
}

fn parse_renamed(rest: &str, orig_path: String) -> Option<GitChangedFile> {
    let xy = rest.get(..2)?;
    let after = skip_fields(rest, 8)?;
    let (i, w) = xy_chars(xy);
    Some(make_file(i, w, sub_module(rest), after, Some(orig_path)))
}

fn parse_unmerged(rest: &str) -> Option<GitChangedFile> {
    let xy = rest.get(..2)?;
    let path = skip_fields(rest, 9)?;
    let (i, w) = xy_chars(xy);
    Some(make_file(i, w, sub_module(rest), path, None))
}

// `<sub>` is the fixed-width 4-char field right after `<XY>`; its first char
// is `S` for gitlinks (submodules).
fn sub_module(rest: &str) -> bool {
    rest.get(3..4).is_some_and(|c| c.starts_with('S'))
}

// porcelain v2 uses '.' to mean "unchanged"; downstream logic mirrors v1 spaces.
fn xy_chars(xy: &str) -> (char, char) {
    let mut it = xy.chars();
    let to_space = |c: char| if c == '.' { ' ' } else { c };
    (
        to_space(it.next().unwrap_or(' ')),
        to_space(it.next().unwrap_or(' ')),
    )
}

fn make_file(
    index_status: char,
    worktree_status: char,
    sub_module: bool,
    path: &str,
    original_path: Option<String>,
) -> GitChangedFile {
    GitChangedFile {
        path: path.to_string(),
        original_path,
        index_status: index_status.to_string(),
        worktree_status: worktree_status.to_string(),
        staged: is_staged(index_status, worktree_status),
        unstaged: is_unstaged(index_status, worktree_status),
        untracked: index_status == '?' && worktree_status == '?',
        is_submodule: sub_module,
        status_label: status_label(index_status, worktree_status),
        insertions: 0,
        deletions: 0,
    }
}

fn is_staged(index_status: char, worktree_status: char) -> bool {
    index_status != ' ' && !(index_status == '?' && worktree_status == '?')
}

fn is_unstaged(index_status: char, worktree_status: char) -> bool {
    worktree_status != ' ' || (index_status == '?' && worktree_status == '?')
}

fn status_label(index_status: char, worktree_status: char) -> String {
    match (index_status, worktree_status) {
        ('?', '?') => "Untracked".into(),
        ('A', _) => "Added".into(),
        ('M', _) | (_, 'M') => "Modified".into(),
        ('D', _) | (_, 'D') => "Deleted".into(),
        ('R', _) | (_, 'R') => "Renamed".into(),
        ('C', _) | (_, 'C') => "Copied".into(),
        ('U', _) | (_, 'U') => "Unmerged".into(),
        _ => "Changed".into(),
    }
}

/// One `git submodule status` record: `<flag><sha> <path>[ (<describe>)]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSubmodule {
    pub flag: char,
    pub sha: String,
    pub path: String,
    pub describe: Option<String>,
}

impl ParsedSubmodule {
    pub fn state(&self) -> &'static str {
        submodule_state(self.flag)
    }
}

/// The flag character git uses in `git submodule status`:
/// `' '` clean, `'+'` checked-out SHA differs from the index, `'-'` not
/// initialized, `'U'` merge conflict.
pub fn submodule_state(flag: char) -> &'static str {
    match flag {
        '-' => "uninitialized",
        '+' => "modified",
        'U' => "conflict",
        _ => "initialized",
    }
}

pub fn parse_submodule_status_line(line: &str) -> Option<ParsedSubmodule> {
    let flag = line.chars().next()?;
    let rest = line.get(flag.len_utf8()..)?;
    let (sha, tail) = rest.split_once(' ')?;
    if sha.is_empty() || tail.is_empty() {
        return None;
    }
    let (path, describe) = match tail.rsplit_once(" (") {
        Some((path, describe)) if describe.len() > 1 && describe.ends_with(')') => (
            path.to_string(),
            Some(describe[..describe.len() - 1].to_string()),
        ),
        _ => (tail.to_string(), None),
    };
    if path.is_empty() {
        return None;
    }
    Some(ParsedSubmodule {
        flag,
        sha: sha.to_string(),
        path,
        describe,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Build one ordinary-change record (`1 ` entry) with the exact field layout
    // git emits: `XY sub mH mI mW hH hI path`.
    fn ordinary(xy: &str, path: &str) -> String {
        format!("1 {xy} N... 100644 100644 100644 aaaa bbbb {path}\0")
    }

    #[test]
    fn porcelain_v2_parses_branch_and_files() {
        let stdout = concat!(
            "# branch.oid abc123\0",
            "# branch.head main\0",
            "# branch.upstream origin/main\0",
            "# branch.ab +2 -1\0",
            "1 .M N... 100644 100644 100644 abc def src/a.rs\0",
            "2 R. N... 100644 100644 100644 abc def R100 src/new.rs\0src/old.rs\0",
            "? src/untracked.rs\0",
        );
        let parsed = parse_porcelain_v2(stdout);
        assert_eq!(parsed.branch, "main");
        assert_eq!(parsed.upstream.as_deref(), Some("origin/main"));
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.behind, 1);
        assert!(!parsed.is_detached);
        assert_eq!(parsed.files.len(), 3);
        assert_eq!(parsed.files[0].path, "src/a.rs");
        assert!(parsed.files[0].unstaged);
        assert_eq!(parsed.files[1].path, "src/new.rs");
        assert_eq!(parsed.files[1].original_path.as_deref(), Some("src/old.rs"));
        assert!(parsed.files[1].staged);
        assert_eq!(parsed.files[2].path, "src/untracked.rs");
        assert!(parsed.files[2].untracked);
    }

    #[test]
    fn handles_detached_head() {
        let parsed = parse_porcelain_v2("# branch.oid abc\0# branch.head (detached)\0");
        assert!(parsed.is_detached);
        assert_eq!(parsed.branch, "(detached)");
        assert!(parsed.upstream.is_none());
    }

    #[test]
    fn empty_input_yields_safe_defaults() {
        let parsed = parse_porcelain_v2("");
        assert_eq!(parsed.branch, "HEAD");
        assert!(parsed.files.is_empty());
        assert_eq!(parsed.ahead, 0);
        assert_eq!(parsed.behind, 0);
        assert!(!parsed.is_detached);
        assert!(parsed.upstream.is_none());
    }

    // The whole point of skip_fields counting exact fields: a path with spaces
    // must survive intact. A naive split-on-space would truncate it.
    #[test]
    fn preserves_paths_with_spaces() {
        let parsed = parse_porcelain_v2(&ordinary(".M", "src/my file name.rs"));
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].path, "src/my file name.rs");
    }

    // A rename record consumes the *next* NUL token as its original path. If that
    // accounting is off, the entry after a rename gets eaten or misread.
    #[test]
    fn rename_consumes_orig_token_without_eating_next_entry() {
        let stdout = format!(
            "2 R. N... 100644 100644 100644 abc def R100 new.rs\0old.rs\0{}",
            ordinary(".M", "after.rs"),
        );
        let parsed = parse_porcelain_v2(&stdout);
        assert_eq!(parsed.files.len(), 2);
        assert_eq!(parsed.files[0].path, "new.rs");
        assert_eq!(parsed.files[0].original_path.as_deref(), Some("old.rs"));
        assert_eq!(parsed.files[0].status_label, "Renamed");
        assert_eq!(parsed.files[1].path, "after.rs");
        assert!(parsed.files[1].original_path.is_none());
    }

    #[test]
    fn unmerged_entry_parsed_and_labeled() {
        // `u XY sub m1 m2 m3 mW h1 h2 h3 path` -> skip 9 fields to reach path.
        let parsed =
            parse_porcelain_v2("u UU N... 100644 100644 100644 100644 a b c conflict.rs\0");
        assert_eq!(parsed.files.len(), 1);
        let f = &parsed.files[0];
        assert_eq!(f.path, "conflict.rs");
        assert_eq!(f.status_label, "Unmerged");
        assert!(f.staged);
        assert!(f.unstaged);
    }

    #[test]
    fn staged_unstaged_untracked_matrix() {
        // (XY, staged, unstaged, untracked, label)
        let cases = [
            (".M", false, true, false, "Modified"), // unstaged edit
            ("M.", true, false, false, "Modified"), // staged edit
            ("MM", true, true, false, "Modified"),  // staged then edited again
            ("A.", true, false, false, "Added"),
            ("D.", true, false, false, "Deleted"),
            (".D", false, true, false, "Deleted"),
        ];
        for (xy, staged, unstaged, untracked, label) in cases {
            let parsed = parse_porcelain_v2(&ordinary(xy, "f.rs"));
            let f = &parsed.files[0];
            assert_eq!(f.staged, staged, "staged for {xy}");
            assert_eq!(f.unstaged, unstaged, "unstaged for {xy}");
            assert_eq!(f.untracked, untracked, "untracked for {xy}");
            assert_eq!(f.status_label, label, "label for {xy}");
        }
    }

    #[test]
    fn untracked_is_unstaged_but_not_staged() {
        let parsed = parse_porcelain_v2("? new.rs\0");
        let f = &parsed.files[0];
        assert!(f.untracked);
        assert!(!f.staged);
        assert!(f.unstaged);
        assert_eq!(f.status_label, "Untracked");
        assert_eq!(f.index_status, "?");
        assert_eq!(f.worktree_status, "?");
    }

    #[test]
    fn malformed_entries_are_skipped_without_panic() {
        // Truncated `1 ` record (no fields/path) and a too-short XY must not panic
        // and must not produce a file; valid entries around them still parse.
        let parsed = parse_porcelain_v2("1 .M\0? ok.rs\0");
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].path, "ok.rs");
    }

    #[test]
    fn branch_ab_tolerates_non_numeric() {
        let ok = parse_porcelain_v2("# branch.ab +5 -3\0");
        assert_eq!((ok.ahead, ok.behind), (5, 3));
        let garbage = parse_porcelain_v2("# branch.ab +x -y\0");
        assert_eq!((garbage.ahead, garbage.behind), (0, 0));
    }

    #[test]
    fn submodule_marker_flags_changed_files() {
        // `ordinary` uses the `N...` sub field; build records with gitlink flags.
        let record = |sub: &str, path: &str| {
            format!("1 .M {sub} 160000 160000 160000 aaaa bbbb {path}\0")
        };
        for sub in ["S.M.", "SC..", "S...", "SM..", "S.U."] {
            let parsed = parse_porcelain_v2(&record(sub, "libs/child"));
            let f = &parsed.files[0];
            assert!(f.is_submodule, "sub={sub}");
            assert_eq!(f.path, "libs/child");
        }
        let plain = parse_porcelain_v2(&record("N...", "src/a.rs"));
        assert!(!plain.files[0].is_submodule);
        let untracked = parse_porcelain_v2("? new.rs\0");
        assert!(!untracked.files[0].is_submodule);
    }

    #[test]
    fn submodule_marker_parsed_for_renamed_and_unmerged() {
        let renamed = parse_porcelain_v2(
            "2 R. S... 160000 160000 160000 aaaa bbbb R100 new/child\0old/child\0",
        );
        assert!(renamed.files[0].is_submodule);
        assert_eq!(renamed.files[0].path, "new/child");
        let unmerged = parse_porcelain_v2(
            "u UU S.U. 160000 160000 160000 160000 a b c conflict-child\0",
        );
        assert!(unmerged.files[0].is_submodule);
        assert_eq!(unmerged.files[0].path, "conflict-child");
    }

    #[test]
    fn submodule_status_lines_parse() {
        let clean = parse_submodule_status_line(" cae675 child (heads/main)").unwrap();
        assert_eq!(clean.flag, ' ');
        assert_eq!(clean.state(), "initialized");
        assert_eq!(clean.sha, "cae675");
        assert_eq!(clean.path, "child");
        assert_eq!(clean.describe.as_deref(), Some("heads/main"));

        let moved = parse_submodule_status_line("+b006145 child (heads/main)").unwrap();
        assert_eq!(moved.flag, '+');
        assert_eq!(moved.state(), "modified");

        let missing = parse_submodule_status_line("-cae675 child/inner").unwrap();
        assert_eq!(missing.flag, '-');
        assert_eq!(missing.state(), "uninitialized");
        assert_eq!(missing.path, "child/inner");
        assert_eq!(missing.describe, None);

        let conflict = parse_submodule_status_line("Ucae675 child").unwrap();
        assert_eq!(conflict.state(), "conflict");

        // Leading space is the "clean" flag, not padding.
        assert_eq!(
            parse_submodule_status_line(" 6e6980 nested/deep (heads/main)")
                .unwrap()
                .flag,
            ' '
        );
    }

    #[test]
    fn malformed_submodule_status_lines_are_rejected() {
        assert!(parse_submodule_status_line("").is_none());
        assert!(parse_submodule_status_line("no-space").is_none());
        assert!(parse_submodule_status_line(" sha-only").is_none());
        assert!(parse_submodule_status_line(" sha ").is_none());
    }

    #[test]
    fn path_with_parentheses_survives() {
        let parsed =
            parse_submodule_status_line(" 6a2240 my dir (old)/child (heads/main)").unwrap();
        assert_eq!(parsed.path, "my dir (old)/child");
        assert_eq!(parsed.describe.as_deref(), Some("heads/main"));
    }
}
