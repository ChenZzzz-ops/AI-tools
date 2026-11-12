param([string]$Source = 'C:\Users\sesa814213\Desktop\材料数据库.xlsx')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$root = Split-Path $PSScriptRoot -Parent

# Shared read so the workbook can stay open in Excel.
$stream = [IO.File]::Open($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
$ms = [IO.MemoryStream]::new()
try { $stream.CopyTo($ms) } finally { $stream.Dispose() }
$ms.Position = 0
$zip = [IO.Compression.ZipArchive]::new($ms, [IO.Compression.ZipArchiveMode]::Read)

function Read-ZipXml([string]$Name) {
    $reader = [IO.StreamReader]::new($zip.GetEntry($Name).Open())
    try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}

[xml]$book = Read-ZipXml 'xl/workbook.xml'
[xml]$rels = Read-ZipXml 'xl/_rels/workbook.xml.rels'
[xml]$shared = Read-ZipXml 'xl/sharedStrings.xml'
$strings = @($shared.SelectNodes('//*[local-name()="si"]') | ForEach-Object { $_.InnerText })

$sheet = $book.workbook.sheets.sheet | Where-Object { $_.name -eq 'Plastics' }
if (-not $sheet) { throw 'Plastics 工作表未找到。' }
$rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
$target = ($rels.Relationships.Relationship | Where-Object { $_.Id -eq $rid }).Target
[xml]$sheetXml = Read-ZipXml ('xl/' + $target.TrimStart('/'))

function Column-Number([string]$Ref) {
    $column = 0
    foreach ($letter in ($Ref -replace '\d', '').ToCharArray()) { $column = $column * 26 + ([int]$letter - 64) }
    return $column
}
function Norm([string]$Value) { return ([string]$Value).ToLower() -replace '[^a-z0-9]', '' }

$rows = @($sheetXml.SelectNodes('//*[local-name()="row"]'))
$header = [object[]]::new(80)
foreach ($cell in $rows[0].SelectNodes('./*[local-name()="c"]')) {
    $node = $cell.SelectSingleNode('./*[local-name()="v"]')
    $value = if ($node) { $node.InnerText } else { '' }
    if ($cell.GetAttribute('t') -eq 's') { $value = $strings[[int]$value] }
    $header[(Column-Number $cell.GetAttribute('r')) - 1] = Norm $value
}
function Header-Index([string]$Name) {
    for ($index = 0; $index -lt $header.Length; $index++) { if ($header[$index] -eq $Name) { return $index } }
    return -1
}
$numCol = Header-Index 'number'
$nameCol = Header-Index 'namerawmaterialpart'
$longDescCol = Header-Index 'longdescriptionrawmaterialpart'
$resinCol = Header-Index 'resin'
$frCol = Header-Index 'flameretardant'
$addCol = Header-Index 'additive'
$rohsCol = Header-Index 'rohscompliancerawmaterialpart'
$reachCol = Header-Index 'reachcompliancerawmaterialpart'
$stateCol = Header-Index 'staterawmaterialpart'
$classCol = Header-Index 'technicalclassificationrawmaterialpart'
$policyCol = Header-Index 'corporatepolicycompliancerawmaterialpart'
foreach ($pair in @(@('Number', $numCol), @('Resin', $resinCol), @('Flame retardant', $frCol), @('Additive', $addCol), @('Name', $nameCol))) {
    if ($pair[1] -lt 0) { throw "缺少 $($pair[0]) 列。" }
}

$records = New-Object System.Collections.Generic.List[object]
$resins = @{}; $frs = @{}; $adds = @{}
$rowCells = [System.Collections.Generic.Dictionary[int, object]]::new()
foreach ($cell in $sheetXml.SelectNodes('//*[local-name()="row"]/*[local-name()="c"]')) {
    $ref = $cell.GetAttribute('r')
    $rowIndex = [int]($ref -replace '[A-Z]+', '')
    if (-not $rowCells.ContainsKey($rowIndex)) { $rowCells[$rowIndex] = [object[]]::new(80) }
    $node = $cell.SelectSingleNode('./*[local-name()="v"]')
    $value = if ($node) { $node.InnerText } else { '' }
    if ($cell.GetAttribute('t') -eq 's') { $value = $strings[[int]$value] }
    $rowCells[$rowIndex][(Column-Number $ref) - 1] = $value
}
foreach ($rowIndex in ($rowCells.Keys | Sort-Object)) {
    if ($rowIndex -le 1) { continue }
    $values = $rowCells[$rowIndex]
    $spn = [string]$values[$numCol]
    if (-not $spn) { continue }
    $resin = [string]$values[$resinCol]; $fr = [string]$values[$frCol]; $additive = [string]$values[$addCol]
    $records.Add([ordered]@{
        spn = $spn
        name = [string]$values[$nameCol]
        resin = $resin
        fr = $fr
        additive = $additive
        rohs = [string]$values[$rohsCol]
        reach = [string]$values[$reachCol]
        state = [string]$values[$stateCol]
        classification = [string]$values[$classCol]
        policy = [string]$values[$policyCol]
        description = [string]$values[$longDescCol]
    })
    if ($resin) { $resins[$resin] = $true }; if ($fr) { $frs[$fr] = $true }; if ($additive) { $adds[$additive] = $true }
}
$bytes = $ms.ToArray()
$zip.Dispose(); $ms.Dispose()

$data = [ordered]@{ version = '2026-11-12'; source = [IO.Path]::GetFileName($Source); records = $records }
[IO.File]::WriteAllText((Join-Path $root 'assets/materials-db.js'), 'window.MATERIALS_DB = ' + ($data | ConvertTo-Json -Depth 6 -Compress) + ';', [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllBytes((Join-Path $root 'assets/材料数据库.xlsx'), $bytes)

Write-Output "Material records: $($records.Count)"
Write-Output 'RESIN:'
$resins.Keys | Sort-Object | ForEach-Object { "  $_" }
Write-Output 'FLAME RETARDANT:'
$frs.Keys | Sort-Object | ForEach-Object { "  [$_]" }
Write-Output 'ADDITIVE:'
$adds.Keys | Sort-Object | ForEach-Object { "  $_" }
