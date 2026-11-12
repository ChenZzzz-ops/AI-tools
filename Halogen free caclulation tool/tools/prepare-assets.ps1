param(
    [string]$Source = 'C:\Users\sesa814213\Desktop\Halogen free calculation summary_2026\done_Halogen verification for MCCB_31107.xlsx'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path $PSScriptRoot -Parent
$assets = Join-Path $root 'assets'
$vendor = Join-Path $root 'vendor'
[IO.Directory]::CreateDirectory($assets) | Out-Null
[IO.Directory]::CreateDirectory($vendor) | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$zip = [IO.Compression.ZipFile]::OpenRead($Source)
function Read-ZipXml([string]$Entry) {
    $reader = [IO.StreamReader]::new($zip.GetEntry($Entry).Open())
    try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}
$shared = Read-ZipXml 'xl/sharedStrings.xml'
$strings = @($shared.SelectNodes('//*[local-name()="si"]') | ForEach-Object { $_.InnerText })
function Get-Cells($Document) {
    $values = @{}
    foreach ($cell in $Document.SelectNodes('//*[local-name()="c"]')) {
        $node = $cell.SelectSingleNode('./*[local-name()="v"]')
        if ($node) {
            $value = $node.InnerText
            if ($cell.GetAttribute('t') -eq 's') { $value = $strings[[int]$value] }
            $values[$cell.GetAttribute('r')] = $value
        }
    }
    return $values
}
function Convert-Number($Value) {
    return [double]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture)
}
$calc = Get-Cells (Read-ZipXml 'xl/worksheets/sheet3.xml')
$report = Get-Cells (Read-ZipXml 'xl/worksheets/sheet2.xml')
$parts = @(foreach ($row in 8..62) {
    if (-not $calc["B$row"]) { continue }
    $mass = Convert-Number $calc["C$row"]
    $mode = switch ($calc["F$row"]) {
        'Known halogen content' { 'known' }
        'Material is compliant to EN50642' { 'compliant' }
        'No information' { 'estimated' }
        default { 'unknown' }
    }
    $values = @{}
    foreach ($element in @(@('cl','G'), @('br','I'), @('f','K'), @('i','N'))) {
        $value = $calc["$($element[1])$row"]
        $values[$element[0]] = if ($null -ne $value -and $value -ne '') { (Convert-Number $value) / $mass * 1000000 } else { $null }
    }
    [ordered]@{
        id = "sample-$row"; name = $calc["B$row"]; spn = $calc["D$row"]; material = $calc["E$row"]
        category = 'plastic'; quantity = 1; unitMass = $mass; mode = $mode; values = $values
        resin = $calc["O$row"]; fr = $calc["P$row"]; additive = $calc["Q$row"]
        evidence = "Original workbook: Calculation, row $row"
    }
})
$auditRows = [ordered]@{ pvc = 19; cable = 21; pcb = 23; consumable = 25; electronic = 27; gas = 29 }
$audits = @{}
foreach ($key in $auditRows.Keys) {
    $row = $auditRows[$key]
    $audits[$key] = @{ status = $report["C$row"].ToLower().Replace('pass','pass'); evidence = $report["D$row"] }
}
$plastics = Get-Cells (Read-ZipXml 'xl/worksheets/sheet4.xml')
$materials = @(foreach ($row in 2..3465) {
    if ($plastics["AN$row"]) {
        [ordered]@{ spn = $plastics["AN$row"]; resin = $plastics["AO$row"]; fr = $plastics["AP$row"]; additive = $plastics["AQ$row"] }
    }
})
$data = [ordered]@{
    source = [IO.Path]::GetFileName($Source)
    product = @{ name = 'MCCB 31107'; reference = $report['E31']; bom = '31107'; reviewer = $report['B4'] }
    parts = $parts; audits = $audits; materials = $materials
    original = @{ plasticVerdict = $calc['G2']; auditVerdict = $report['C18']; brGrams = (Convert-Number $calc['S3']); fGrams = (Convert-Number $calc['T3']); totalFraction = (Convert-Number $calc['AA3']) }
}
$zip.Dispose()
[IO.File]::WriteAllText((Join-Path $assets 'data.js'), 'window.HALOGEN_DATA = ' + ($data | ConvertTo-Json -Depth 12 -Compress) + ';', $utf8)
[IO.File]::WriteAllText((Join-Path $assets 'template.js'), 'window.HALOGEN_TEMPLATE = "' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($Source)) + '";', $utf8)
Copy-Item -LiteralPath $Source -Destination (Join-Path $assets 'original-template.xlsx')
$packages = @(
    @('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 'xlsx.full.min.js'),
    @('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'jszip.min.js'),
    @('https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js', 'chart.umd.min.js'),
    @('https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js', 'lucide.min.js')
)
foreach ($package in $packages) {
    $target = Join-Path $vendor $package[1]
    if (-not (Test-Path $target)) { Invoke-WebRequest $package[0] -UseBasicParsing -OutFile $target }
    Write-Output "Dependency: $($package[1]) ($((Get-Item $target).Length) bytes)"
}
$licenses = @(
    @('https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE', 'SheetJS-LICENSE.txt'),
    @('https://cdn.jsdelivr.net/npm/jszip@3.10.1/LICENSE.markdown', 'JSZip-LICENSE.txt'),
    @('https://cdn.jsdelivr.net/npm/chart.js@4.4.7/LICENSE.md', 'ChartJS-LICENSE.txt'),
    @('https://cdn.jsdelivr.net/npm/lucide@0.468.0/LICENSE', 'Lucide-LICENSE.txt'),
    @('https://raw.githubusercontent.com/google/fonts/main/ofl/barlow/OFL.txt', 'Barlow-OFL.txt')
)
foreach ($license in $licenses) {
    $target = Join-Path $vendor $license[1]
    if (-not (Test-Path $target)) { Invoke-WebRequest $license[0] -UseBasicParsing -OutFile $target }
}
$homepage = (Invoke-WebRequest 'https://www.se.com/ww/en/' -UseBasicParsing).Content
$logoMatch = [regex]::Match($homepage, 'src-selogo-web="(data:image/svg\+xml,[^"]+)"')
if (-not $logoMatch.Success) { throw 'Official logo not found in Schneider Electric header.' }
$logo = [Uri]::UnescapeDataString($logoMatch.Groups[1].Value.Substring('data:image/svg+xml,'.Length))
[IO.File]::WriteAllText((Join-Path $assets 'schneider-electric.svg'), $logo, $utf8)
$fontCss = (Invoke-WebRequest 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&display=swap' -UseBasicParsing).Content
foreach ($font in [regex]::Matches($fontCss, '(?s)@font-face\s*\{[^}]+\}')) {
    $weight = [regex]::Match($font.Value, 'font-weight:\s*(\d+)').Groups[1].Value
    $url = [regex]::Match($font.Value, 'https://[^)\s]+').Value
    if ($weight -and $url) { Invoke-WebRequest $url -UseBasicParsing -OutFile (Join-Path $assets "barlow-$weight.ttf") }
}
Write-Output "Prepared $($parts.Count) sample parts, $($materials.Count) material records."
Write-Output "Original: Br=$($data.original.brGrams) g; F=$($data.original.fGrams) g; total=$($data.original.totalFraction)."
if ($parts.Count -ne 13 -or [Math]::Abs($data.original.brGrams - 7.0493968338683768) -gt 0.00000001) { throw 'Source workbook regression failed.' }