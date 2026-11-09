use std::path::PathBuf;

use portable_pty::CommandBuilder;

use crate::modules::control::ShellControlEnv;
use crate::modules::workspace::{self, WorkspaceEnv};

#[cfg(windows)]
const BASHRC_SCRIPT: &str = include_str!("scripts/bashrc.bash");
#[cfg(windows)]
const ZSHENV_SCRIPT: &str = include_str!("scripts/zshenv.zsh");
#[cfg(windows)]
const ZPROFILE_SCRIPT: &str = include_str!("scripts/zprofile.zsh");
#[cfg(windows)]
const ZLOGIN_SCRIPT: &str = include_str!("scripts/zlogin.zsh");
#[cfg(windows)]
const ZSHRC_SCRIPT: &str = include_str!("scripts/zshrc.zsh");
#[cfg(windows)]
const FISH_INIT_SCRIPT: &str = include_str!("scripts/init.fish");
const FISH_REINSTALL_PROMPT: &str =
    "functions -q __terax_install_prompt; and __terax_install_prompt";

#[cfg(windows)]
fn bashrc_script() -> &'static str {
    BASHRC_SCRIPT
}

#[cfg(windows)]
fn zshenv_script() -> &'static str {
    ZSHENV_SCRIPT
}

#[cfg(windows)]
fn zprofile_script() -> &'static str {
    ZPROFILE_SCRIPT
}

#[cfg(windows)]
fn zlogin_script() -> &'static str {
    ZLOGIN_SCRIPT
}

#[cfg(windows)]
fn zshrc_script() -> &'static str {
    ZSHRC_SCRIPT
}

#[cfg(windows)]
fn fish_init_script() -> &'static str {
    FISH_INIT_SCRIPT
}

pub fn build_command(
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    blocks: bool,
    shell: Option<String>,
    control: Option<ShellControlEnv>,
) -> Result<CommandBuilder, String> {
    let shell = sanitize_shell_override(shell);
    #[cfg(unix)]
    {
        let _ = workspace;
        unix::build(cwd, blocks, shell, control)
    }
    #[cfg(windows)]
    {
        windows::build(cwd, workspace, blocks, shell, control)
    }
}

/// Preserve the shell behind the WSL launcher for shell-specific input quoting.
pub fn launched_shell(cmd: &mut CommandBuilder) -> String {
    let program = cmd
        .get_argv()
        .first()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    if program.eq_ignore_ascii_case("wsl.exe") {
        let shell = cmd
            .get_env("TERAX_WSL_LOGIN_SHELL")
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        cmd.env_remove("TERAX_WSL_LOGIN_SHELL");
        shell
    } else {
        program
    }
}

#[cfg(test)]
mod launched_shell_tests {
    use super::*;

    #[test]
    fn wsl_preserves_the_resolved_shell_instead_of_the_launcher() {
        for shell in [
            "/usr/bin/pwsh",
            "/bin/bash",
            "/usr/bin/fish",
            "/usr/bin/unknown",
        ] {
            let mut cmd = CommandBuilder::new("wsl.exe");
            cmd.env("TERAX_WSL_LOGIN_SHELL", shell);
            assert_eq!(launched_shell(&mut cmd), shell);
            assert!(cmd.get_env("TERAX_WSL_LOGIN_SHELL").is_none());
        }
        let mut direct = CommandBuilder::new("powershell.exe");
        assert_eq!(launched_shell(&mut direct), "powershell.exe");
    }
}

// Honor the override only if it matches an enumerated shell, so a tampered
// setting can't spawn an arbitrary binary across the IPC boundary.
fn sanitize_shell_override(shell: Option<String>) -> Option<String> {
    let candidate = shell
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    let target = std::fs::canonicalize(&candidate).ok();
    let shells = list_shells();
    let allowed = shell_override_allowed(&candidate, target.as_deref(), &shells);
    if allowed {
        Some(candidate)
    } else {
        log::warn!("ignoring non-enumerated shell override '{candidate}'");
        None
    }
}

fn shell_override_allowed(
    candidate: &str,
    canonical_candidate: Option<&std::path::Path>,
    shells: &[ShellInfo],
) -> bool {
    shells.iter().any(|shell| {
        shell.id == candidate
            || shell.path == candidate
            || canonical_candidate.is_some_and(|target| {
                std::fs::canonicalize(&shell.path).is_ok_and(|path| path.as_path() == target)
            })
    })
}

pub fn detect_shell_name() -> String {
    #[cfg(unix)]
    {
        let (_, path) = unix::Shell::detect();
        path.rsplit('/').next().unwrap_or("").to_string()
    }
    #[cfg(windows)]
    {
        windows_shell_path()
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default()
    }
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct ShellInfo {
    /// Preference value. Built-in shells use the executable path so existing
    /// `terminalShell` settings keep matching. Windows Terminal profiles use
    /// `wt:{guid}`.
    pub id: String,
    pub name: String,
    pub path: String,
    /// True when Terax injects OSC 7/133 integration for this shell (cwd
    /// tracking, command blocks, agent detection). Others spawn bare.
    pub integrated: bool,
}

impl ShellInfo {
    fn builtin(name: impl Into<String>, path: impl Into<String>, integrated: bool) -> Self {
        let path = path.into();
        Self {
            id: path.clone(),
            name: name.into(),
            path,
            integrated,
        }
    }
}

pub fn list_shells() -> Vec<ShellInfo> {
    #[cfg(unix)]
    {
        unix::list_shells()
    }
    #[cfg(windows)]
    {
        windows::list_shells()
    }
}

fn ensure_utf8_locale(cmd: &mut CommandBuilder) {
    let is_utf8 = |v: &str| {
        let up = v.to_ascii_uppercase();
        up.contains("UTF-8") || up.contains("UTF8")
    };
    let already_utf8 = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .any(|k| std::env::var(k).ok().as_deref().is_some_and(is_utf8));
    if already_utf8 {
        return;
    }
    #[cfg(target_os = "macos")]
    let fallback = "en_US.UTF-8";
    #[cfg(all(unix, not(target_os = "macos")))]
    let fallback = "C.UTF-8";
    #[cfg(windows)]
    let fallback = "en_US.UTF-8";
    cmd.env("LANG", fallback);
}

fn apply_common(
    cmd: &mut CommandBuilder,
    cwd: Option<String>,
    blocks: bool,
    control: Option<&ShellControlEnv>,
) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERAX_TERMINAL", "1");
    // dsh-tui enables ConPTY DECSET 9001 (win32-input-mode) on Windows.
    // Terax does not implement that mode yet, so keep classic VT arrow keys.
    #[cfg(windows)]
    cmd.env("DSH_TUI_DISABLE_WIN32_INPUT_MODE", "1");
    if blocks {
        cmd.env("TERAX_BLOCKS", "1");
    }
    let appimage_overrides = workspace::appimage_env_overrides();
    let clean_path = match appimage_overrides.iter().find(|(key, _)| *key == "PATH") {
        Some((_, value)) => value.clone(),
        None => std::env::var_os("PATH"),
    };
    for (key, value) in appimage_overrides {
        match value {
            Some(v) => {
                cmd.env(key, v);
            }
            None => {
                cmd.env_remove(key);
            }
        }
    }
    if let Some(control) = control {
        cmd.env("TERAX_CONTROL_ADDR", &control.address);
        cmd.env("TERAX_CONTROL_TOKEN", &control.token);
        cmd.env("TERAX_PANE_ID", control.pane_id.to_string());
        if let Some(path) = &control.cli_path {
            cmd.env("TERAX_CLI", path);
        }
        if let Some(bin_dir) = &control.cli_bin_dir {
            let paths = std::iter::once(bin_dir.clone()).chain(
                clean_path
                    .as_deref()
                    .into_iter()
                    .flat_map(std::env::split_paths),
            );
            if let Ok(path) = std::env::join_paths(paths) {
                cmd.env("PATH", path);
            }
        }
    }
    ensure_utf8_locale(cmd);

    let resolved_cwd = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| workspace::launch_cwd_snapshot().filter(|p| p.is_dir()))
        .or_else(|| dirs::home_dir().filter(|p| p.is_dir()));
    if let Some(cwd) = resolved_cwd {
        #[cfg(windows)]
        let cwd = PathBuf::from(cwd.to_string_lossy().replace('/', "\\"));
        log::info!("pty cwd: {}", cwd.display());
        cmd.cwd(cwd);
    } else {
        log::warn!("pty cwd: no usable directory, inheriting from process");
    }
}

