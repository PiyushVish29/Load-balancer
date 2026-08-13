$ErrorActionPreference = 'Stop'

function Stop-LocalPort($port) {
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        } catch {}
    }
}

foreach ($port in 3001,3002,3003,8080) {
    Stop-LocalPort $port
}

$backendDir = 'e:\load balancer\backend-server'
$lbDir = 'e:\load balancer\load-balancer'

function Start-Backend($id, $port) {
    $env:SERVER_ID = $id
    $env:PORT = $port
    Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $backendDir -WindowStyle Hidden | Out-Null
}

Start-Backend 'backend-1' 3001
Start-Backend 'backend-2' 3002
Start-Backend 'backend-3' 3003
Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $lbDir -WindowStyle Hidden | Out-Null

for ($i = 1; $i -le 25; $i++) {
    try {
        $health = (Invoke-WebRequest -Uri 'http://localhost:8080/health' -UseBasicParsing).Content | ConvertFrom-Json
        if ($health.backends.Count -eq 3) { break }
    } catch {}
    Start-Sleep -Seconds 1
}

Write-Host '--- initial pool ---'
(Invoke-WebRequest -Uri 'http://localhost:8080/health' -UseBasicParsing).Content | ConvertFrom-Json | Select-Object -ExpandProperty backends | Format-Table -AutoSize

$targetPid = (Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
Stop-Process -Id $targetPid -Force

Write-Host '--- wait for backend-2 DOWN ---'
for ($i = 1; $i -le 20; $i++) {
    $status = ((Invoke-WebRequest -Uri 'http://localhost:8080/health' -UseBasicParsing).Content | ConvertFrom-Json).backends | Where-Object { $_.id -eq 'backend-2' }
    Write-Host "attempt $i : isAlive=$($status.isAlive)"
    if ($status.isAlive -eq $false) { break }
    Start-Sleep -Seconds 1
}

Start-Backend 'backend-2' 3002


Write-Host '--- wait for backend-2 UP ---'
for ($i = 1; $i -le 20; $i++) {
    $status = ((Invoke-WebRequest -Uri 'http://localhost:8080/health' -UseBasicParsing).Content | ConvertFrom-Json).backends | Where-Object { $_.id -eq 'backend-2' }
    Write-Host "attempt $i : isAlive=$($status.isAlive)"
    if ($status.isAlive -eq $true) { break }
    Start-Sleep -Seconds 1
}

Write-Host '--- final pool ---'
(Invoke-WebRequest -Uri 'http://localhost:8080/health' -UseBasicParsing).Content | ConvertFrom-Json | Select-Object -ExpandProperty backends | Format-Table -AutoSize
