$ScriptFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
$MusicFolder = Join-Path $ScriptFolder "music"
$PlaylistFile = Join-Path $MusicFolder "playlist.json"

if (!(Test-Path $MusicFolder)) {
    New-Item -ItemType Directory -Path $MusicFolder | Out-Null
    Write-Host "Created music folder. Put your MP3 files there and run this script again."
    exit
}

$Songs = Get-ChildItem $MusicFolder -Filter *.mp3 | Sort-Object Name | ForEach-Object {
    "music/$($_.Name)"
}

$Songs | ConvertTo-Json | Set-Content $PlaylistFile -Encoding UTF8
Write-Host "playlist.json created with $($Songs.Count) songs."
