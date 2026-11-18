$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = $PSScriptRoot
$raw = Join-Path $root 'data\sheets'
New-Item -ItemType Directory -Force -Path $raw | Out-Null
$readme = Get-Content -LiteralPath (Join-Path $root 'README.md') -Encoding UTF8 -Raw
$ids = @([regex]::Matches($readme, 'https://docs.google.com/spreadsheets/d/([^/]+)/') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-ZipText($zip, $name) {
    $entry = $zip.GetEntry($name)
    if ($null -eq $entry) { throw "Missing XLSX entry: $name" }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
foreach ($id in $ids) {
    try {
    $xlsx = Join-Path $raw "$id.xlsx"
    $jsonPath = Join-Path $raw "$id.json"
    if (Test-Path -LiteralPath $jsonPath) {
        Write-Output "Already captured: $id"
        continue
    }
    if (!(Test-Path -LiteralPath $xlsx)) {
        $temp = "$xlsx.download"
        Invoke-WebRequest -UseBasicParsing -Uri "https://docs.google.com/spreadsheets/d/$id/export?format=xlsx" -OutFile $temp
        Move-Item -LiteralPath $temp -Destination $xlsx
    }
    $zip = [System.IO.Compression.ZipFile]::OpenRead($xlsx)
    try {
        $strings = @()
        if ($null -ne $zip.GetEntry('xl/sharedStrings.xml')) {
            [xml]$ss = Read-ZipText $zip 'xl/sharedStrings.xml'
            $strings = @($ss.SelectNodes('//*[local-name()="si"]') | ForEach-Object {
                ($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join ''
            })
        }
        [xml]$book = Read-ZipText $zip 'xl/workbook.xml'
        [xml]$rels = Read-ZipText $zip 'xl/_rels/workbook.xml.rels'
        $targets = @{}
        foreach ($rel in $rels.DocumentElement.ChildNodes) { $targets[$rel.GetAttribute('Id')] = $rel.GetAttribute('Target') }
        $tabs = @()
        foreach ($sheet in $book.SelectNodes('//*[local-name()="sheet"]')) {
            $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
            $target = $targets[$rid]
            if ($target.StartsWith('/')) { $target = $target.TrimStart('/') } else { $target = "xl/$target" }
            [xml]$tab = Read-ZipText $zip $target
            $cells = @()
            foreach ($cell in $tab.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]/*[local-name()="c"]')) {
                $v = $cell.SelectSingleNode('./*[local-name()="v"]')
                $value = if ($null -ne $v) { $v.InnerText } else { '' }
                if ($cell.GetAttribute('t') -eq 's') { $value = $strings[[int]$value] }
                if ($cell.GetAttribute('t') -eq 'inlineStr') {
                    $value = ($cell.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join ''
                }
                $f = $cell.SelectSingleNode('./*[local-name()="f"]')
                if ($value -ne '' -or $null -ne $f) {
                    $cells += [ordered]@{ address = $cell.GetAttribute('r'); value = $value; type = $cell.GetAttribute('t'); style = $cell.GetAttribute('s'); formula = $(if ($null -ne $f) { $f.InnerText } else { $null }) }
                }
            }
            $tabs += [ordered]@{ name = $sheet.GetAttribute('name'); cells = $cells }
        }
        $snapshot = [ordered]@{ spreadsheetId = $id; capturedAt = [DateTime]::UtcNow.ToString('o'); sha256 = (Get-FileHash -LiteralPath $xlsx -Algorithm SHA256).Hash; date1904 = ($book.OuterXml -match 'date1904="(1|true)"'); tabs = $tabs }
        [System.IO.File]::WriteAllText($jsonPath, ($snapshot | ConvertTo-Json -Depth 12), $utf8)
        $errorPath = Join-Path $raw "$id.error.json"
        if (Test-Path -LiteralPath $errorPath) { Remove-Item -LiteralPath $errorPath }
        Write-Output ("Captured {0}: {1}" -f $id, (($tabs | ForEach-Object { "$($_.name) ($($_.cells.Count) cells)" }) -join ', '))
    } finally { $zip.Dispose() }
    } catch {
        $failure = [ordered]@{ spreadsheetId = $id; attemptedAt = [DateTime]::UtcNow.ToString('o'); error = $_.Exception.Message }
        [System.IO.File]::WriteAllText((Join-Path $raw "$id.error.json"), ($failure | ConvertTo-Json), $utf8)
        Write-Output "Failed ${id}: $($_.Exception.Message)"
    }
}
