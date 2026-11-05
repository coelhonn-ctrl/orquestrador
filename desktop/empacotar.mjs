// Gera os instaladores do app de desktop.
//   node desktop/empacotar.mjs win    -> dist/Singularize-Orquestrador-Setup-<versão>.exe
//   node desktop/empacotar.mjs linux  -> dist/Singularize-Orquestrador-<versão>.AppImage
// Funciona a partir do Linux, sem wine: o ícone do .exe é gravado com resedit e o instalador
// é montado direto com o makensis.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
const versao = pkg.version;
const alvo = process.argv[2];
const NOME = 'Singularize Orquestrador';
const EXE = `${pkg.build.executableName}.exe`;
const rodar = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: raiz, ...opts });

const builder = path.join(raiz, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');

// O npm só instala o binário do terminal do sistema atual; para o Windows baixamos o pacote dele.
const garantirPtyWindows = () => {
  const destino = path.join(raiz, 'node_modules', '@lydell', 'node-pty-win32-x64');
  if (fs.existsSync(path.join(destino, 'package.json'))) return destino;
  const versaoPty = JSON.parse(fs.readFileSync(path.join(raiz, 'node_modules', '@lydell', 'node-pty', 'package.json'), 'utf8')).version;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-win-'));
  rodar('npm', ['pack', `@lydell/node-pty-win32-x64@${versaoPty}`, '--pack-destination', tmp]);
  const tgz = fs.readdirSync(tmp).find((n) => n.endsWith('.tgz'));
  fs.mkdirSync(destino, { recursive: true });
  rodar('tar', ['xzf', path.join(tmp, tgz), '-C', destino, '--strip-components=1']);
  return destino;
};

const gravarIconeEVersao = async (exe) => {
  const ResEdit = await import('resedit');
  const executavel = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const recursos = ResEdit.NtExecutableResource.from(executavel);
  const icone = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(raiz, 'instalador', 'icone.ico')));
  const grupos = ResEdit.Resource.IconGroupEntry.fromEntries(recursos.entries);
  const grupo = grupos[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    recursos.entries,
    grupo?.id ?? 1,
    grupo?.lang ?? 1033,
    icone.icons.map((i) => i.data),
  );
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(recursos.entries);
  if (info) {
    const [a, b, c] = versao.split('.').map(Number);
    info.setFileVersion(a, b, c, 0, 1033);
    info.setProductVersion(a, b, c, 0, 1033);
    for (const lang of info.getAllLanguagesForStringValues()) {
      info.setStringValues(lang, {
        FileDescription: NOME,
        ProductName: NOME,
        CompanyName: 'Singularize',
        OriginalFilename: EXE,
        InternalName: pkg.build.executableName,
        LegalCopyright: `© ${new Date().getFullYear()} Singularize`,
      });
    }
    info.outputToResourceEntries(recursos.entries);
  }
  recursos.outputResource(executavel);
  fs.writeFileSync(exe, Buffer.from(executavel.generate()));
};

const makensis = () => {
  const base = path.join(os.homedir(), '.cache', 'electron-builder', 'nsis');
  const pasta = fs.existsSync(base) ? fs.readdirSync(base).find((n) => n.startsWith('nsis-') && !n.includes('resources')) : null;
  if (!pasta) throw new Error('makensis não encontrado. Rode uma vez: npx electron-builder --win nsis (ele baixa o NSIS).');
  const dir = path.join(base, pasta);
  const bin = process.platform === 'win32' ? path.join(dir, 'Bin', 'makensis.exe') : path.join(dir, process.platform === 'darwin' ? 'mac' : 'linux', 'makensis');
  return { bin, dir };
};