#[cfg(unix)]
mod unix {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use portable_pty::CommandBuilder;

    const ZSHENV: &str = include_str!("scripts/zshenv.zsh");
    const ZPROFILE: &str = include_str!("scripts/zprofile.zsh");
    const ZLOGIN: &str = include_str!("scripts/zlogin.zsh");
    const ZSHRC: &str = include_str!("scripts/zshrc.zsh");
    const BASHRC: &str = include_str!("scripts/bashrc.bash");
    const FISH_INIT: &str = include_str!("scripts/init.fish");

    pub enum Shell {
        Zsh,
        Bash,
        Fish,
        Other,
    }

    impl Shell {
        pub fn classify(path: &str) -> Shell {
            match path.rsplit('/').next().unwrap_or("") {
                "zsh" => Shell::Zsh,
                "bash" => Shell::Bash,
                "fish" => Shell::Fish,
                _ => Shell::Other,
            }
        }

        pub fn detect() -> (Shell, String) {
            let path = login_shell()
                .or_else(|| std::env::var("SHELL").ok())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "/bin/zsh".into());
            (Self::classify(&path), path)
        }

        // A configured override wins only when it points at a real file;
        // otherwise fall back to the user's login shell.
        pub fn resolve(shell_override: Option<String>) -> (Shell, String) {
            if let Some(path) = shell_override
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
            {
                if Path::new(&path).is_file() {
                    return (Self::classify(&path), path);
                }
                log::warn!("configured shell '{path}' not found, using auto-detect");
            }
            Self::detect()
        }
    }

    fn login_shell() -> Option<String> {
        use std::ffi::CStr;
        unsafe {
            let uid = libc::getuid();
            let pw = libc::getpwuid(uid);
            if pw.is_null() {
                return None;
            }
            let shell_ptr = (*pw).pw_shell;
            if shell_ptr.is_null() {
                return None;
            }
            CStr::from_ptr(shell_ptr).to_str().ok().map(String::from)
        }
    }

    pub fn list_shells() -> Vec<super::ShellInfo> {
        use std::collections::HashSet;
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        let (_, login) = Shell::detect();
        let mut candidates = vec![login];
        if let Ok(content) = fs::read_to_string("/etc/shells") {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                candidates.push(line.to_string());
            }
        }
        for path in candidates {
            if !seen.insert(path.clone()) || !Path::new(&path).is_file() {
                continue;
            }
            let integrated = !matches!(Shell::classify(&path), Shell::Other);
            let name = path.rsplit('/').next().unwrap_or(&path).to_string();
            out.push(super::ShellInfo::builtin(name, path, integrated));
        }
        out
    }

    pub fn build(
        cwd: Option<String>,
        blocks: bool,
        shell_override: Option<String>,
        control: Option<super::ShellControlEnv>,
    ) -> Result<CommandBuilder, String> {
        let (shell, shell_path) = Shell::resolve(shell_override);
        let mut cmd = CommandBuilder::new(&shell_path);
        super::apply_common(&mut cmd, cwd, blocks, control.as_ref());
        apply_shell_init(&mut cmd, &shell, &shell_path);
        Ok(cmd)
    }

    /// What the child zsh gets as `TERAX_USER_ZDOTDIR`.
    #[derive(Debug, PartialEq, Eq)]
    enum UserZdotdir {
        /// The inherited `ZDOTDIR` is the user's own.
        Set(String),
        /// This app was started from a zsh that Terax integrated: `ZDOTDIR` is
        /// the integration directory and the inherited variable still names
        /// the user's.
        Keep,
        /// No `ZDOTDIR`: a left-over value must not outlive what it described.
        Clear,
    }

    fn user_zdotdir_for(inherited_zdotdir: Option<&str>, integration: &Path) -> UserZdotdir {
        match inherited_zdotdir.filter(|value| !value.is_empty()) {
            Some(user) if Path::new(user) != integration => UserZdotdir::Set(user.to_string()),
            Some(_) => UserZdotdir::Keep,
            None => UserZdotdir::Clear,
        }
    }

    fn apply_shell_init(cmd: &mut CommandBuilder, shell: &Shell, shell_path: &str) {
        match shell {
            Shell::Zsh => {
                match prepare_zdotdir() {
                    Ok(zdotdir) => {
                        // Guard against Terax-in-Terax :)
                        match user_zdotdir_for(std::env::var("ZDOTDIR").ok().as_deref(), &zdotdir) {
                            UserZdotdir::Set(user) => {
                                cmd.env("TERAX_USER_ZDOTDIR", user);
                            }
                            UserZdotdir::Keep => {}
                            UserZdotdir::Clear => {
                                cmd.env_remove("TERAX_USER_ZDOTDIR");
                            }
                        }
                        cmd.env("ZDOTDIR", &zdotdir);
                    }
                    Err(e) => {
                        log::warn!("zsh shell integration disabled: {e}");
                    }
                }
                // Login shell so /etc/zprofile runs path_helper on macOS — without
                // this, GUI-launched apps get a minimal PATH missing Homebrew.
                cmd.arg("-l");
            }
            Shell::Bash => {
                match prepare_bash_rcfile() {
                    Ok(rc) => {
                        cmd.arg("--rcfile");
                        cmd.arg(rc);
                    }
                    Err(e) => {
                        log::warn!("bash shell integration disabled: {e}");
                    }
                }
                // bash ignores --rcfile under -l, so we use -i and source
                // /etc/profile from inside our rcfile to emulate login init.
                cmd.arg("-i");
            }
            Shell::Fish => {
                if let Err(e) = prepare_fish_conf_d() {
                    log::warn!("fish shell integration disabled: {e}");
                }
                // fish 4.0+ writes its own OSC 133 A/B; ours would double it.
                cmd.env("fish_features", "no-mark-prompt");
                cmd.arg("-i");
                // Re-assert our prompt after config.fish (-C runs last), so a
                // framework prompt (starship etc.) loaded there can't override
                // the markers and break cwd tracking.
                cmd.arg("-C");
                cmd.arg(super::FISH_REINSTALL_PROMPT);
            }
            Shell::Other => {
                log::info!(
                    "unsupported shell '{}', spawning without integration",
                    shell_path
                );
            }
        }
    }

    fn integration_root() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
        let root = home.join(".cache").join("terax").join("shell-integration");
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        Ok(root)
    }

    fn prepare_zdotdir() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("zsh");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        write_if_changed(&dir.join(".zshenv"), ZSHENV)?;
        write_if_changed(&dir.join(".zprofile"), ZPROFILE)?;
        write_if_changed(&dir.join(".zshrc"), ZSHRC)?;
        write_if_changed(&dir.join(".zlogin"), ZLOGIN)?;
        Ok(dir)
    }

    fn prepare_bash_rcfile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("bash");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let rc = dir.join("bashrc");
        write_if_changed(&rc, BASHRC)?;
        Ok(rc)
    }

    fn prepare_fish_conf_d() -> Result<(), String> {
        let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
        let dir = home.join(".config").join("fish").join("conf.d");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        write_if_changed(&dir.join("terax.fish"), FISH_INIT)?;
        Ok(())
    }

    fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
        // Atomic replace: a parallel shell startup must never source a half-written file.
        let mut tmp: OsString = path.as_os_str().to_owned();
        tmp.push(".__terax_tmp__");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename {} -> {}: {e}", tmp.display(), path.display())
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn classify_maps_known_shells() {
            assert!(matches!(Shell::classify("/bin/zsh"), Shell::Zsh));
            assert!(matches!(Shell::classify("/usr/bin/bash"), Shell::Bash));
            assert!(matches!(
                Shell::classify("/opt/homebrew/bin/fish"),
                Shell::Fish
            ));
            assert!(matches!(Shell::classify("/bin/sh"), Shell::Other));
            assert!(matches!(Shell::classify("/usr/bin/nu"), Shell::Other));
        }

        #[test]
        fn resolve_uses_an_existing_override() {
            let exe = std::env::current_exe().unwrap();
            let path = exe.to_string_lossy().into_owned();
            let (_, resolved) = Shell::resolve(Some(path.clone()));
            assert_eq!(resolved, path);
        }

        #[test]
        fn resolve_falls_back_when_override_missing() {
            let (_, path) = Shell::resolve(Some("/no/such/shell/xyz".into()));
            assert!(!path.is_empty());
            assert_ne!(path, "/no/such/shell/xyz");
        }

        #[test]
        fn resolve_falls_back_on_empty_override() {
            let (_, fallback) = Shell::resolve(Some("   ".into()));
            let (_, detected) = Shell::detect();
            assert_eq!(fallback, detected);
        }

        #[test]
        fn the_users_zdotdir_survives_a_terax_started_from_an_integrated_zsh() {
            let integration = Path::new("/cache/terax/shell-integration/zsh");
            assert_eq!(
                user_zdotdir_for(Some("/home/me/.config/zsh"), integration),
                UserZdotdir::Set("/home/me/.config/zsh".into())
            );
            // Launched by a command in another Terax terminal: keep the
            // TERAX_USER_ZDOTDIR it inherited.
            assert_eq!(
                user_zdotdir_for(Some("/cache/terax/shell-integration/zsh"), integration),
                UserZdotdir::Keep
            );
            assert_eq!(user_zdotdir_for(None, integration), UserZdotdir::Clear);
            assert_eq!(user_zdotdir_for(Some(""), integration), UserZdotdir::Clear);
        }

        #[test]
        fn zsh_starts_from_the_integration_dir_and_forgets_a_stale_user_zdotdir() {
            let mut cmd = CommandBuilder::new("/bin/zsh");
            cmd.env("TERAX_USER_ZDOTDIR", "/left/over/from/a/parent/terminal");
            apply_shell_init(&mut cmd, &Shell::Zsh, "/bin/zsh");
            let zdotdir = cmd.get_env("ZDOTDIR").expect("ZDOTDIR is set");
            assert!(Path::new(zdotdir).ends_with("shell-integration/zsh"));
            assert!(cmd.get_argv().iter().any(|arg| arg == "-l"));
            match std::env::var("ZDOTDIR") {
                Ok(user) if !user.is_empty() && Path::new(&user) != Path::new(zdotdir) => {
                    assert_eq!(
                        cmd.get_env("TERAX_USER_ZDOTDIR"),
                        Some(std::ffi::OsStr::new(&user))
                    );
                }
                _ => assert_eq!(cmd.get_env("TERAX_USER_ZDOTDIR"), None),
            }
            for file in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
                assert!(Path::new(zdotdir).join(file).is_file(), "{file}");
            }
        }

        #[test]
        fn builds_unix_fish_launch_with_post_config_rewrap() {
            let mut cmd = CommandBuilder::new("/usr/bin/fish");
            apply_shell_init(&mut cmd, &Shell::Fish, "/usr/bin/fish");
            let argv: Vec<_> = cmd
                .get_argv()
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            assert_eq!(
                argv,
                vec![
                    "/usr/bin/fish".to_string(),
                    "-i".to_string(),
                    "-C".to_string(),
                    super::super::FISH_REINSTALL_PROMPT.to_string(),
                ]
            );
        }
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use crate::modules::workspace::WorkspaceEnv;
    use portable_pty::CommandBuilder;

    const PROFILE_PS1: &str = include_str!("scripts/profile.ps1");

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum ShellKind {
        Zsh,
        Bash,
        Fish,
        Other,
    }

    impl ShellKind {
        fn from_path(path: &str) -> Self {
            match path.rsplit('/').next().unwrap_or("") {
                "zsh" => Self::Zsh,
                "bash" => Self::Bash,
                "fish" => Self::Fish,
                _ => Self::Other,
            }
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    enum WslShellIntegration {
        Zsh {
            zdotdir: String,
            user_zdotdir: Option<String>,
        },
        Bash {
            rcfile: String,
        },
        Fish,
        None,
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    struct WslLaunchSpec {
        args: Vec<String>,
    }

    pub fn build(
        cwd: Option<String>,
        workspace: WorkspaceEnv,
        blocks: bool,
        shell: Option<String>,
        control: Option<super::ShellControlEnv>,
    ) -> Result<CommandBuilder, String> {
        if let WorkspaceEnv::Wsl { distro } = workspace {
            let _ = (blocks, shell, control);
            return build_wsl(cwd, distro);
        }
        if let Some(launch) = shell.as_deref().and_then(wt_profiles::resolve_launch) {
            let mut cmd = CommandBuilder::new(&launch.program);
            // Bare: a Windows Terminal commandline already carries its own
            // flags, and Terax's profile/-rcfile injection would collide.
            super::apply_common(&mut cmd, cwd, false, control.as_ref());
            for arg in &launch.args {
                cmd.arg(arg);
            }
            log::info!(
                "spawning Windows Terminal profile '{}' via {}",
                launch.name,
                launch.program.display()
            );
            return Ok(cmd);
        }
        let shell_path = shell
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .unwrap_or_else(super::windows_shell_path);
        let shell_name = shell_path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let is_powershell = shell_name == "pwsh.exe" || shell_name == "powershell.exe";
        let is_bash = shell_name == "bash.exe";
        let is_cmd = shell_name == "cmd.exe";

        let mut cmd = CommandBuilder::new(&shell_path);
        super::apply_common(&mut cmd, cwd, blocks, control.as_ref());

        if is_cmd {
            let host = std::env::var("COMPUTERNAME").unwrap_or_default();
            let existing = std::env::var("PROMPT").ok();
            cmd.env("PROMPT", super::cmd_prompt(&host, existing.as_deref()));
        }

        if is_powershell {
            match prepare_ps_profile() {
                Ok(profile) => {
                    cmd.arg("-NoLogo");
                    cmd.arg("-NoExit");
                    cmd.arg("-ExecutionPolicy");
                    cmd.arg("Bypass");
                    cmd.arg("-File");
                    cmd.arg(profile);
                }
                Err(e) => {
                    log::warn!("powershell shell integration disabled: {e}");
                }
            }
        } else if is_bash {
            // git-bash's /etc/profile cd's to $HOME unless CHERE_INVOKING is
            // set; keep the cwd we configured in apply_common.
            cmd.env("CHERE_INVOKING", "1");
            // Native git-bash: same OSC 7/133 rcfile as Unix bash, in the
            // forward-slash form MSYS bash accepts.
            match prepare_bash_rcfile() {
                Ok(rc) => {
                    cmd.arg("--rcfile");
                    cmd.arg(rc.to_string_lossy().replace('\\', "/"));
                    cmd.arg("-i");
                }
                Err(e) => {
                    log::warn!("bash shell integration disabled: {e}");
                }
            }
        } else {
            log::info!("spawning {} without shell integration", shell_name);
        }

        log::info!("spawning Windows shell: {}", shell_path.display());
        Ok(cmd)
    }

    fn build_wsl(cwd: Option<String>, distro: String) -> Result<CommandBuilder, String> {
        crate::modules::workspace::validate_wsl_distro_name(&distro)?;
        let shell_path = crate::modules::workspace::wsl_login_shell(distro.clone())?;
        let shell_kind = ShellKind::from_path(&shell_path);
        let integration = match shell_kind {
            ShellKind::Zsh => match prepare_wsl_zdotdir(&distro) {
                Ok(zdotdir) => {
                    let user_zdotdir = match probe_wsl_zdotdir(&distro, &shell_path) {
                        Ok(path) if !path.is_empty() && path != zdotdir => Some(path),
                        Ok(_) => None,
                        Err(e) => {
                            log::warn!("WSL zsh ZDOTDIR probe failed for {distro}: {e}");
                            None
                        }
                    };
                    WslShellIntegration::Zsh {
                        zdotdir,
                        user_zdotdir,
                    }
                }
                Err(e) => {
                    log::warn!("WSL zsh shell integration disabled for {distro}: {e}");
                    WslShellIntegration::None
                }
            },
            ShellKind::Bash => match prepare_wsl_bash_rcfile(&distro) {
                Ok(rcfile) => WslShellIntegration::Bash { rcfile },
                Err(e) => {
                    log::warn!("WSL bash shell integration disabled for {distro}: {e}");
                    WslShellIntegration::None
                }
            },
            ShellKind::Fish => match prepare_wsl_fish_conf_d(&distro) {
                Ok(()) => WslShellIntegration::Fish,
                Err(e) => {
                    log::warn!("WSL fish shell integration disabled for {distro}: {e}");
                    WslShellIntegration::None
                }
            },
            ShellKind::Other => {
                log::info!(
                    "unsupported WSL shell '{}', spawning without integration",
                    shell_path
                );
                WslShellIntegration::None
            }
        };
        let spec = build_wsl_launch_spec(
            cwd.as_deref(),
            &distro,
            &shell_path,
            shell_kind,
            integration,
        );
        let mut cmd = CommandBuilder::new("wsl.exe");
        cmd.env("TERAX_WSL_LOGIN_SHELL", &shell_path);
        for arg in &spec.args {
            cmd.arg(arg);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERAX_TERMINAL", "1");
        super::ensure_utf8_locale(&mut cmd);
        log::info!("spawning WSL shell: {distro} ({shell_path})");
        Ok(cmd)
    }

    fn build_wsl_launch_spec(
        cwd: Option<&str>,
        distro: &str,
        shell_path: &str,
        shell_kind: ShellKind,
        integration: WslShellIntegration,
    ) -> WslLaunchSpec {
        let mut args = vec![
            "-d".to_string(),
            distro.to_string(),
            "--cd".to_string(),
            cwd.filter(|s| !s.is_empty()).unwrap_or("~").to_string(),
            "--exec".to_string(),
        ];
        match (shell_kind, integration) {
            (
                ShellKind::Zsh,
                WslShellIntegration::Zsh {
                    zdotdir,
                    user_zdotdir,
                },
            ) => {
                args.push("env".to_string());
                if let Some(user_zdotdir) = user_zdotdir {
                    args.push(format!("TERAX_USER_ZDOTDIR={user_zdotdir}"));
                }
                args.push(format!("ZDOTDIR={zdotdir}"));
                args.push(shell_path.to_string());
                args.push("-l".to_string());
            }
            (ShellKind::Bash, WslShellIntegration::Bash { rcfile }) => {
                args.push(shell_path.to_string());
                args.push("--rcfile".to_string());
                args.push(rcfile);
                args.push("-i".to_string());
            }
            (ShellKind::Fish, WslShellIntegration::Fish) => {
                args.push("env".to_string());
                args.push("fish_features=no-mark-prompt".to_string());
                args.push(shell_path.to_string());
                args.push("-i".to_string());
                args.push("-C".to_string());
                args.push(super::FISH_REINSTALL_PROMPT.to_string());
            }
            (ShellKind::Zsh, WslShellIntegration::None) => {
                args.push(shell_path.to_string());
                args.push("-l".to_string());
            }
            (ShellKind::Bash, WslShellIntegration::None)
            | (ShellKind::Fish, WslShellIntegration::None) => {
                args.push(shell_path.to_string());
                args.push("-i".to_string());
            }
            (ShellKind::Other, _) => args.push(shell_path.to_string()),
            _ => {
                args.push(shell_path.to_string());
            }
        }
        WslLaunchSpec { args }
    }

    fn probe_wsl_zdotdir(distro: &str, shell_path: &str) -> Result<String, String> {
        let out = crate::modules::workspace::wsl_exec_capture(
            distro,
            shell_path,
            &["-c", r#"printf %s "${ZDOTDIR:-$HOME}""#],
        )?;
        Ok(crate::modules::workspace::normalize_wsl_value(out, ""))
    }

    fn prepare_wsl_integration_dir(distro: &str, shell: &str) -> Result<(String, PathBuf), String> {
        let home = crate::modules::workspace::wsl_home(distro.to_string())?;
        let linux_dir = format!(
            "{}/.cache/terax/shell-integration/{shell}",
            home.trim_end_matches('/')
        );
        let unc_dir = crate::modules::workspace::wsl_path_to_unc(distro, &linux_dir);
        fs::create_dir_all(&unc_dir).map_err(|e| format!("create {}: {e}", unc_dir.display()))?;
        Ok((linux_dir, unc_dir))
    }

    fn normalize_script(content: &str) -> String {
        content.replace("\r\n", "\n")
    }

    fn prepare_wsl_zdotdir(distro: &str) -> Result<String, String> {
        let (linux_dir, unc_dir) = prepare_wsl_integration_dir(distro, "zsh")?;
        write_if_changed(
            &unc_dir.join(".zshenv"),
            &normalize_script(super::zshenv_script()),
        )?;
        write_if_changed(
            &unc_dir.join(".zprofile"),
            &normalize_script(super::zprofile_script()),
        )?;
        write_if_changed(
            &unc_dir.join(".zshrc"),
            &normalize_script(super::zshrc_script()),
        )?;
        write_if_changed(
            &unc_dir.join(".zlogin"),
            &normalize_script(super::zlogin_script()),
        )?;
        Ok(linux_dir)
    }

    fn prepare_wsl_bash_rcfile(distro: &str) -> Result<String, String> {
        let (linux_dir, _unc_dir) = prepare_wsl_integration_dir(distro, "bash")?;
        let linux_rc = format!("{linux_dir}/bashrc");
        let unc_file = crate::modules::workspace::wsl_path_to_unc(distro, &linux_rc);
        let content = normalize_script(super::bashrc_script());
        write_if_changed(&unc_file, &content)?;
        Ok(linux_rc)
    }

    fn prepare_wsl_fish_conf_d(distro: &str) -> Result<(), String> {
        let home = crate::modules::workspace::wsl_home(distro.to_string())?;
        let linux_dir = format!("{}/.config/fish/conf.d", home.trim_end_matches('/'));
        let unc_dir = crate::modules::workspace::wsl_path_to_unc(distro, &linux_dir);
        fs::create_dir_all(&unc_dir).map_err(|e| format!("create {}: {e}", unc_dir.display()))?;
        let unc_file = unc_dir.join("terax.fish");
        let content = normalize_script(super::fish_init_script());
        write_if_changed(&unc_file, &content)?;
        Ok(())
    }

    fn integration_root() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
        let root = home.join(".cache").join("terax").join("shell-integration");
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        Ok(root)
    }

    fn prepare_ps_profile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("powershell");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let file = dir.join("profile.ps1");
        write_if_changed(&file, PROFILE_PS1)?;
        Ok(file)
    }

    fn prepare_bash_rcfile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("bash");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let rc = dir.join("bashrc");
        write_if_changed(&rc, &normalize_script(super::bashrc_script()))?;
        Ok(rc)
    }

    pub fn list_shells() -> Vec<super::ShellInfo> {
        fn add(out: &mut Vec<super::ShellInfo>, name: &str, path: PathBuf, integrated: bool) {
            if path.is_file() {
                out.push(super::ShellInfo::builtin(
                    name,
                    path.to_string_lossy().into_owned(),
                    integrated,
                ));
            }
        }

        let mut out = Vec::new();
        if let Some(p) = super::which_in_path("pwsh.exe") {
            add(&mut out, "PowerShell", p, true);
        } else if let Some(pf) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
            add(
                &mut out,
                "PowerShell",
                pf.join("PowerShell").join("7").join("pwsh.exe"),
                true,
            );
        }
        let system32 = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("System32");
        add(
            &mut out,
            "Windows PowerShell",
            system32
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe"),
            true,
        );
        add(&mut out, "Command Prompt", system32.join("cmd.exe"), false);
        if let Some(p) = git_bash_path() {
            add(&mut out, "Git Bash", p, true);
        }
        let builtins: Vec<PathBuf> = out.iter().map(|shell| PathBuf::from(&shell.path)).collect();
        out.extend(wt_profiles::list_profiles(&builtins));
        out
    }

    fn git_bash_path() -> Option<PathBuf> {
        // Git for Windows install locations only. A bash.exe on PATH is usually
        // the WSL launcher in System32, which is the separate WSL switcher.
        for var in ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"] {
            if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
                for rel in [
                    r"Git\bin\bash.exe",
                    r"Git\usr\bin\bash.exe",
                    r"Programs\Git\bin\bash.exe",
                ] {
                    let candidate = base.join(rel);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
        None
    }

    fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
        let mut tmp: OsString = path.as_os_str().to_owned();
        tmp.push(".__terax_tmp__");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename {} -> {}: {e}", tmp.display(), path.display())
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn builds_wsl_zsh_launch_spec_with_env_and_login() {
            let spec = build_wsl_launch_spec(
                Some("/home/vinicios/repo"),
                "Ubuntu",
                "/usr/bin/zsh",
                ShellKind::Zsh,
                WslShellIntegration::Zsh {
                    zdotdir: "/home/vinicios/.cache/terax/shell-integration/zsh".into(),
                    user_zdotdir: None,
                },
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "/home/vinicios/repo".to_string(),
                    "--exec".to_string(),
                    "env".to_string(),
                    "ZDOTDIR=/home/vinicios/.cache/terax/shell-integration/zsh".to_string(),
                    "/usr/bin/zsh".to_string(),
                    "-l".to_string(),
                ]
            );
        }

        #[test]
        fn builds_wsl_zsh_launch_spec_with_user_zdotdir_probe() {
            let spec = build_wsl_launch_spec(
                Some("/home/vinicios/repo"),
                "Ubuntu",
                "/usr/bin/zsh",
                ShellKind::Zsh,
                WslShellIntegration::Zsh {
                    zdotdir: "/home/vinicios/.cache/terax/shell-integration/zsh".into(),
                    user_zdotdir: Some("/home/vinicios/.config/zsh".into()),
                },
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "/home/vinicios/repo".to_string(),
                    "--exec".to_string(),
                    "env".to_string(),
                    "TERAX_USER_ZDOTDIR=/home/vinicios/.config/zsh".to_string(),
                    "ZDOTDIR=/home/vinicios/.cache/terax/shell-integration/zsh".to_string(),
                    "/usr/bin/zsh".to_string(),
                    "-l".to_string(),
                ]
            );
        }

        #[test]
        fn builds_wsl_zsh_launch_spec_without_integration_still_uses_login_shell() {
            let spec = build_wsl_launch_spec(
                Some("/home/vinicios/repo"),
                "Ubuntu",
                "/usr/bin/zsh",
                ShellKind::Zsh,
                WslShellIntegration::None,
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "/home/vinicios/repo".to_string(),
                    "--exec".to_string(),
                    "/usr/bin/zsh".to_string(),
                    "-l".to_string(),
                ]
            );
        }

        #[test]
        fn builds_wsl_bash_launch_spec_with_rcfile() {
            let spec = build_wsl_launch_spec(
                Some("/home/vinicios/repo"),
                "Ubuntu",
                "/bin/bash",
                ShellKind::Bash,
                WslShellIntegration::Bash {
                    rcfile: "/home/vinicios/.cache/terax/shell-integration/bash/bashrc".into(),
                },
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "/home/vinicios/repo".to_string(),
                    "--exec".to_string(),
                    "/bin/bash".to_string(),
                    "--rcfile".to_string(),
                    "/home/vinicios/.cache/terax/shell-integration/bash/bashrc".to_string(),
                    "-i".to_string(),
                ]
            );
        }

        #[test]
        fn builds_wsl_fish_launch_spec_without_init_command() {
            let spec = build_wsl_launch_spec(
                Some("/home/vinicios/repo"),
                "Ubuntu",
                "/usr/bin/fish",
                ShellKind::Fish,
                WslShellIntegration::Fish,
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "/home/vinicios/repo".to_string(),
                    "--exec".to_string(),
                    "env".to_string(),
                    "fish_features=no-mark-prompt".to_string(),
                    "/usr/bin/fish".to_string(),
                    "-i".to_string(),
                    "-C".to_string(),
                    super::super::FISH_REINSTALL_PROMPT.to_string(),
                ]
            );
        }

        #[test]
        fn builds_wsl_other_shell_without_integration() {
            let spec = build_wsl_launch_spec(
                None,
                "Ubuntu",
                "/usr/bin/nu",
                ShellKind::Other,
                WslShellIntegration::None,
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "~".to_string(),
                    "--exec".to_string(),
                    "/usr/bin/nu".to_string(),
                ]
            );
        }

        #[cfg(windows)]
        #[test]
        fn imports_safe_windows_terminal_profiles_and_skips_the_rest() {
            fn json_path(path: String) -> String {
                serde_json::to_string(&path).unwrap()
            }
            let cmd = json_path(
                std::env::var("SystemRoot")
                    .map(|root| format!(r"{root}\System32\cmd.exe"))
                    .unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".to_string()),
            );
            let powershell = json_path(
                std::env::var("SystemRoot")
                    .map(|root| format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe"))
                    .unwrap_or_else(|_| {
                        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe".to_string()
                    }),
            );
            let wsl_bad = json_path(format!(
                "{} --distribution ..\\evil",
                std::env::var("SystemRoot")
                    .map(|root| format!(r"{root}\System32\wsl.exe"))
                    .unwrap_or_else(|_| r"C:\Windows\System32\wsl.exe".to_string())
            ));
            let wsl_ok = json_path(format!(
                "{} -d Ubuntu-22.04",
                std::env::var("SystemRoot")
                    .map(|root| format!(r"{root}\System32\wsl.exe"))
                    .unwrap_or_else(|_| r"C:\Windows\System32\wsl.exe".to_string())
            ));
            let settings = r#"{
                    "profiles": { "list": [
                        { "guid": "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}", "name": "Windows PowerShell",
                           "commandline": "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo" },
                        { "guid": "{0caa0dad-35be-5f56-a8ff-afceeeaa6101}", "name": "Command Prompt",
                           "commandline": "%SystemRoot%\\System32\\cmd.exe" },
                        { "guid": "{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}", "name": "Dangerous cmd",
                           "commandline": __CMD_C__ },
                        { "guid": "{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb}", "name": "Encoded",
                           "commandline": __POWERSHELL_ENC__ },
                        { "guid": "{cccccccc-cccc-cccc-cccc-cccccccccccc}", "name": "Unknown",
                           "commandline": "C:\\no\\such\\thing.exe" },
                        { "guid": "{dddddddd-dddd-dddd-dddd-dddddddddddd}", "name": "Azure",
                           "source": "Windows.Terminal.Azure", "hidden": false },
                        { "guid": "{eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee}", "name": "Hidden cmd",
                           "hidden": true, "commandline": __CMD__ },
                        { "guid": "{ffffffff-ffff-ffff-ffff-ffffffffffff}", "name": "Git Bash",
                           "source": "Git" }
                    ] }
                }"#
            .replace(
                "__CMD_C__",
                &json_path(format!(
                    "{} /c calc.exe",
                    std::env::var("SystemRoot")
                        .map(|root| format!(r"{root}\System32\cmd.exe"))
                        .unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".to_string())
                )),
            )
            .replace(
                "__POWERSHELL_ENC__",
                &json_path(format!(
                    "{} -EncodedCommand QQ==",
                    std::env::var("SystemRoot")
                        .map(|root| {
                            format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe")
                        })
                        .unwrap_or_else(|_| {
                            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe".to_string()
                        })
                )),
            )
            .replace("__CMD__", &cmd)
            .replace("__POWERSHELL__", &powershell);
            let git = r#"{ "profiles": [ { "guid": "{ffffffff-ffff-ffff-ffff-ffffffffffff}", "name": "Git Bash", "commandline": __CMD__ } ] }"#
                .replace("__CMD__", &cmd);
            let wsl_fragment = r#"{ "profiles": [ { "updates": "{dddddddd-dddd-dddd-dddd-dddddddddddd}", "hidden": true }, { "guid": "{12121212-1212-1212-1212-121212121212}", "name": "Ubuntu", "commandline": __WSL_OK__ }, { "guid": "{34343434-3434-3434-3434-343434343434}", "name": "Bad distro", "commandline": __WSL_BAD__ } ] }"#
                .replace("__WSL_OK__", &wsl_ok)
                .replace("__WSL_BAD__", &wsl_bad);
            let (shells, skipped) =
                wt_profiles::profiles_from(&settings, &[&git, &wsl_fragment], &[]);
            let ids: Vec<&str> = shells.iter().map(|shell| shell.id.as_str()).collect();
            assert_eq!(
                ids,
                vec![
                    "wt:0caa0dad-35be-5f56-a8ff-afceeeaa6101",
                    "wt:12121212-1212-1212-1212-121212121212",
                    "wt:61c54bbd-c2c6-5271-96e7-009a87ff44bf",
                    "wt:ffffffff-ffff-ffff-ffff-ffffffffffff",
                ],
                "skipped={skipped:?}"
            );
            assert!(shells.iter().all(|shell| !shell.integrated));
            let powershell = wt_profiles::launch_from(
                &settings,
                &[&git, &wsl_fragment],
                "wt:{61c54bbd-c2c6-5271-96e7-009a87ff44bf}",
            )
            .expect("powershell profile");
            assert_eq!(powershell.args, vec!["-NoLogo".to_string()]);
            assert!(powershell
                .program
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("powershell.exe")));
            assert!(wt_profiles::launch_from(
                &settings,
                &[],
                "wt:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
            )
            .is_none());
            assert!(wt_profiles::launch_from(&settings, &[], "wt:missing").is_none());
        }

        #[cfg(windows)]
        #[test]
        fn skips_windows_terminal_profiles_that_duplicate_builtin_shells() {
            let cmd = std::env::var("SystemRoot")
                .map(|root| format!(r"{root}\System32\cmd.exe"))
                .unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".to_string());
            let powershell = std::env::var("SystemRoot")
                .map(|root| format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe"))
                .unwrap_or_else(|_| {
                    r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe".to_string()
                });
            let wsl = std::env::var("SystemRoot")
                .map(|root| format!(r"{root}\System32\wsl.exe"))
                .unwrap_or_else(|_| r"C:\Windows\System32\wsl.exe".to_string());
            let settings = format!(
                r#"{{
                    "profiles": {{ "list": [
                        {{ "guid": "{{0caa0dad-35be-5f56-a8ff-afceeeaa6101}}", "name": "命令提示符",
                           "commandline": {cmd} }},
                        {{ "guid": "{{61c54bbd-c2c6-5271-96e7-009a87ff44bf}}", "name": "Windows PowerShell",
                           "commandline": {powershell} }},
                        {{ "guid": "{{12121212-1212-1212-1212-121212121212}}", "name": "Ubuntu",
                           "commandline": {wsl} }},
                        {{ "guid": "{{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}}", "name": "PowerShell no logo",
                           "commandline": {powershell_flag} }}
                    ] }}
                }}"#,
                cmd = serde_json::to_string(&cmd).unwrap(),
                powershell = serde_json::to_string(&powershell).unwrap(),
                wsl = serde_json::to_string(&format!(r#"{wsl} -d Ubuntu"#)).unwrap(),
                powershell_flag = serde_json::to_string(&format!("{powershell} -NoLogo")).unwrap(),
            );
            let builtins = [PathBuf::from(&cmd), PathBuf::from(&powershell)];
            let (shells, _) = wt_profiles::profiles_from(&settings, &[], &builtins);
            let ids: Vec<&str> = shells.iter().map(|shell| shell.id.as_str()).collect();
            assert_eq!(
                ids,
                vec![
                    "wt:12121212-1212-1212-1212-121212121212",
                    "wt:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                ]
            );
        }
    }
    /// Windows Terminal profiles imported as bare PTY shells. The commandline
    /// is re-read and re-checked on every list and every spawn; nothing the
    /// frontend stores is executed.
    mod wt_profiles {
        use std::collections::BTreeMap;
        use std::path::{Path, PathBuf};

        use serde::Deserialize;

        const WT_ID_PREFIX: &str = "wt:";
        const POWERSHELL_FLAGS: &[&str] = &["-NoLogo", "-NoProfile", "-NoExit"];
        const BASH_FLAGS: &[&str] = &["-i", "-l", "--login"];

        #[derive(Clone, Debug, PartialEq, Eq)]
        pub(super) struct Launch {
            pub(super) name: String,
            pub(super) program: PathBuf,
            pub(super) args: Vec<String>,
        }

        #[derive(Deserialize)]
        struct SettingsFile {
            profiles: Option<Profiles>,
        }

        #[derive(Deserialize)]
        struct Profiles {
            list: Option<Vec<RawProfile>>,
        }

        #[derive(Deserialize)]
        struct FragmentFile {
            profiles: Option<Vec<RawProfile>>,
        }

        #[derive(Deserialize, Default)]
        struct RawProfile {
            guid: Option<String>,
            name: Option<String>,
            commandline: Option<String>,
            hidden: Option<bool>,
            source: Option<String>,
            updates: Option<String>,
        }

        #[derive(Clone, Debug)]
        struct Profile {
            guid: String,
            name: String,
            commandline: Option<String>,
            hidden: bool,
        }

        pub(super) fn list_profiles(builtins: &[PathBuf]) -> Vec<super::super::ShellInfo> {
            load()
                .into_iter()
                .filter_map(|profile| {
                    let launch = accept(&profile)?;
                    if duplicates_builtin(&launch, builtins) {
                        return None;
                    }
                    Some(super::super::ShellInfo {
                        id: format!("{WT_ID_PREFIX}{}", profile.guid),
                        name: profile.name,
                        path: launch.program.to_string_lossy().into_owned(),
                        integrated: false,
                    })
                })
                .collect()
        }

        fn duplicates_builtin(launch: &Launch, builtins: &[PathBuf]) -> bool {
            if !launch.args.is_empty() {
                return false;
            }
            let program =
                std::fs::canonicalize(&launch.program).unwrap_or_else(|_| launch.program.clone());
            builtins.iter().any(|builtin| {
                std::fs::canonicalize(builtin).unwrap_or_else(|_| builtin.clone()) == program
            })
        }

        pub(super) fn resolve_launch(id: &str) -> Option<Launch> {
            let guid = normalize_guid(id.trim().strip_prefix(WT_ID_PREFIX)?);
            load()
                .into_iter()
                .find(|profile| profile.guid.eq_ignore_ascii_case(&guid))
                .and_then(|profile| accept(&profile))
        }

        fn load() -> Vec<Profile> {
            let mut profiles = BTreeMap::new();
            for path in settings_paths() {
                merge_settings(&mut profiles, &read_to_string(&path));
            }
            for path in fragment_files() {
                merge_fragment(&mut profiles, &read_to_string(&path));
            }
            profiles.into_values().collect()
        }

        fn settings_paths() -> Vec<PathBuf> {
            let mut out = Vec::new();
            if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
                let packages = local.join("Packages");
                if let Ok(entries) = std::fs::read_dir(&packages) {
                    let mut stores: Vec<PathBuf> = entries
                        .filter_map(|entry| entry.ok())
                        .map(|entry| entry.path())
                        .filter(|path| {
                            path.file_name()
                                .and_then(|name| name.to_str())
                                .is_some_and(|name| name.starts_with("Microsoft.WindowsTerminal"))
                        })
                        .map(|path| path.join("LocalState").join("settings.json"))
                        .filter(|path| path.is_file())
                        .collect();
                    stores.sort();
                    out.extend(stores);
                }
                for dir in ["Windows Terminal", "Windows Terminal Preview"] {
                    let path = local.join("Microsoft").join(dir).join("settings.json");
                    if path.is_file() {
                        out.push(path);
                    }
                }
            }
            out
        }

        fn fragment_files() -> Vec<PathBuf> {
            let mut roots = Vec::new();
            if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
                roots.push(
                    local
                        .join("Microsoft")
                        .join("Windows Terminal")
                        .join("Fragments"),
                );
            }
            if let Some(data) = std::env::var_os("PROGRAMDATA").map(PathBuf::from) {
                roots.push(
                    data.join("Microsoft")
                        .join("Windows Terminal")
                        .join("Fragments"),
                );
            }
            let mut files = Vec::new();
            for root in roots {
                collect_json(&root, &mut files);
            }
            files.sort();
            files
        }

        fn collect_json(dir: &Path, out: &mut Vec<PathBuf>) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.filter_map(|entry| entry.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    collect_json(&path, out);
                } else if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                    out.push(path);
                }
            }
        }

        fn read_to_string(path: &Path) -> String {
            std::fs::read_to_string(path).unwrap_or_default()
        }

        fn merge_settings(profiles: &mut BTreeMap<String, Profile>, text: &str) -> bool {
            let Ok(file) = serde_json::from_str::<SettingsFile>(text) else {
                return false;
            };
            let Some(list) = file.profiles.and_then(|profiles| profiles.list) else {
                return false;
            };
            for raw in list {
                merge_raw(profiles, raw);
            }
            true
        }

        fn merge_fragment(profiles: &mut BTreeMap<String, Profile>, text: &str) {
            let Ok(file) = serde_json::from_str::<FragmentFile>(text) else {
                return;
            };
            for raw in file.profiles.unwrap_or_default() {
                merge_raw(profiles, raw);
            }
        }

        fn merge_raw(profiles: &mut BTreeMap<String, Profile>, raw: RawProfile) {
            let Some(guid) = raw.guid.as_deref().map(normalize_guid) else {
                if let Some(target) = raw.updates.as_deref().map(normalize_guid) {
                    if let Some(profile) = profiles.get_mut(&target) {
                        if raw.hidden == Some(true) {
                            profile.hidden = true;
                        }
                        if let Some(name) = nonempty(&raw.name) {
                            profile.name = name;
                        }
                        if let Some(commandline) = nonempty(&raw.commandline) {
                            profile.commandline = Some(commandline);
                        }
                    }
                }
                return;
            };
            let entry = profiles.entry(guid.clone()).or_insert_with(|| Profile {
                guid,
                name: String::new(),
                commandline: None,
                hidden: false,
            });
            if let Some(name) = nonempty(&raw.name) {
                entry.name = name;
            }
            if raw.commandline.is_some() {
                entry.commandline = nonempty(&raw.commandline);
            }
            if let Some(hidden) = raw.hidden {
                entry.hidden = hidden;
            }
            let _ = raw.source;
        }

        fn accept(profile: &Profile) -> Option<Launch> {
            match accept_reason(profile) {
                Ok(launch) => Some(launch),
                Err(reason) => {
                    log::info!(
                        "skipping Windows Terminal profile '{}': {reason}",
                        display_name(profile)
                    );
                    None
                }
            }
        }

        fn accept_reason(profile: &Profile) -> Result<Launch, String> {
            if profile.hidden || profile.guid.is_empty() {
                return Err("hidden or missing guid".into());
            }
            let Some(commandline) = profile.commandline.as_deref().map(str::trim) else {
                return Err("no commandline".into());
            };
            if commandline.is_empty() {
                return Err("no commandline".into());
            }
            let expanded = expand_env(commandline);
            let tokens = split_commandline(&expanded);
            let program = tokens
                .first()
                .map(|token| token.trim_matches('"').to_string())
                .filter(|token| !token.is_empty())
                .ok_or_else(|| format!("empty program in {commandline:?}"))?;
            let args = &tokens[1..];
            let path = PathBuf::from(&program);
            if !path.is_file() {
                return Err(format!("program not found: {program} from {commandline:?}"));
            }
            let kind = exe_kind(&path).ok_or_else(|| format!("exe not allowlisted: {program}"))?;
            if !args_allowed(kind, args) {
                return Err(format!("args not allowlisted: {args:?}"));
            }
            let canonical = std::fs::canonicalize(&path).unwrap_or(path);
            Ok(Launch {
                name: display_name(profile),
                program: canonical,
                args: args.to_vec(),
            })
        }

        #[derive(Clone, Copy, PartialEq, Eq)]
        enum ExeKind {
            Cmd,
            PowerShell,
            Bash,
            Wsl,
        }

        fn exe_kind(path: &Path) -> Option<ExeKind> {
            match path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_ascii_lowercase())
                .as_deref()
            {
                Some("cmd.exe") => Some(ExeKind::Cmd),
                Some("powershell.exe" | "pwsh.exe") => Some(ExeKind::PowerShell),
                Some("bash.exe") => Some(ExeKind::Bash),
                Some("wsl.exe") => Some(ExeKind::Wsl),
                _ => None,
            }
        }

        fn args_allowed(kind: ExeKind, args: &[String]) -> bool {
            match kind {
                ExeKind::Cmd => args.is_empty(),
                ExeKind::PowerShell => args.iter().all(|arg| {
                    POWERSHELL_FLAGS
                        .iter()
                        .any(|flag| flag.eq_ignore_ascii_case(arg))
                }),
                ExeKind::Bash => args
                    .iter()
                    .all(|arg| BASH_FLAGS.iter().any(|flag| flag.eq_ignore_ascii_case(arg))),
                ExeKind::Wsl => wsl_distro_arg(args).is_some(),
            }
        }

        fn wsl_distro_arg(args: &[String]) -> Option<()> {
            if args.len() != 2 {
                return None;
            }
            let flag = args[0].as_str();
            if !matches!(flag, "-d" | "--distribution") {
                return None;
            }
            crate::modules::workspace::validate_wsl_distro_name(&args[1]).ok()
        }

        fn display_name(profile: &Profile) -> String {
            if profile.name.is_empty() {
                profile.guid.clone()
            } else {
                profile.name.clone()
            }
        }

        fn normalize_guid(guid: &str) -> String {
            guid.trim()
                .trim_matches(|c| c == '{' || c == '}')
                .to_ascii_lowercase()
        }

        fn nonempty(value: &Option<String>) -> Option<String> {
            value
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        }

        fn expand_env(input: &str) -> String {
            let mut out = String::with_capacity(input.len());
            let bytes = input.as_bytes();
            let mut i = 0;
            while i < bytes.len() {
                if bytes[i] == b'%' {
                    if let Some(end) = bytes[i + 1..].iter().position(|b| *b == b'%') {
                        let name = &input[i + 1..i + 1 + end];
                        if let Some(value) = env_value(name) {
                            out.push_str(&value);
                            i += end + 2;
                            continue;
                        }
                    }
                }
                let ch = input[i..].chars().next().unwrap_or('\u{FFFD}');
                out.push(ch);
                i += ch.len_utf8();
            }
            out
        }

        fn env_value(name: &str) -> Option<String> {
            const ALLOWED: &[&str] = &[
                "SystemRoot",
                "ProgramFiles",
                "ProgramFiles(x86)",
                "LocalAppData",
                "UserProfile",
            ];
            if !ALLOWED.iter().any(|item| item.eq_ignore_ascii_case(name)) {
                return None;
            }
            std::env::var(name).ok()
        }

        /// Windows command-line quoting: whitespace separates tokens, a double
        /// quote toggles a quoted span, and a backslash escapes a quote only
        /// when it immediately precedes one.
        fn split_commandline(input: &str) -> Vec<String> {
            let mut out = Vec::new();
            let mut token = String::new();
            let mut quoted = false;
            let mut chars = input.chars().peekable();
            let mut started = false;
            while let Some(ch) = chars.next() {
                match ch {
                    '"' => {
                        started = true;
                        quoted = !quoted;
                    }
                    '\\' if quoted && chars.peek() == Some(&'"') => {
                        started = true;
                        token.push(chars.next().unwrap_or('"'));
                    }
                    c if c.is_whitespace() && !quoted => {
                        if started {
                            out.push(std::mem::take(&mut token));
                            started = false;
                        }
                    }
                    c => {
                        started = true;
                        token.push(c);
                    }
                }
            }
            if started {
                out.push(token);
            }
            out
        }

        #[cfg(test)]
        pub(super) fn profiles_from(
            settings: &str,
            fragments: &[&str],
            builtins: &[PathBuf],
        ) -> (Vec<super::super::ShellInfo>, Vec<String>) {
            let mut profiles = BTreeMap::new();
            let parsed = merge_settings(&mut profiles, settings);
            for fragment in fragments {
                merge_fragment(&mut profiles, fragment);
            }
            assert!(parsed, "settings json failed: {settings}");
            let mut shells = Vec::new();
            let mut skipped = Vec::new();
            for profile in profiles.into_values() {
                match accept_reason(&profile) {
                    Ok(launch) if duplicates_builtin(&launch, builtins) => {
                        skipped.push(format!("{}: duplicates builtin", profile.guid));
                    }
                    Ok(launch) => shells.push(super::super::ShellInfo {
                        id: format!("{WT_ID_PREFIX}{}", profile.guid),
                        name: profile.name,
                        path: launch.program.to_string_lossy().into_owned(),
                        integrated: false,
                    }),
                    Err(reason) => skipped.push(format!("{}: {reason}", profile.guid)),
                }
            }
            (shells, skipped)
        }

        #[cfg(test)]
        pub(super) fn launch_from(settings: &str, fragments: &[&str], id: &str) -> Option<Launch> {
            let guid = normalize_guid(id.trim().strip_prefix(WT_ID_PREFIX)?);
            let mut profiles = BTreeMap::new();
            merge_settings(&mut profiles, settings);
            for fragment in fragments {
                merge_fragment(&mut profiles, fragment);
            }
            profiles
                .into_values()
                .find(|profile| profile.guid.eq_ignore_ascii_case(&guid))
                .and_then(|profile| accept(&profile))
        }
    }
}

