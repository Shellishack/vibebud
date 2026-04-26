# Show-CatToast.ps1
# Pink-framed random-cat toast with a progress bar.
#
# Requires: BurntToast (Install-Module BurntToast -Scope CurrentUser)

[CmdletBinding()]
param(
    [string]$Title    = "Meow",
    [string]$Message  = "Here's your random cat",
    [double]$Progress = 0.42,
    [string]$Status   = "Petting cat..."
)

Add-Type -AssemblyName System.Drawing

$tmpDir   = Join-Path $env:TEMP "CatToast"
if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir | Out-Null }
$catRaw   = Join-Path $tmpDir "cat_raw.jpg"
$heroPath = Join-Path $tmpDir "cat_hero.png"
$logoPath = Join-Path $tmpDir "cat_logo.png"

# 1. Random cat. cataas.com returns a fresh random cat each call.
Invoke-WebRequest -Uri "https://cataas.com/cat" -OutFile $catRaw -UseBasicParsing

# 2. Composite onto a pink banner (toast hero image is 364x180 at standard DPI).
$W, $H = 364, 180
$pink     = [System.Drawing.Color]::FromArgb(255, 255, 105, 180)  # hot pink
$pinkSoft = [System.Drawing.Color]::FromArgb(255, 255, 182, 213)

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode    = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'

# pink gradient background
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $pinkSoft, $pink, ([System.Drawing.Drawing2D.LinearGradientMode]::Horizontal)
$g.FillRectangle($brush, $rect)

# draw cat scaled to fit, centered
$cat = [System.Drawing.Image]::FromFile($catRaw)
$scale = [Math]::Min($W / $cat.Width, $H / $cat.Height)
$cw = [int]($cat.Width  * $scale)
$ch = [int]($cat.Height * $scale)
$cx = [int](($W - $cw) / 2)
$cy = [int](($H - $ch) / 2)
$g.DrawImage($cat, $cx, $cy, $cw, $ch)

# pink border
$pen = New-Object System.Drawing.Pen $pink, 6
$g.DrawRectangle($pen, 0, 0, $W - 1, $H - 1)

$bmp.Save($heroPath, [System.Drawing.Imaging.ImageFormat]::Png)

# 3. Square pink logo crop for app logo.
$L = 96
$logo = New-Object System.Drawing.Bitmap $L, $L
$lg   = [System.Drawing.Graphics]::FromImage($logo)
$lg.SmoothingMode = 'AntiAlias'
$lg.InterpolationMode = 'HighQualityBicubic'
$lg.FillRectangle((New-Object System.Drawing.SolidBrush $pink), 0, 0, $L, $L)
$side = [Math]::Min($cat.Width, $cat.Height)
$srcRect = New-Object System.Drawing.Rectangle ([int](($cat.Width - $side)/2)), ([int](($cat.Height - $side)/2)), $side, $side
$dstRect = New-Object System.Drawing.Rectangle 4, 4, ($L - 8), ($L - 8)
$lg.DrawImage($cat, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$logo.Save($logoPath, [System.Drawing.Imaging.ImageFormat]::Png)

$cat.Dispose(); $g.Dispose(); $bmp.Dispose(); $lg.Dispose(); $logo.Dispose(); $brush.Dispose(); $pen.Dispose()

# 4. Toast.
Import-Module BurntToast -ErrorAction Stop
$bar = New-BTProgressBar -Title "Cat delivery" -Status $Status -Value $Progress -ValueDisplay ("{0:P0}" -f $Progress)
New-BurntToastNotification `
    -Text $Title, $Message `
    -AppLogo $logoPath `
    -HeroImage $heroPath `
    -ProgressBar $bar
