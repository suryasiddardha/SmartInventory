param(
    [string]$OutputPath = "outputs/retrospective-template/sprint-retrospective-template.xlsx"
)

$ErrorActionPreference = "Stop"

function New-PartFile {
    param(
        [string]$Path,
        [string]$Content
    )

    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

function ConvertTo-Cell {
    param(
        [string]$Reference,
        [string]$Text,
        [int]$Style
    )

    $escaped = [System.Security.SecurityElement]::Escape($Text)
    return "<c r=`"$Reference`" s=`"$Style`" t=`"inlineStr`"><is><t xml:space=`"preserve`">$escaped</t></is></c>"
}

$fullOutputPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
$outputDirectory = Split-Path -Parent $fullOutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$buildRoot = Join-Path $env:TEMP ("retrospective-xlsx-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null

try {
    $title = "Sprint Retrospective"
    $headers = @(
        "What went well",
        "What went poorly",
        "What ideas do you have",
        "How should we take action"
    )
    $instructions = @(
        "This section highlights the successes and positive outcomes from the sprint. It helps the team recognize achievements and identify practices that should be continued.",
        "This section identifies the challenges, roadblocks, or failures encountered during the sprint. It helps pinpoint areas that need improvement or change.",
        "This section is for brainstorming new approaches, tools, or strategies to enhance the team's efficiency, productivity, or project outcomes.",
        "This section outlines specific steps or solutions to address the issues and implement the ideas discussed, ensuring continuous improvement in future sprints."
    )

    $rows = @()
    $rows += "<row r=`"1`" ht=`"22`" customHeight=`"1`">$(ConvertTo-Cell -Reference "A1" -Text $title -Style 1)</row>"

    $headerCells = for ($i = 0; $i -lt 4; $i++) {
        ConvertTo-Cell -Reference ([char](65 + $i) + "2") -Text $headers[$i] -Style 2
    }
    $rows += "<row r=`"2`" ht=`"24`" customHeight=`"1`">$($headerCells -join '')</row>"

    $instructionCells = for ($i = 0; $i -lt 4; $i++) {
        ConvertTo-Cell -Reference ([char](65 + $i) + "3") -Text $instructions[$i] -Style 3
    }
    $rows += "<row r=`"3`" ht=`"82`" customHeight=`"1`">$($instructionCells -join '')</row>"

    for ($rowNumber = 4; $rowNumber -le 8; $rowNumber++) {
        $blankCells = for ($i = 0; $i -lt 4; $i++) {
            ConvertTo-Cell -Reference ([char](65 + $i) + $rowNumber) -Text "" -Style 4
        }
        $rows += "<row r=`"$rowNumber`" ht=`"62`" customHeight=`"1`">$($blankCells -join '')</row>"
    }

    $sheetXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A4" sqref="A4"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="4" width="38" customWidth="1"/>
  </cols>
  <sheetData>
    $($rows -join "`n    ")
  </sheetData>
  <mergeCells count="1">
    <mergeCell ref="A1:D1"/>
  </mergeCells>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
</worksheet>
"@

    $stylesXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF000000"/><name val="Cambria"/><family val="2"/></font>
    <font><i/><sz val="10"/><color rgb="FF000000"/><name val="Cambria"/><family val="2"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF18A8D8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF7FB3E0"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>
"@

    $workbookXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sprint Retrospective" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>
"@

    $workbookRelsXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"@

    $rootRelsXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"@

    $contentTypesXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"@

    $created = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $coreXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Sprint Retrospective Template</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">$created</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">$created</dcterms:modified>
</cp:coreProperties>
"@

    $appXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Excel</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Sprint Retrospective</vt:lpstr></vt:vector></TitlesOfParts>
  <Company></Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0300</AppVersion>
</Properties>
"@

    New-PartFile -Path (Join-Path $buildRoot "[Content_Types].xml") -Content $contentTypesXml
    New-PartFile -Path (Join-Path $buildRoot "_rels/.rels") -Content $rootRelsXml
    New-PartFile -Path (Join-Path $buildRoot "docProps/core.xml") -Content $coreXml
    New-PartFile -Path (Join-Path $buildRoot "docProps/app.xml") -Content $appXml
    New-PartFile -Path (Join-Path $buildRoot "xl/workbook.xml") -Content $workbookXml
    New-PartFile -Path (Join-Path $buildRoot "xl/_rels/workbook.xml.rels") -Content $workbookRelsXml
    New-PartFile -Path (Join-Path $buildRoot "xl/worksheets/sheet1.xml") -Content $sheetXml
    New-PartFile -Path (Join-Path $buildRoot "xl/styles.xml") -Content $stylesXml

    if (Test-Path -LiteralPath $fullOutputPath) {
        Remove-Item -LiteralPath $fullOutputPath -Force
    }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open($fullOutputPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $rootPrefix = $buildRoot.TrimEnd("\") + "\"
        Get-ChildItem -LiteralPath $buildRoot -File -Recurse | ForEach-Object {
            $relativePath = $_.FullName.Substring($rootPrefix.Length).Replace("\", "/")
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relativePath) | Out-Null
        }
    }
    finally {
        $zip.Dispose()
    }

    Write-Output $fullOutputPath
}
finally {
    if (Test-Path -LiteralPath $buildRoot) {
        Remove-Item -LiteralPath $buildRoot -Recurse -Force
    }
}
