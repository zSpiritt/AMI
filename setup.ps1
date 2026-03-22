# AMI - Assistant PocketMine Interface
# Script d'installation Windows

$ErrorActionPreference = "Stop"

$REPO_URL    = "https://github.com/zSpiritt/AMI.git"
$INSTALL_DIR = "$env:LOCALAPPDATA\AMI"
$TMP_DIR     = "$env:TEMP\AMI-build"

function ok   { Write-Host "  [OK] $args" -ForegroundColor Green }
function info { Write-Host "  --> $args" -ForegroundColor Cyan }
function warn { Write-Host "  [!]  $args" -ForegroundColor Yellow }
function err  { Write-Host "  [X]  $args" -ForegroundColor Red; Read-Host "Appuie sur Entree pour quitter"; exit 1 }

Write-Host ""
Write-Host "  +--------------------------------------+" -ForegroundColor White
Write-Host "  |  AMI - Assistant PocketMine          |" -ForegroundColor White
Write-Host "  |  Installation                        |" -ForegroundColor White
Write-Host "  +--------------------------------------+" -ForegroundColor White
Write-Host ""

# -- 1. Dependances -----------------------------------------------------------
Write-Host "  [1/5] Installation des dependances..." -ForegroundColor White
Write-Host ""

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    err "winget non disponible. Mets a jour Windows ou installe App Installer depuis le Microsoft Store."
}
ok "winget disponible"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    info "Installation de Git..."
    winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
}
ok "Git $(git --version)"

if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    ok "curl disponible"
} else {
    winget install --id cURL.cURL -e --silent --accept-package-agreements --accept-source-agreements
    ok "curl installe"
}

# Visual C++ Build Tools
info "Verification de Visual C++ Build Tools..."
$vcInstalled = Get-ChildItem "C:\Program Files\Microsoft Visual Studio" -ErrorAction SilentlyContinue
if (-not $vcInstalled) {
    info "Installation de Visual C++ Build Tools..."
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --silent `
        --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" `
        --accept-package-agreements --accept-source-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
}

$linkExe = Get-ChildItem "C:\Program Files\Microsoft Visual Studio" -Recurse -Filter "link.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $linkExe) {
    $linkExe = Get-ChildItem "C:\Program Files (x86)\Microsoft Visual Studio" -Recurse -Filter "link.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $linkExe) {
    $linkExe = Get-ChildItem "C:\Program Files\Microsoft Visual Studio 2022" -Recurse -Filter "link.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $linkExe) {
    # Cherche dans tout le disque C en dernier recours
    $linkExe = Get-ChildItem "C:\" -Recurse -Filter "link.exe" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*VC*" } | Select-Object -First 1
}

if ($linkExe) {
    $env:PATH = $linkExe.DirectoryName + ";" + $env:PATH
    ok "Visual C++ Build Tools + link.exe ($($linkExe.DirectoryName))"
} else {
    err "link.exe introuvable. Installe Visual Studio Build Tools manuellement : https://visualstudio.microsoft.com/fr/downloads/#build-tools-for-visual-studio-2022"
}

# WebView2
$wv2 = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if (-not $wv2) {
    info "Installation de WebView2..."
    winget install --id Microsoft.EdgeWebView2Runtime -e --silent --accept-package-agreements --accept-source-agreements
}
ok "WebView2"

Write-Host ""

# -- 2. Rust ------------------------------------------------------------------
Write-Host "  [2/5] Installation de Rust..." -ForegroundColor White
Write-Host ""

if (Get-Command rustc -ErrorAction SilentlyContinue) {
    ok "Rust deja installe ($(rustc --version))"
} else {
    info "Telechargement de Rust..."
    $rustupExe = "$env:TEMP\rustup-init.exe"
    curl.exe -L -o $rustupExe "https://win.rustup.rs/x86_64"
    Start-Process -FilePath $rustupExe -ArgumentList "-y", "--no-modify-path" -Wait -NoNewWindow
    Remove-Item $rustupExe
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    [System.Environment]::SetEnvironmentVariable("PATH", "$env:USERPROFILE\.cargo\bin;" + [System.Environment]::GetEnvironmentVariable("PATH","User"), "User")
    ok "Rust installe"
}

$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Write-Host ""

# -- 3. Node.js ---------------------------------------------------------------
Write-Host "  [3/5] Installation de Node.js..." -ForegroundColor White
Write-Host ""

if (Get-Command node -ErrorAction SilentlyContinue) {
    ok "Node.js deja installe ($(node --version))"
} else {
    info "Installation de Node.js LTS..."
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
    ok "Node.js installe"
}
Write-Host ""

# -- 4. Compilation -----------------------------------------------------------
Write-Host "  [4/5] Telechargement et compilation d'AMI..." -ForegroundColor White
Write-Host ""

if (Test-Path $TMP_DIR) { Remove-Item -Recurse -Force $TMP_DIR }

info "Clonage du repo..."
git clone $REPO_URL $TMP_DIR --depth=1
if ($LASTEXITCODE -ne 0) { err "Impossible de cloner le repo." }
ok "Repo clone"

Set-Location $TMP_DIR

info "Installation des dependances npm..."
npm install
if ($LASTEXITCODE -ne 0) { err "Echec de npm install" }
ok "Dependances npm installees"

info "Compilation (cela peut prendre 10-15 minutes)..."
npm run tauri build -- --no-bundle
if ($LASTEXITCODE -ne 0) { err "Echec de la compilation" }
ok "Compilation terminee"

Write-Host ""

# -- 5. Installation ----------------------------------------------------------
Write-Host "  [5/5] Installation d'AMI..." -ForegroundColor White
Write-Host ""

$null = New-Item -ItemType Directory -Force -Path $INSTALL_DIR

$binary = Get-ChildItem "$TMP_DIR\src-tauri\target\release\" -Filter "*.exe" |
    Where-Object { $_.Name -imatch "^ami\.exe$" } |
    Select-Object -First 1

if (-not $binary) {
    $binary = Get-ChildItem "$TMP_DIR\src-tauri\target\release\" -Filter "*.exe" |
        Where-Object { $_.Name -notmatch "build|deps|incremental" } |
        Select-Object -First 1
}

if (-not $binary) { err "Binaire compile introuvable." }

Copy-Item $binary.FullName "$INSTALL_DIR\ami.exe"
ok "Binaire installe"

if (Test-Path "$TMP_DIR\src-tauri\icons\icon.svg") {
    Copy-Item "$TMP_DIR\src-tauri\icons\icon.svg" "$INSTALL_DIR\icon.svg"
    ok "Icone installee"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$env:USERPROFILE\Desktop\AMI.lnk")
$shortcut.TargetPath = "$INSTALL_DIR\ami.exe"
$shortcut.WorkingDirectory = $INSTALL_DIR
$shortcut.Description = "Assistant PocketMine Interface"
$shortcut.Save()
ok "Raccourci bureau cree"

$userPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
if ($userPath -notlike "*$INSTALL_DIR*") {
    [System.Environment]::SetEnvironmentVariable("PATH", "$userPath;$INSTALL_DIR", "User")
    ok "Ajoute au PATH"
}

Remove-Item -Recurse -Force $TMP_DIR

Write-Host ""
Write-Host "  +--------------------------------------+" -ForegroundColor Green
Write-Host "  |  AMI est installe avec succes !      |" -ForegroundColor Green
Write-Host "  |  Lance-le depuis ton bureau          |" -ForegroundColor Green
Write-Host "  +--------------------------------------+" -ForegroundColor Green
Write-Host ""

Start-Process "$INSTALL_DIR\ami.exe"
