param([string]$Source = 'C:\Users\sesa814213\Desktop\BOM_C25N45B250.xlsx')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$root = Split-Path $PSScriptRoot -Parent
$stream = [IO.File]::Open($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
$buffer = [IO.MemoryStream]::new()
try { $stream.CopyTo($buffer) } finally { $stream.Dispose() }
$bytes = $buffer.ToArray()
$buffer.Position = 0
$zip = [IO.Compression.ZipArchive]::new($buffer, [IO.Compression.ZipArchiveMode]::Read)
function Read-ZipXml($name) {
    $reader = [IO.StreamReader]::new($zip.GetEntry($name).Open())
    try { [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}
$shared = Read-ZipXml 'xl/sharedStrings.xml'
$strings = @($shared.SelectNodes('//*[local-name()="si"]') | ForEach-Object { $_.InnerText })
$sheet = Read-ZipXml 'xl/worksheets/sheet1.xml'
$rows = @(foreach ($row in $sheet.SelectNodes('//*[local-name()="row"]')) {
    $values = [object[]]::new(28)
    foreach ($cell in $row.SelectNodes('./*[local-name()="c"]')) {
        $letters = $cell.GetAttribute('r') -replace '\d', ''
        $column = 0
        foreach ($letter in $letters.ToCharArray()) { $column = $column * 26 + ([int]$letter - 64) }
        $node = $cell.SelectSingleNode('./*[local-name()="v"]')
        if ($node) {
            $value = $node.InnerText
            if ($cell.GetAttribute('t') -eq 's') { $value = $strings[[int]$value] }
            elseif ($cell.GetAttribute('t') -ne 'e') { $value = [double]::Parse($value, [Globalization.CultureInfo]::InvariantCulture) }
            $values[$column - 1] = $value
        }
    }
    ,$values
})
$materials = @($rows | Where-Object { $_[5] -eq 'Raw Material Part' } | ForEach-Object { [ordered]@{ number = [string]$_[1]; revision = [string]$_[3]; name = [string]$_[4] } } | Sort-Object { $_.number }, { $_.name } -Unique)
$catalog = @($rows | Where-Object { $_[5] -eq 'Catalog Part' } | ForEach-Object { [ordered]@{ number = [string]$_[1]; revision = [string]$_[3]; name = [string]$_[4]; context = [string]$_[9] } } | Sort-Object { $_.number } -Unique)
$data = [ordered]@{ version = '2026-11-12'; source = [IO.Path]::GetFileName($Source); productReference = 'C25N45B250'; sheet = @{ name = 'Default'; rows = $rows }; materials = $materials; catalog = $catalog }
$zip.Dispose()
[IO.File]::WriteAllBytes((Join-Path $root 'assets/BOM_C25N45B250.xlsx'), $bytes)
[IO.File]::WriteAllText((Join-Path $root 'assets/engineering-bom.js'), 'window.ENGINEERING_BOM_DATA = ' + ($data | ConvertTo-Json -Depth 12 -Compress) + ';', [Text.UTF8Encoding]::new($false))
if ($rows[0][0] -ne 'Structure Level' -or $rows[0][25] -ne 'Mass') { throw 'Unexpected engineering BOM headers.' }
Write-Output "Rows: $($rows.Count - 1); unique material records: $($materials.Count); catalog records: $($catalog.Count)"
$materials | ForEach-Object { "$($_.number) | $($_.name)" }
Write-Output 'CATALOG'
$catalog | ForEach-Object { "$($_.number) | $($_.name) | $($_.context)" }