/// `PROMPT` for `cmd.exe`, which has no prompt hook but expands `$E` (escape)
/// and `$P` (drive and path) each time it prints one. The OSC 7 it emits ahead
/// of the user's own prompt is what keeps the explorer and breadcrumb on the
/// shell's directory; the path arrives with backslashes and is not escaped, so
/// the frontend reads it leniently.
#[cfg(any(windows, test))]
fn cmd_prompt(host: &str, existing: Option<&str>) -> String {
    const REPORT_CWD: &str = "$E]7;file://";
    let existing = existing.map(str::trim).filter(|p| !p.is_empty());
    if existing.is_some_and(|p| p.contains(REPORT_CWD)) {
        return existing.unwrap_or_default().to_string();
    }
    let host: String = host
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    format!("{REPORT_CWD}{host}/$P$E\\{}", existing.unwrap_or("$P$G"))
}

#[cfg(windows)]
pub fn windows_shell_path() -> PathBuf {
    if let Some(p) = which_in_path("pwsh.exe") {
        return p;
    }

    if let Some(pf) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
        let candidate = pf.join("PowerShell").join("7").join("pwsh.exe");
        if candidate.is_file() {
            return candidate;
        }
    }

    let system32 = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32");
    let ps5 = system32
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if ps5.is_file() {
        return ps5;
    }

    system32.join("cmd.exe")
}

