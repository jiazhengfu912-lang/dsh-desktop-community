param(
  [string]$InstallerPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $desktopRoot '..\..'))
$defaultInstaller = Join-Path $desktopRoot 'release\DSH-Desktop-Community-Setup-x64.exe'
$installer = [IO.Path]::GetFullPath($(if ([string]::IsNullOrWhiteSpace($InstallerPath)) { $defaultInstaller } else { $InstallerPath }))
$expectedIcon = [IO.Path]::GetFullPath((Join-Path $desktopRoot 'build\icon.ico'))
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "installer smoke: missing $installer" }
if (-not (Test-Path -LiteralPath $expectedIcon -PathType Leaf)) { throw "installer smoke: missing $expectedIcon" }

$manifest = Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json
$expectedProduct = [string]$manifest.productName
$expectedDescription = [string]$manifest.description
$expectedNumericVersion = ([string]$manifest.version -split '-', 2)[0]
if ($expectedProduct -ne 'DSH Desktop Community') {
  throw "installer smoke: unexpected product identity $expectedProduct"
}

$installerSignature = Get-AuthenticodeSignature -LiteralPath $installer
if ($installerSignature.Status.ToString() -ne 'NotSigned') {
  throw "installer smoke: unsigned preview unexpectedly has installer signature status $($installerSignature.Status)"
}

$existingProducts = @(
  Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq $expectedProduct }
)
if ($existingProducts.Count -ne 0) {
  throw "installer smoke: refusing to replace an existing per-user $expectedProduct installation"
}

$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$smokeRoot = Join-Path $temporaryBase ("dsh-desktop-installer-" + [Guid]::NewGuid().ToString('N'))
$installDir = Join-Path $smokeRoot 'installed-app'
$dshHome = Join-Path $smokeRoot 'persistent-dsh-home'
$sentinel = Join-Path $dshHome 'uninstall-preservation-sentinel.txt'
$appExecutable = Join-Path $installDir "$expectedProduct.exe"
$uninstaller = Join-Path $installDir "Uninstall $expectedProduct.exe"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$expectedProduct.lnk"
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$expectedProduct.lnk"
$shortcutBackupRoot = Join-Path $smokeRoot 'shortcut-backups'
$shortcutStates = @(
  [PSCustomObject]@{ Path = $desktopShortcut; Backup = (Join-Path $shortcutBackupRoot 'desktop.lnk'); Existed = $false }
  [PSCustomObject]@{ Path = $startMenuShortcut; Backup = (Join-Path $shortcutBackupRoot 'start-menu.lnk'); Existed = $false }
)

function Invoke-HiddenProcess([string]$FilePath, [string[]]$ArgumentList, [int]$TimeoutSeconds = 180) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru -WindowStyle Hidden
  try {
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
      & $taskkill /PID $process.Id /T /F 2>&1 | Out-Null
      if (-not $process.WaitForExit(10000)) {
        try { $process.Kill() } catch { Write-Warning "installer smoke: fallback process kill failed: $_" }
        [void]$process.WaitForExit(10000)
      }
      throw "installer smoke: timed out running $FilePath"
    }
    if ($process.ExitCode -ne 0) { throw "installer smoke: $FilePath exited $($process.ExitCode)" }
  }
  finally {
    $process.Dispose()
  }
}

function Wait-ProductUninstalled(
  [string]$ProductName,
  [string]$Executable,
  [string]$DesktopLink,
  [string]$StartMenuLink,
  [int]$TimeoutSeconds = 120
) {
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  do {
    $remaining = New-Object Collections.Generic.List[string]
    if (Test-Path -LiteralPath $Executable) { $remaining.Add('application executable') }
    if (Test-Path -LiteralPath $DesktopLink) { $remaining.Add('desktop shortcut') }
    if (Test-Path -LiteralPath $StartMenuLink) { $remaining.Add('Start Menu shortcut') }
    $registrations = @(
      Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq $ProductName }
    )
    if ($registrations.Count -ne 0) { $remaining.Add('HKCU uninstall registration') }
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 500
  } while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds)
  throw "installer smoke: uninstall did not finish within $TimeoutSeconds seconds; remaining: $($remaining -join ', ')"
}

