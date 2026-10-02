param([ValidateSet('qoder','kimi')][string]$HostAgent,[ValidateSet('connect','status','next','respond','run','result','close')][string]$Command='connect')
$ErrorActionPreference='Stop'
try {
  if (-not $HostAgent) { throw 'INVALID_ARGUMENTS' }
  $source=Split-Path -Parent $PSScriptRoot
  $channel=Get-Content -LiteralPath (Join-Path $source 'release-channel.json') -Raw | ConvertFrom-Json
  if (-not $channel.publicKey -or -not $channel.keyId) { throw 'RELEASE_NOT_AVAILABLE' }
  $expected='9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'
  if ($channel.schema -ne 'digital-employee-release-channel/1' -or $channel.nodeVersion -ne '24.18.0' -or $channel.nodeUrl -ne 'https://nodejs.org/dist/v24.18.0/win-x64/node.exe' -or $channel.nodeSha256 -ne $expected) { throw 'RELEASE_CHANNEL_INVALID' }
  $local=[Environment]::GetFolderPath('LocalApplicationData')
  if (-not [IO.Path]::IsPathRooted($local)) { throw 'WINDOWS_PROFILE_UNAVAILABLE' }
  $root=Join-Path $local 'DigitalEmployeeBootstrap'
  if (Test-Path -LiteralPath $root) {
    $item=Get-Item -LiteralPath $root -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'CLIENT_DIRECTORY_UNSAFE' }
  } else { New-Item -ItemType Directory -Path $root | Out-Null }
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
  Set-Acl -LiteralPath $root -AclObject $acl
  $node=Join-Path $root 'node-24.18.0.exe'
  if (-not (Test-Path -LiteralPath $node)) {
    $temp=Join-Path $root ([Guid]::NewGuid().ToString()+'.download')
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    Add-Type -AssemblyName System.Net.Http
    $http=[Net.Http.HttpClient]::new([Net.Http.HttpClientHandler]@{AllowAutoRedirect=$false})
    try {
      $http.Timeout=[TimeSpan]::FromSeconds(120)
      $response=$http.GetAsync($channel.nodeUrl,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
      if (-not $response.IsSuccessStatusCode -or $response.Content.Headers.ContentLength -gt 134217728) { throw 'RELEASE_DOWNLOAD_FAILED' }
      $downloadStream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
      $output=[IO.File]::Open($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      try {
        $buffer=New-Object byte[] 65536; [long]$total=0
        while(($count=$downloadStream.Read($buffer,0,$buffer.Length)) -gt 0) { $total+=$count; if($total -gt 134217728){throw 'RELEASE_TOO_LARGE'}; $output.Write($buffer,0,$count) }
      } finally { $downloadStream.Dispose(); $output.Dispose(); $response.Dispose() }
    } finally { $http.Dispose() }
    if ((Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'CLIENT_INTEGRITY_MISMATCH' }
    Move-Item -LiteralPath $temp -Destination $node
  }
  $file=Get-Item -LiteralPath $node -Force
  if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 134217728 -or (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'CLIENT_INTEGRITY_MISMATCH' }
  # The fixed Node hash is the bootstrap trust anchor. Node then verifies the entire
  # Skill source, pinned release key, signed metadata and portable bundle.
  & $node (Join-Path $PSScriptRoot 'core.mjs') $Command --host $HostAgent
  exit $LASTEXITCODE
} catch {
  $code=[string]$_.Exception.Message
  if ($code -notmatch '^[A-Z_]{1,64}$') { $code='CLIENT_BOOTSTRAP_FAILED' }
  [Console]::Error.WriteLine('{"ok":false,"error":{"code":"'+$code+'"}}')
  exit 1
}
