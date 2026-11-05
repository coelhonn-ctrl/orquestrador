# Instalador do Singularize Orquestrador para Windows.
# Confere o Node.js (instala pelo winget se faltar), instala as dependências
# e cria atalhos na área de trabalho e no menu Iniciar.
$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
Set-Location $Raiz
Write-Host ''
Write-Host '  Singularize Orquestrador - instalação' -ForegroundColor Magenta
Write-Host ''

# Lê a versão por "node -v" (ex.: v22.11.0). Não usamos "node -p '...'" porque o
# PowerShell 5 remove aspas internas ao chamar programas e o teste falhava mesmo com o Node instalado.
function Versao-Node {
  try {
    $v = (& node -v 2>$null | Select-Object -First 1)
    if ($v -match '^v?(\d+)\.') { return [int]$Matches[1] }
  } catch {}
  return 0
}

function Recarregar-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# 1. Node.js 18+
$Versao = Versao-Node
if ($Versao -lt 18) {
  if ($Versao -gt 0) {
    Write-Host ("Seu Node.js é a versão " + (node -v) + ". O app precisa da 18 ou mais nova.") -ForegroundColor Yellow
  } else {
    Write-Host 'Node.js não encontrado neste terminal.' -ForegroundColor Yellow
    Write-Host '  Se você usa nvm-windows, rode "nvm use <versão>" num terminal e execute este instalador de novo por ele.'
  }
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $Resposta = Read-Host 'Instalar o Node.js LTS pelo winget agora? (s/N)'
    if ($Resposta -match '^[sS]') {
      winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
      Recarregar-Path
    }
  }
  if ((Versao-Node) -lt 18) {
    Write-Host 'Instale o Node.js 18 ou mais novo (versão LTS) e rode este instalador de novo.' -ForegroundColor Red
    Start-Process 'https://nodejs.org'
    Read-Host 'Enter para fechar'
    exit 1
  }
}
Write-Host ("Node.js " + (node -v) + " ok") -ForegroundColor Green

# 2. Dependências e configuração
if (-not (Test-Path '.env')) { Copy-Item '.env.exemplo' '.env' }
Write-Host 'Instalando dependências (pode levar um minuto)...'
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Host 'A instalação das dependências falhou. Veja as mensagens acima.' -ForegroundColor Red; Read-Host 'Enter para fechar'; exit 1 }

# 3. Atalhos
$Shell = New-Object -ComObject WScript.Shell
$Destinos = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Singularize')
)
foreach ($Pasta in $Destinos) {
  if (-not (Test-Path $Pasta)) { New-Item -ItemType Directory -Path $Pasta | Out-Null }
  $Atalho = $Shell.CreateShortcut((Join-Path $Pasta 'Singularize Orquestrador.lnk'))
  $Atalho.TargetPath = Join-Path $Raiz 'iniciar.cmd'
  $Atalho.WorkingDirectory = $Raiz
  $Atalho.IconLocation = Join-Path $Raiz 'instalador\icone.ico'
  $Atalho.Description = 'Orquestrador geral de IAs de terminal'
  $Atalho.Save()
}
Write-Host 'Atalhos criados na área de trabalho e no menu Iniciar.' -ForegroundColor Green
Write-Host ''
Write-Host 'Pronto. Abra pelo atalho "Singularize Orquestrador". A janela preta precisa ficar aberta enquanto você usa o app.'
Write-Host ''
$Resposta = Read-Host 'Abrir agora? (S/n)'
if ($Resposta -notmatch '^[nN]') { Start-Process (Join-Path $Raiz 'iniciar.cmd') -WorkingDirectory $Raiz }
