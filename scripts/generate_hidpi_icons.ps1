Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $projectRoot "build"
$publicDir = Join-Path $projectRoot "public"
$distDir = Join-Path $projectRoot "dist"

if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir -Force }
if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir -Force }
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir -Force }

function Draw-ECLogo([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    
    $scale = $size / 24.0
    
    # Chassis background (Dark graphite rounded rectangle)
    $rectX = 2.0 * $scale
    $rectY = 2.0 * $scale
    $rectW = 20.0 * $scale
    $rectH = 20.0 * $scale
    $radius = 5.5 * $scale
    
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2.0
    $path.AddArc($rectX, $rectY, $diameter, $diameter, 180, 90)
    $path.AddArc($rectX + $rectW - $diameter, $rectY, $diameter, $diameter, 270, 90)
    $path.AddArc($rectX + $rectW - $diameter, $rectY + $rectH - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($rectX, $rectY + $rectH - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 18, 19, 22))
    $g.FillPath($bgBrush, $path)
    
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 55, 60, 75), (1.2 * $scale))
    $g.DrawPath($borderPen, $path)
    
    # Cyan to Indigo Gradient for EC monogram
    $gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF((4.0 * $scale), (4.0 * $scale))),
        (New-Object System.Drawing.PointF((20.0 * $scale), (20.0 * $scale))),
        [System.Drawing.Color]::FromArgb(255, 56, 189, 248),   # Cyan 400
        [System.Drawing.Color]::FromArgb(255, 129, 140, 248)  # Indigo 400
    )
    $logoPen = New-Object System.Drawing.Pen($gradBrush, (1.8 * $scale))
    $logoPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $logoPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $logoPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    
    # E Monogram: (10, 7.5) -> (5.5, 7.5) -> (5.5, 16.5) -> (10, 16.5) and middle bar (5.5, 12) -> (8.8, 12)
    $pE1 = New-Object System.Drawing.PointF((10.0 * $scale), (7.5 * $scale))
    $pE2 = New-Object System.Drawing.PointF((5.5 * $scale), (7.5 * $scale))
    $pE3 = New-Object System.Drawing.PointF((5.5 * $scale), (16.5 * $scale))
    $pE4 = New-Object System.Drawing.PointF((10.0 * $scale), (16.5 * $scale))
    $g.DrawLines($logoPen, @($pE1, $pE2, $pE3, $pE4))
    
    $pEm1 = New-Object System.Drawing.PointF((5.5 * $scale), (12.0 * $scale))
    $pEm2 = New-Object System.Drawing.PointF((8.8 * $scale), (12.0 * $scale))
    $g.DrawLine($logoPen, $pEm1, $pEm2)
    
    # C Monogram: (18.5, 7.5) -> (14.5, 7.5) -> Arc/corner to (12.5, 9.5) -> (12.5, 14.5) -> (14.5, 16.5) -> (18.5, 16.5)
    $pC = New-Object System.Drawing.Drawing2D.GraphicsPath
    $pC.AddLine((18.5 * $scale), (7.5 * $scale), (14.5 * $scale), (7.5 * $scale))
    $cRadius = 2.0 * $scale
    $cDiam = $cRadius * 2.0
    $pC.AddArc((12.5 * $scale), (7.5 * $scale), $cDiam, $cDiam, 270, -90)
    $pC.AddLine((12.5 * $scale), (9.5 * $scale), (12.5 * $scale), (14.5 * $scale))
    $pC.AddArc((12.5 * $scale), (16.5 * $scale - $cDiam), $cDiam, $cDiam, 180, -90)
    $pC.AddLine((14.5 * $scale), (16.5 * $scale), (18.5 * $scale), (16.5 * $scale))
    $g.DrawPath($logoPen, $pC)
    
    # Prompt dot: circle cx=18.5, cy=12, r=1
    $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 56, 189, 248))
    $dotX = (18.5 - 1.0) * $scale
    $dotY = (12.0 - 1.0) * $scale
    $dotDiam = 2.0 * $scale
    $g.FillEllipse($dotBrush, $dotX, $dotY, $dotDiam, $dotDiam)
    
    $g.Dispose()
    return $bmp
}

# 1. Generate 512x512 Master PNG
$masterPng = Draw-ECLogo 512
$masterPngPath = Join-Path $buildDir "icon.png"
$masterPng.Save($masterPngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Also copy to public/icon.png and dist/icon.png
$masterPng.Save((Join-Path $publicDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$masterPng.Save((Join-Path $distDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)

Write-Host "Generated crisp 512x512 icon.png in build, public, and dist."

# 2. Generate Multi-Resolution ICO (16, 24, 32, 48, 64, 128, 256)
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$pngDataList = @()

foreach ($sz in $icoSizes) {
    $bmp = Draw-ECLogo $sz
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $ms.ToArray()
    $ms.Dispose()
    $bmp.Dispose()
    
    $pngDataList += [PSCustomObject]@{
        Size  = $sz
        Bytes = $pngBytes
    }
}

# Assemble ICO binary format
$icoStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($icoStream)

# Header: Reserved (0), Type (1), Count
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$pngDataList.Count)

$offset = 6 + (16 * $pngDataList.Count)

foreach ($entry in $pngDataList) {
    $bWidth = if ($entry.Size -eq 256) { [byte]0 } else { [byte]$entry.Size }
    $bHeight = if ($entry.Size -eq 256) { [byte]0 } else { [byte]$entry.Size }
    $writer.Write($bWidth)               # Width
    $writer.Write($bHeight)              # Height
    $writer.Write([byte]0)               # Colors
    $writer.Write([byte]0)               # Reserved
    $writer.Write([uint16]1)             # Color planes
    $writer.Write([uint16]32)            # Bits per pixel
    $writer.Write([uint32]$entry.Bytes.Length) # Size in bytes
    $writer.Write([uint32]$offset)       # Offset of image data
    
    $offset += $entry.Bytes.Length
}

# Image Data
foreach ($entry in $pngDataList) {
    $writer.Write($entry.Bytes)
}

$writer.Flush()
$icoBytes = $icoStream.ToArray()
$writer.Dispose()
$icoStream.Dispose()

$icoPath = Join-Path $buildDir "icon.ico"
[System.IO.File]::WriteAllBytes($icoPath, $icoBytes)
[System.IO.File]::WriteAllBytes((Join-Path $distDir "icon.ico"), $icoBytes)

Write-Host "Generated multi-resolution HiDPI icon.ico ($($icoBytes.Length) bytes) with $(($icoSizes -join ', '))px layers!"
