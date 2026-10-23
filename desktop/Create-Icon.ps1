param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$image = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($image)
$graphics.SmoothingMode = 'AntiAlias'
$graphics.TextRenderingHint = 'AntiAliasGridFit'
$graphics.Clear([System.Drawing.Color]::Transparent)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(4,4,80,80,180,90)
$path.AddArc(172,4,80,80,270,90)
$path.AddArc(172,172,80,80,0,90)
$path.AddArc(4,172,80,80,90,90)
$path.CloseFigure()
$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0,0)),([System.Drawing.Point]::new(256,256)),([System.Drawing.Color]::FromArgb(135,104,255)),([System.Drawing.Color]::FromArgb(69,71,200))
$graphics.FillPath($gradient,$path)
$font = New-Object System.Drawing.Font 'Segoe UI',146,([System.Drawing.FontStyle]::Bold),([System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = 'Center'
$format.LineAlignment = 'Center'
$graphics.DrawString('C',$font,[System.Drawing.Brushes]::White,([System.Drawing.RectangleF]::new(0,-7,256,256)),$format)
$memory = New-Object System.IO.MemoryStream
$image.Save($memory,[System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $memory.ToArray()
$stream = [System.IO.File]::Create($OutputPath)
$writer = New-Object System.IO.BinaryWriter $stream
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([UInt16]1); $writer.Write([UInt16]32)
$writer.Write([UInt32]$bytes.Length); $writer.Write([UInt32]22); $writer.Write($bytes)
$writer.Dispose(); $memory.Dispose(); $format.Dispose(); $font.Dispose(); $gradient.Dispose(); $path.Dispose(); $graphics.Dispose(); $image.Dispose()