#[cfg(windows)]
fn which_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use portable_pty::CommandBuilder;

    use super::{
        apply_common, cmd_prompt, sanitize_shell_override, shell_override_allowed,
        ShellControlEnv, ShellInfo,
    };

    #[test]
    fn cmd_prompt_reports_the_cwd_before_the_users_own_prompt() {
        assert_eq!(
            cmd_prompt("BOX-1", None),
            "$E]7;file://BOX-1/$P$E\\$P$G".to_string()
        );
        assert_eq!(
            cmd_prompt("BOX-1", Some("  [$P] $G ")),
            "$E]7;file://BOX-1/$P$E\\[$P] $G".to_string()
        );
        assert_eq!(cmd_prompt("", Some("")), "$E]7;file:///$P$E\\$P$G");
    }

    #[test]
    fn cmd_prompt_is_not_stacked_and_keeps_the_host_inert() {
        let once = cmd_prompt("BOX", None);
        assert_eq!(cmd_prompt("BOX", Some(&once)), once);
        // The host is spliced into an escape sequence: nothing but a name survives.
        assert_eq!(
            cmd_prompt("a$E]52;c;x$E\\b", None),
            "$E]7;file://aE52cxEb/$P$E\\$P$G"
        );
    }

    #[test]
    fn rejects_non_enumerated_override() {
        let exe = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert_eq!(sanitize_shell_override(Some(exe)), None);
    }

    #[test]
    fn empty_or_missing_override_is_none() {
        assert_eq!(sanitize_shell_override(Some("   ".into())), None);
        assert_eq!(sanitize_shell_override(None), None);
    }

    #[test]
    fn accepts_enumerated_id_without_touching_windows_terminal() {
        let shells = vec![
            ShellInfo::builtin(
                r"C:\Windows\System32\cmd.exe",
                r"C:\Windows\System32\cmd.exe",
                false,
            ),
            ShellInfo {
                id: "wt:61c54bbd-c2c6-5271-96e7-009a87ff44bf".into(),
                name: "Windows PowerShell".into(),
                path: r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe".into(),
                integrated: false,
            },
        ];
        assert!(shell_override_allowed(
            "wt:61c54bbd-c2c6-5271-96e7-009a87ff44bf",
            None,
            &shells,
        ));
        assert!(shell_override_allowed(
            r"C:\Windows\System32\cmd.exe",
            None,
            &shells,
        ));
        assert!(!shell_override_allowed("wt:not-listed", None, &shells));
        assert!(!shell_override_allowed(r"C:\evil\cmd.exe", None, &shells));
    }

    #[test]
    fn common_env_includes_authenticated_caller_context() {
        let mut command = CommandBuilder::new("shell");
        let control = ShellControlEnv {
            address: "127.0.0.1:1234".into(),
            token: "secret".into(),
            pane_id: 42,
            cli_path: Some("/app/terax-cli".into()),
            cli_bin_dir: Some(std::path::PathBuf::from("/app/bin")),
        };
        apply_common(&mut command, None, false, Some(&control));

        assert_eq!(
            command.get_env("TERAX_CONTROL_ADDR"),
            Some(OsStr::new("127.0.0.1:1234"))
        );
        assert_eq!(
            command.get_env("TERAX_CONTROL_TOKEN"),
            Some(OsStr::new("secret"))
        );
        assert_eq!(command.get_env("TERAX_PANE_ID"), Some(OsStr::new("42")));
        assert_eq!(
            command.get_env("TERAX_CLI"),
            Some(OsStr::new("/app/terax-cli"))
        );
        assert_eq!(
            command
                .get_env("PATH")
                .and_then(|path| std::env::split_paths(path).next()),
            Some(std::path::PathBuf::from("/app/bin"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_disables_dsh_tui_win32_input_mode() {
        let mut command = CommandBuilder::new("shell");
        apply_common(&mut command, None, false, None);
        assert_eq!(
            command.get_env("DSH_TUI_DISABLE_WIN32_INPUT_MODE"),
            Some(OsStr::new("1"))
        );
    }
}
