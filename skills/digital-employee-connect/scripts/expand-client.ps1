param([string]$Archive,[string]$Destination)
$ErrorActionPreference='Stop'
$phase='VALIDATION'
try {
  if (-not [IO.Path]::IsPathRooted($Archive) -or -not [IO.Path]::IsPathRooted($Destination)) { throw 'path' }
  $target=[IO.Path]::GetFullPath($Destination)
  $directory=Get-Item -LiteralPath $target -Force
  if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-ChildItem -LiteralPath $target -Force | Measure-Object).Count -ne 0) { throw 'directory' }
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
  $phase='ACL'
  Set-Acl -LiteralPath $target -AclObject $acl
  $phase='ZIP_OPEN'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    if ($zip.Entries.Count -gt 10000) { throw 'entries' }
    $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [long]$total=0
    foreach($entry in $zip.Entries) {
      $phase='ENTRY_VALIDATION'
      $name=$entry.FullName
      if (-not $name.StartsWith('digital-employee-client/',[StringComparison]::Ordinal) -or $name -match '[\\:\x00-\x1f\x7f]' -or $name.Length -gt 1024 -or [IO.Path]::IsPathRooted($name)) { throw 'entry' }
      $pieces=$name.TrimEnd('/').Split('/')
      foreach($piece in $pieces) { if (-not $piece -or $piece -eq '.' -or $piece -eq '..' -or $piece -match '[. ]$') { throw 'entry' } }
      if (-not $names.Add($name.TrimEnd('/'))) { throw 'duplicate' }
      if (($entry.ExternalAttributes -shr 16 -band 0xf000) -eq 0xa000) { throw 'link' }
      $total+=$entry.Length
      if ($entry.Length -gt 268435456 -or $total -gt 1073741824) { throw 'size' }
      $file=[IO.Path]::GetFullPath([IO.Path]::Combine($target,$name.Replace('/',[IO.Path]::DirectorySeparatorChar)))
      if (-not $file.StartsWith($target.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'boundary' }
      if ($name.EndsWith('/')) { [IO.Directory]::CreateDirectory($file) | Out-Null }
      else {
        $phase='ENTRY_EXTRACTION'
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$file,$false)
      }
    }
  } finally { $zip.Dispose() }
} catch {
  [Console]::Error.WriteLine('CLIENT_EXTRACTION_FAILED_'+$phase)
  exit 1
}
