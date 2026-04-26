# Notify-Terminal.ps1
# Show a Windows toast notification and flash the invoking terminal's
# taskbar entry until the user focuses it.
#
# Requires: BurntToast (Install-Module BurntToast -Scope CurrentUser)

[CmdletBinding()]
param(
    [string]$Title = "Claude Code",
    [string]$Message = "Task finished",
    [uint32]$FlashCount = 10
)

function Get-TerminalHwnd {
    $p = $PID
    while ($p) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
        if (-not $proc) { return [IntPtr]::Zero }
        $ps = Get-Process -Id $p -ErrorAction SilentlyContinue
        if ($ps -and $ps.MainWindowHandle -ne 0) { return [IntPtr]$ps.MainWindowHandle }
        $p = $proc.ParentProcessId
    }
    return [IntPtr]::Zero
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct FLASHWINFO {
    public uint cbSize;
    public IntPtr hwnd;
    public uint dwFlags;
    public uint uCount;
    public uint dwTimeout;
}
public static class Flasher {
    // FLASHW_ALL | FLASHW_TIMERNOFG = flash caption + taskbar until window is foreground
    private const uint FLAGS = 0x0000000C;
    [DllImport("user32.dll")] private static extern bool FlashWindowEx(ref FLASHWINFO pfwi);
    public static void Flash(IntPtr h, uint count) {
        var fw = new FLASHWINFO {
            cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO)),
            hwnd = h, dwFlags = FLAGS, uCount = count, dwTimeout = 0
        };
        FlashWindowEx(ref fw);
    }
}
'@

$hwnd = Get-TerminalHwnd
if ($hwnd -ne [IntPtr]::Zero) {
    [Flasher]::Flash($hwnd, $FlashCount)
}

Import-Module BurntToast -ErrorAction Stop
New-BurntToastNotification -Text $Title, $Message
