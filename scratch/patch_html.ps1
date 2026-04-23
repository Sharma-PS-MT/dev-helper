$path = 'd:\CSI\OTHER\csi-helper\src\app\pages\json-viewer\json-viewer.component.html'
$content = [System.IO.File]::ReadAllText($path)
$content = $content.Replace('mat-icon-button class="copy-result-btn"', 'class="copy-result-btn"')
[System.IO.File]::WriteAllText($path, $content)
Write-Host "Done"
