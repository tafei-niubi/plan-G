// 生成桌面快捷方式(Windows):双击即可启动 G计划
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const projectDir = path.resolve(__dirname, '..');
const electronExe = path.join(projectDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const desktop = path.join(os.homedir(), 'Desktop');
const lnkPath = path.join(desktop, 'G计划.lnk');

if (!fs.existsSync(electronExe)) {
  console.error('没找到 electron.exe,请先在项目目录运行 npm install');
  process.exit(1);
}

// 用单引号包裹路径,PS 单引号字符串内反斜杠为字面量
const q = (s) => "'" + s.replace(/'/g, "''") + "'";
const ps1 = [
  '$WshShell = New-Object -ComObject WScript.Shell',
  `$Shortcut = $WshShell.CreateShortcut(${q(lnkPath)})`,
  `$Shortcut.TargetPath = ${q(electronExe)}`,
  `$Shortcut.Arguments = '"' + ${q(projectDir)} + '"'`,
  `$Shortcut.WorkingDirectory = ${q(projectDir)}`,
  `$Shortcut.IconLocation = ${q(electronExe + ',0')}`,
  "$Shortcut.Description = 'G计划'",
  '$Shortcut.Save()',
].join('\n');

const tmp = path.join(os.tmpdir(), 'g-plan-shortcut.ps1');
// 写 UTF-8 BOM,避免 Windows PowerShell(非 pwsh)把中文按 ANSI/GBK 解析导致乱码
fs.writeFileSync(tmp, '﻿' + ps1, 'utf8');
try {
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { stdio: 'inherit' });
} finally {
  fs.unlinkSync(tmp);
}
console.log('已创建桌面快捷方式:', lnkPath);
