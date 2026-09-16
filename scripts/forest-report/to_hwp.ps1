# 워드(.docx) → PDF, 한글 변환용 HTML → 한글(.hwp) 만들기 (2026-09-16)
#   쓰기: powershell -File scripts\forest-report\to_hwp.ps1 -Name 2026_AI상세페이지_지원사업_추진현황보고_20260916
#   ▸ build_report.py 를 먼저 돌려 .docx 와 _한글용.html 을 만든 뒤 실행한다.
#   ▸ 한글은 .docx 가져오기가 막혀 있어 HTML 을 거친다. 한글이 UTF-8 을 EUC-KR 로 읽으므로
#     _한글용.html 은 반드시 cp949 로 저장돼 있어야 한다(build_report.py 가 그렇게 쓴다).
param([Parameter(Mandatory = $true)][string]$Name)

$dir  = Join-Path $PSScriptRoot "..\..\deliverables\forest-report" | Resolve-Path
$html = Join-Path $dir "_한글용.html"
$docx = Join-Path $dir "$Name.docx"
$hwp  = Join-Path $dir "$Name.hwp"
$pdf  = Join-Path $dir "$Name.pdf"

# 1) 한글 — HTML 을 열어 .hwp 로 저장
$h = New-Object -ComObject HWPFrame.HwpObject
try { $h.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule") } catch { }
$null = $h.Open($html, "HTML", "")
$null = $h.SaveAs($hwp, "HWP", "")
$h.Quit()
"hwp: $hwp (" + (Get-Item $hwp).Length + " bytes)"

# 2) PDF — 워드 파일로 뽑는다(편집 상태가 가장 정확하다)
$word = New-Object -ComObject Word.Application
$word.Visible = $false; $word.DisplayAlerts = 0
$doc = $word.Documents.Open($docx, $false, $true)
$doc.ExportAsFixedFormat($pdf, 17)
$doc.Close($false); $word.Quit()
"pdf: $pdf (" + (Get-Item $pdf).Length + " bytes)"
