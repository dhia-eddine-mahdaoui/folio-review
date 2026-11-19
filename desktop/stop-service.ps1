$runtime = Join-Path $PSScriptRoot 'node.exe'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.ExecutablePath -eq $runtime -and $_.CommandLine -match 'server[/\\]local\.js"?\s*$'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