function Get-IconDigest([string]$Path) {
  Add-Type -AssemblyName System.Drawing
  if ($null -eq ('DesktopInstallerSmoke.NativeIcon' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace DesktopInstallerSmoke {
  public static class NativeIcon {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint ExtractIconEx(
      string fileName,
      int iconIndex,
      IntPtr[] largeIcons,
      IntPtr[] smallIcons,
      uint iconCount
    );

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DestroyIcon(IntPtr icon);
  }
}
'@
  }
  $handles = New-Object IntPtr[] 1
  $count = [DesktopInstallerSmoke.NativeIcon]::ExtractIconEx($Path, 0, $handles, $null, 1)
  if ($count -ne 1 -or $handles[0] -eq [IntPtr]::Zero) {
    throw "installer smoke: no icon resource in $Path"
  }
  $borrowedIcon = [Drawing.Icon]::FromHandle($handles[0])
  try { $icon = [Drawing.Icon]$borrowedIcon.Clone() }
  finally {
    $borrowedIcon.Dispose()
    [void][DesktopInstallerSmoke.NativeIcon]::DestroyIcon($handles[0])
  }
  if ($null -eq $icon) { throw "installer smoke: no icon in $Path" }
  try {
    $bitmap = $icon.ToBitmap()
    try {
      $bytes = New-Object Collections.Generic.List[byte]
      for ($y = 0; $y -lt $bitmap.Height; $y++) {
        for ($x = 0; $x -lt $bitmap.Width; $x++) {
          $bytes.AddRange([BitConverter]::GetBytes($bitmap.GetPixel($x, $y).ToArgb()))
        }
      }
      $sha = [Security.Cryptography.SHA256]::Create()
      try { return -join ($sha.ComputeHash($bytes.ToArray()) | ForEach-Object { $_.ToString('X2') }) }
      finally { $sha.Dispose() }
    }
    finally { $bitmap.Dispose() }
  }
  finally { $icon.Dispose() }
}

function Assert-SameFile([string]$Expected, [string]$Actual) {
  $expectedHash = (Get-FileHash -LiteralPath $Expected -Algorithm SHA256).Hash
  $actualHash = (Get-FileHash -LiteralPath $Actual -Algorithm SHA256).Hash
  if ($expectedHash -ne $actualHash) {
    throw "installer smoke: installed file does not match source $Actual"
  }
}

function Assert-CleanPackageClosure([IO.FileInfo[]]$InstalledFiles) {
  $forbiddenUserFiles = @(
    $InstalledFiles | Where-Object {
      $_.Name -eq '.env' -or
      ($_.Name -match '^\.env\.' -and $_.Name -ne '.env.example') -or
      $_.Extension -in @('.log', '.map', '.db', '.sqlite', '.sqlite3', '.jsonl') -or
      $_.Name -eq 'gui-smoke.png' -or
      $_.FullName -match '[\\/]\.dsh[\\/]'
    }
  )
  if ($forbiddenUserFiles.Count -ne 0) {
    throw "installer smoke: package contains forbidden generated or user-data file $($forbiddenUserFiles[0].FullName)"
  }

  $forbiddenRoots = @(
    $repositoryRoot
    [Environment]::GetFolderPath('UserProfile')
  ) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\', '/') } |
    Select-Object -Unique
  $textExtensions = @('.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.sql', '.txt', '.xml', '.yaml', '.yml')
  foreach ($file in $InstalledFiles) {
    if ($file.Extension -notin $textExtensions) { continue }
    $content = [IO.File]::ReadAllText($file.FullName)
    foreach ($root in $forbiddenRoots) {
      $forms = @($root, $root.Replace('\', '/'), $root.Replace('\', '\\')) | Select-Object -Unique
      foreach ($form in $forms) {
        if ($content.IndexOf($form, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
          throw "installer smoke: package embeds local path $form in $($file.FullName)"
        }
      }
    }
  }
}

New-Item -ItemType Directory -Path $dshHome -Force | Out-Null
New-Item -ItemType Directory -Path $shortcutBackupRoot -Force | Out-Null
Set-Content -LiteralPath $sentinel -Value 'preserve user DSH_HOME' -NoNewline
foreach ($state in $shortcutStates) {
  if (Test-Path -LiteralPath $state.Path -PathType Leaf) {
    Copy-Item -LiteralPath $state.Path -Destination $state.Backup
    $state.Existed = $true
  }
}

$previousDshHome = [Environment]::GetEnvironmentVariable('DSH_HOME', 'Process')
[Environment]::SetEnvironmentVariable('DSH_HOME', $dshHome, 'Process')
$installed = $false
try {
  Invoke-HiddenProcess $installer @('/S', "/D=$installDir") -TimeoutSeconds 1800
  $installed = $true

  $installedLicense = Join-Path $installDir 'resources\LICENSE'
  $installedNotices = Join-Path $installDir 'resources\THIRD_PARTY_NOTICES.md'
  $installedCommunityNotice = Join-Path $installDir 'resources\COMMUNITY_NOTICE.md'
  foreach ($required in @(
    $appExecutable,
    $uninstaller,
    $installedLicense,
    $installedNotices,
    $installedCommunityNotice,
    $desktopShortcut,
    $startMenuShortcut
  )) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "installer smoke: missing installed file $required"
    }
  }

  $extendedInstallDir = if ($installDir.StartsWith('\\')) {
    '\\?\UNC\' + $installDir.TrimStart('\')
  }
  else {
    "\\?\$installDir"
  }
  $installedFiles = @(
    [IO.Directory]::EnumerateFiles($extendedInstallDir, '*', [IO.SearchOption]::AllDirectories) |
      ForEach-Object { [IO.FileInfo]::new($_) }
  )
  Assert-CleanPackageClosure $installedFiles

  Assert-SameFile (Join-Path $repositoryRoot 'LICENSE') $installedLicense
  Assert-SameFile (Join-Path $repositoryRoot 'THIRD_PARTY_NOTICES.md') $installedNotices
  Assert-SameFile (Join-Path $repositoryRoot 'COMMUNITY_NOTICE.md') $installedCommunityNotice

  $version = (Get-Item -LiteralPath $appExecutable).VersionInfo
  if ($version.ProductName -ne $expectedProduct) {
    throw "installer smoke: wrong ProductName $($version.ProductName)"
  }
  if ($version.FileDescription -ne $expectedDescription) {
    throw "installer smoke: wrong FileDescription $($version.FileDescription)"
  }
  if (-not $version.ProductVersion.StartsWith($expectedNumericVersion, [StringComparison]::Ordinal)) {
    throw "installer smoke: wrong ProductVersion $($version.ProductVersion)"
  }
  if (-not $version.FileVersion.StartsWith($expectedNumericVersion, [StringComparison]::Ordinal)) {
    throw "installer smoke: wrong FileVersion $($version.FileVersion)"
  }
  $appSignature = Get-AuthenticodeSignature -LiteralPath $appExecutable
  if ($appSignature.Status.ToString() -ne 'NotSigned') {
    throw "installer smoke: unsigned preview unexpectedly has app signature status $($appSignature.Status)"
  }

  $shell = New-Object -ComObject WScript.Shell
  try {
    foreach ($shortcutPath in @($desktopShortcut, $startMenuShortcut)) {
      $shortcut = $shell.CreateShortcut($shortcutPath)
      try {
        if ([IO.Path]::GetFullPath($shortcut.TargetPath) -ne [IO.Path]::GetFullPath($appExecutable)) {
          throw "installer smoke: shortcut target mismatch in $shortcutPath"
        }
        if (-not [string]::IsNullOrWhiteSpace($shortcut.IconLocation)) {
          $shortcutIcon = ($shortcut.IconLocation -replace ',\s*-?\d+\s*$', '').Trim('"')
          if ([IO.Path]::GetFullPath($shortcutIcon) -ne [IO.Path]::GetFullPath($appExecutable)) {
            throw "installer smoke: shortcut icon mismatch in $shortcutPath"
          }
        }
      }
      finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    }
  }
  finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }

  $expectedIconDigest = Get-IconDigest $expectedIcon
  foreach ($iconSource in @($installer, $appExecutable, $uninstaller)) {
    $installedIconDigest = Get-IconDigest $iconSource
    if ($installedIconDigest -ne $expectedIconDigest) {
      throw "installer smoke: executable icon does not match the community icon: $iconSource"
    }
  }
  Write-Output 'DESKTOP_INSTALLER_ICONS_OK'

  & node (Join-Path $desktopRoot 'build\smoke-startup.mjs') $installDir
  if ($LASTEXITCODE -ne 0) { throw "installer smoke: packaged startup exited $LASTEXITCODE" }

  Invoke-HiddenProcess $uninstaller @('/S')
  Wait-ProductUninstalled $expectedProduct $appExecutable $desktopShortcut $startMenuShortcut
  if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
    throw 'installer smoke: uninstall removed user DSH_HOME data'
  }
  $installed = $false

  Write-Output "DESKTOP_INSTALLER_OK product=$($version.ProductName) version=$($version.ProductVersion)"
}
finally {
  if ($installed -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    try { Invoke-HiddenProcess -FilePath $uninstaller -ArgumentList @('/S') -TimeoutSeconds 60 }
    catch { Write-Warning "installer smoke: cleanup uninstall failed: $_" }
  }
  foreach ($state in $shortcutStates) {
    if ($state.Existed) {
      Copy-Item -LiteralPath $state.Backup -Destination $state.Path -Force
    }
    elseif (Test-Path -LiteralPath $state.Path -PathType Leaf) {
      $cleanupShell = New-Object -ComObject WScript.Shell
      try {
        $cleanupShortcut = $cleanupShell.CreateShortcut($state.Path)
        try { $cleanupTarget = [IO.Path]::GetFullPath($cleanupShortcut.TargetPath) }
        finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($cleanupShortcut) }
      }
      finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($cleanupShell) }
      if ($cleanupTarget -eq [IO.Path]::GetFullPath($appExecutable)) {
        Remove-Item -LiteralPath $state.Path -Force
      }
    }
  }
  [Environment]::SetEnvironmentVariable('DSH_HOME', $previousDshHome, 'Process')

  $resolvedRoot = [IO.Path]::GetFullPath($smokeRoot)
  $leaf = Split-Path -Leaf $resolvedRoot
  if (-not $resolvedRoot.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase) -or
      -not $leaf.StartsWith('dsh-desktop-installer-', [StringComparison]::Ordinal)) {
    throw "installer smoke: refusing to remove unexpected path $resolvedRoot"
  }
  if (Test-Path -LiteralPath $resolvedRoot) {
    $extendedRoot = if ($resolvedRoot.StartsWith('\\')) {
      '\\?\UNC\' + $resolvedRoot.TrimStart('\')
    }
    else {
      "\\?\$resolvedRoot"
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      try {
        foreach ($file in [IO.Directory]::EnumerateFiles($extendedRoot, '*', [IO.SearchOption]::AllDirectories)) {
          [IO.File]::SetAttributes($file, [IO.FileAttributes]::Normal)
        }
        [IO.Directory]::Delete($extendedRoot, $true)
        break
      }
      catch {
        if ($attempt -eq 3) {
          Write-Warning "installer smoke: temporary directory cleanup failed: $_"
        }
        else {
          Start-Sleep -Milliseconds 500
        }
      }
    }
  }
}
