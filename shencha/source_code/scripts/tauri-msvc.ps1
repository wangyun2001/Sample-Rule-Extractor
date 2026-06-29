param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("dev", "build", "info", "check")]
  [string]$Mode
)

$ErrorActionPreference = "Stop"

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
  throw "vswhere not found. Please install Visual Studio Build Tools 2022."
}

$vsInstallPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsInstallPath) {
  throw "Visual Studio C++ Build Tools not found."
}

$vsDevCmd = Join-Path $vsInstallPath "Common7\Tools\VsDevCmd.bat"
if (-not (Test-Path $vsDevCmd)) {
  throw "VsDevCmd.bat not found at $vsDevCmd"
}

$tauriCmd = switch ($Mode) {
  "dev" { "npx tauri dev" }
  "build" { "npx tauri build" }
  "info" { "npx tauri info" }
  "check" { "cargo check --manifest-path src-tauri/Cargo.toml" }
}

$cmd = "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && $tauriCmd"
Write-Host "[tauri-msvc] using $vsDevCmd"
Write-Host "[tauri-msvc] running: $tauriCmd"
cmd /c $cmd