const scriptNsis = (origem, saida) => `Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"

Name "${NOME}"
OutFile "${saida}"
InstallDir "$LOCALAPPDATA\\Programs\\${NOME}"
InstallDirRegKey HKCU "Software\\SingularizeOrquestrador" "Pasta"
RequestExecutionLevel user
BrandingText "${NOME} ${versao}"
VIProductVersion "${versao}.0"
VIAddVersionKey "ProductName" "${NOME}"
VIAddVersionKey "FileDescription" "Instalador do ${NOME}"
VIAddVersionKey "FileVersion" "${versao}"
VIAddVersionKey "CompanyName" "Singularize"
VIAddVersionKey "LegalCopyright" "Singularize"

!define MUI_ICON "${path.join(raiz, 'instalador', 'icone.ico')}"
!define MUI_UNICON "${path.join(raiz, 'instalador', 'icone.ico')}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalar o ${NOME}"
!define MUI_WELCOMEPAGE_TEXT "Orquestrador geral de IAs de terminal.$\\r$\\n$\\r$\\nNenhuma IA é instalada agora: na primeira abertura você escolhe quais quer usar, e o app só instala as que você confirmar."
!define MUI_FINISHPAGE_RUN "$INSTDIR\\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o ${NOME} agora"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "Instalar"
  ; Fecha o app (e o servidor dele) e espera o Windows soltar o .exe antes de copiar: até 15 s.
  StrCpy $0 0
  espera_fechar:
    nsExec::Exec 'taskkill /F /T /IM "${EXE}"'
    ClearErrors
    IfFileExists "$INSTDIR\\${EXE}" 0 app_fechado
    Delete "$INSTDIR\\${EXE}"
    IfErrors 0 app_fechado
    IntOp $0 $0 + 1
    IntCmp $0 30 app_fechado
    Sleep 500
    Goto espera_fechar
  app_fechado:
  RMDir /r "$INSTDIR\\resources"
  SetOutPath "$INSTDIR"
  File /r "${origem}/*"
  WriteUninstaller "$INSTDIR\\Desinstalar.exe"
  CreateShortCut "$DESKTOP\\${NOME}.lnk" "$INSTDIR\\${EXE}" "" "$INSTDIR\\${EXE}" 0
  CreateShortCut "$SMPROGRAMS\\${NOME}.lnk" "$INSTDIR\\${EXE}" "" "$INSTDIR\\${EXE}" 0
  WriteRegStr HKCU "Software\\SingularizeOrquestrador" "Pasta" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SingularizeOrquestrador" "DisplayName" "${NOME}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SingularizeOrquestrador" "DisplayVersion" "${versao}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SingularizeOrquestrador" "Publisher" "Singularize"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SingularizeOrquestrador" "DisplayIcon" "$INSTDIR\\${EXE}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SingularizeOrquestrador" "UninstallString" '"$INSTDIR\\Desinstalar.exe"'
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SingularizeOrquestrador" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SingularizeOrquestrador" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Sleep 800
  Delete "$DESKTOP\\${NOME}.lnk"
  Delete "$SMPROGRAMS\\${NOME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SingularizeOrquestrador"
  DeleteRegKey HKCU "Software\\SingularizeOrquestrador"
  ; Seus dados (projetos, cérebro em Documentos\\Singularize) ficam guardados.
SectionEnd
`;

if (alvo === 'win') {
  const pty = garantirPtyWindows();
  console.log(`terminal do Windows: ${pty}`);
  fs.rmSync(path.join(raiz, 'dist', 'win-unpacked'), { recursive: true, force: true });
  rodar(builder, ['--win', 'dir', '--x64', '--publish', 'never']);
  const pasta = path.join(raiz, 'dist', 'win-unpacked');
  const ptyNoPacote = path.join(pasta, 'resources', 'app', 'node_modules', '@lydell', 'node-pty-win32-x64');
  if (!fs.existsSync(ptyNoPacote)) fs.cpSync(pty, ptyNoPacote, { recursive: true });
  fs.rmSync(path.join(pasta, 'resources', 'app', 'node_modules', '@lydell', 'node-pty-linux-x64'), { recursive: true, force: true });
  // Símbolos de depuração do terminal do Windows não servem para o usuário: ~10 MB a menos.
  for (const pdb of ['conpty.pdb', 'conpty_console_list.pdb']) fs.rmSync(path.join(ptyNoPacote, 'prebuilds', 'win32-x64', pdb), { force: true });
  await gravarIconeEVersao(path.join(pasta, EXE));
  const saida = path.join(raiz, 'dist', `Singularize-Orquestrador-Setup-${versao}.exe`);
  const nsi = path.join(raiz, 'dist', 'instalador.nsi');
  fs.writeFileSync(nsi, scriptNsis(pasta, saida));
  const { bin, dir } = makensis();
  rodar(bin, ['-V2', nsi], { env: { ...process.env, NSISDIR: dir } });
  console.log(`\nPronto: ${saida} (${(fs.statSync(saida).size / 1e6).toFixed(0)} MB)`);
} else if (alvo === 'linux') {
  rodar(builder, ['--linux', 'AppImage', '--x64', '--publish', 'never']);
  console.log('\nPronto: dist/*.AppImage');
} else {
  console.log('uso: node desktop/empacotar.mjs win|linux');
  process.exit(1);
}
