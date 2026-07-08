$ScriptFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
$VideoFolder = Join-Path $ScriptFolder "background_videos"
$PlaylistFile = Join-Path $VideoFolder "playlist.json"
$PlaylistScriptFile = Join-Path $VideoFolder "playlist.js"
$Extensions = @(".mp4", ".webm", ".ogg", ".ogv", ".mov", ".m4v")

if (!(Test-Path $VideoFolder)) {
    New-Item -ItemType Directory -Path $VideoFolder | Out-Null
    Write-Host "Created background_videos folder. Put video files there and run this script again."
    exit
}

$Videos = Get-ChildItem $VideoFolder -File | Where-Object {
    $Extensions -contains $_.Extension.ToLower()
} | Sort-Object Name | ForEach-Object {
    "background_videos/$($_.Name)"
}

$Json = $Videos | ConvertTo-Json
$Json | Set-Content $PlaylistFile -Encoding UTF8
"window.NIC_BACKGROUND_VIDEOS = $Json;" | Set-Content $PlaylistScriptFile -Encoding UTF8
Write-Host "background video playlists created with $($Videos.Count) videos."
