// Failure notifications: a Windows toast (no extra install: PowerShell + WinRT) for warnings/errors, rate-limited so
// a repeating failure does not spam. The dashboard banner reads the same events from the database.
import { spawn } from 'node:child_process';
import { CONFIG, redact } from '../dashboard/lib/config.js';

const recent = new Map();             // message → last shown (ms)
const QUIET_MS = 30 * 60000;          // the same message at most once per 30 min

export function notify(level, message) {
  if (level === 'info' || process.platform !== 'win32' || !CONFIG.NOTIFY_TOAST) return false;
  message = redact(message);
  const key = `${level}:${String(message).slice(0, 120)}`, now = Date.now();
  if (now - (recent.get(key) || 0) < QUIET_MS) return false;
  recent.set(key, now);
  const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const xml = `<toast><visual><binding template="ToastGeneric"><text>CineForge automation — ${level === 'error' ? 'needs attention' : 'warning'}</text><text>${esc(String(message).slice(0, 220))}</text></binding></visual></toast>`;
  const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null;
$x = New-Object Windows.Data.Xml.Dom.XmlDocument; $x.LoadXml('${xml.replace(/'/g, "''")}');
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))`;
  try { spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true, detached: true }).unref(); return true; } catch { return false; }
}
