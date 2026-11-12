$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$distribution = Join-Path $root 'dist'
[IO.Directory]::CreateDirectory($distribution) | Out-Null
$encoding = [Text.UTF8Encoding]::new($false)
$html = [IO.File]::ReadAllText((Join-Path $root 'app.html'), $encoding)
if (-not $html.Contains('id="toast-region"') -or -not $html.Contains('class="brand"') -or $html.Contains('name=Generator') -or $html.Contains('name="Generator"')) { throw 'Application HTML structure is invalid or was converted by an external editor.' }
$css = [IO.File]::ReadAllText((Join-Path $root 'styles.css'), $encoding)
foreach ($weight in @(400, 500, 600, 700)) {
    $font = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root "assets/barlow-$weight.ttf")))
    $css = $css.Replace("assets/barlow-$weight.ttf", "data:font/ttf;base64,$font")
}
$html = $html.Replace('<link rel="stylesheet" href="styles.css">', "<style>$css</style>")
$scripts = [Collections.Generic.List[string]]::new()
$matches = [regex]::Matches($html, '<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*</script>')
$required = @('vendor/xlsx.full.min.js','vendor/jszip.min.js','vendor/chart.umd.min.js','vendor/lucide.min.js','assets/data.js','assets/template.js','engine.js','workbook.js','assets/engineering-bom.js','assets/materials-db.js','recognition.js','app.js')
$scriptPaths = @($matches | ForEach-Object { $_.Groups[1].Value })
if ($scriptPaths.Count -ne $required.Count -or @($required | Where-Object { $_ -notin $scriptPaths }).Count -gt 0) { throw "Expected application scripts ($($required -join ', ')); refusing to build an incomplete bundle." }
foreach ($match in $matches) {
    $path = Join-Path $root $match.Groups[1].Value
    $script = [IO.File]::ReadAllText($path, $encoding)
    $script = [regex]::Replace($script, '</script', '<\/script', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $scripts.Add('<script>' + $script + '</script>')
    $html = $html.Replace($match.Value, '')
}
$logo = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'assets/schneider-electric.svg')))
$html = $html.Replace('assets/schneider-electric.svg', "data:image/svg+xml;base64,$logo")
$templateLink = @'
<script>
const originalTemplateUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(window.HALOGEN_TEMPLATE), character => character.charCodeAt(0))], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
document.querySelectorAll('a[href="assets/original-template.xlsx"]').forEach(anchor => { anchor.href = originalTemplateUrl; anchor.download = 'Original_Halogen_Verification_31107.xlsx'; });
</script>
'@
$licenseText = [IO.File]::ReadAllText((Join-Path $root 'THIRD_PARTY_NOTICES.md'), $encoding)
foreach ($name in @('SheetJS-LICENSE.txt', 'JSZip-LICENSE.txt', 'ChartJS-LICENSE.txt', 'Lucide-LICENSE.txt', 'Barlow-OFL.txt')) {
    $licenseText += [Environment]::NewLine + [Environment]::NewLine + $name + [Environment]::NewLine + [IO.File]::ReadAllText((Join-Path $root "vendor/$name"), $encoding)
}
[IO.File]::WriteAllText((Join-Path $distribution 'Third-Party-Licenses.txt'), $licenseText, $encoding)
$licenseMarkup = '<template id="third-party-licenses">' + [Security.SecurityElement]::Escape($licenseText) + '</template>'
$html = $html.Replace('</body>', ($scripts -join [Environment]::NewLine) + $templateLink + $licenseMarkup + [Environment]::NewLine + '</body>')
$target = Join-Path $distribution 'Halogen-Free.html'
[IO.File]::WriteAllText($target, $html, $encoding)
if ([regex]::IsMatch($html, '<script[^>]+src=') -or $html.Contains('href="styles.css"') -or $html.Contains("url('assets/")) { throw 'Standalone bundle still references an external runtime resource.' }
Write-Output "Built $target"
Write-Output "Size: $([Math]::Round((Get-Item $target).Length / 1MB, 2)) MB; 4 local fonts; all JavaScript and original template embedded."