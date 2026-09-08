$ErrorActionPreference = 'Stop'

Add-Type -Language CSharp @'
using System;
using System.Runtime.InteropServices;

public static class MrdInput {
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;

    [DllImport("user32.dll")]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError=true)]
    static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    public static void Move(int x, int y) {
        SetCursorPos(x, y);
    }

    public static void MoveRelative(int dx, int dy) {
        INPUT input = new INPUT {
            type = INPUT_MOUSE,
            U = new InputUnion { mi = new MOUSEINPUT { dx = dx, dy = dy, dwFlags = MOUSEEVENTF_MOVE } }
        };
        SendInput(1, new [] { input }, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Button(string button, bool down) {
        uint flag;
        switch ((button ?? "left").ToLowerInvariant()) {
            case "right": flag = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP; break;
            case "middle": flag = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP; break;
            default: flag = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP; break;
        }
        INPUT input = new INPUT { type = INPUT_MOUSE, U = new InputUnion { mi = new MOUSEINPUT { dwFlags = flag } } };
        SendInput(1, new [] { input }, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Wheel(int delta) {
        INPUT input = new INPUT {
            type = INPUT_MOUSE,
            U = new InputUnion { mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_WHEEL, mouseData = unchecked((uint)delta) } }
        };
        SendInput(1, new [] { input }, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Text(string text) {
        if (String.IsNullOrEmpty(text)) return;
        foreach (char c in text) {
            INPUT down = new INPUT {
                type = INPUT_KEYBOARD,
                U = new InputUnion { ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = KEYEVENTF_UNICODE } }
            };
            INPUT up = new INPUT {
                type = INPUT_KEYBOARD,
                U = new InputUnion { ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } }
            };
            SendInput(2, new [] { down, up }, Marshal.SizeOf(typeof(INPUT)));
        }
    }

    public static void Key(ushort vk) {
        INPUT down = new INPUT {
            type = INPUT_KEYBOARD,
            U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = 0 } }
        };
        INPUT up = new INPUT {
            type = INPUT_KEYBOARD,
            U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = KEYEVENTF_KEYUP } }
        };
        SendInput(2, new [] { down, up }, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void MoveForeground(int x, int y, int width, int height) {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return;
        const uint SWP_SHOWWINDOW = 0x0040;
        SetWindowPos(hwnd, IntPtr.Zero, x + 12, y + 12, Math.Max(320, width - 24), Math.Max(240, height - 24), SWP_SHOWWINDOW);
    }
}
'@

$keyMap = @{
    'Backspace' = 0x08
    'Tab' = 0x09
    'Enter' = 0x0D
    'Escape' = 0x1B
    'ArrowLeft' = 0x25
    'ArrowUp' = 0x26
    'ArrowRight' = 0x27
    'ArrowDown' = 0x28
    'Delete' = 0x2E
    'Home' = 0x24
    'End' = 0x23
    'PageUp' = 0x21
    'PageDown' = 0x22
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
        $msg = $line | ConvertFrom-Json
        switch ($msg.type) {
            'move' {
                [MrdInput]::Move([int]$msg.x, [int]$msg.y)
            }
            'down' {
                [MrdInput]::Move([int]$msg.x, [int]$msg.y)
                [MrdInput]::Button([string]$msg.button, $true)
            }
            'up' {
                [MrdInput]::Move([int]$msg.x, [int]$msg.y)
                [MrdInput]::Button([string]$msg.button, $false)
            }
            'wheel' {
                [MrdInput]::Move([int]$msg.x, [int]$msg.y)
                [MrdInput]::Wheel([int]$msg.delta)
            }
            'relative-move' {
                [MrdInput]::MoveRelative([int]$msg.dx, [int]$msg.dy)
            }
            'relative-wheel' {
                [MrdInput]::Wheel([int]$msg.delta)
            }
            'button' {
                [MrdInput]::Button([string]$msg.button, [bool]$msg.down)
            }
            'text' {
                [MrdInput]::Text([string]$msg.text)
            }
            'key' {
                $name = [string]$msg.key
                if ($keyMap.ContainsKey($name)) {
                    [MrdInput]::Key([uint16]$keyMap[$name])
                }
            }
            'move-foreground' {
                Start-Sleep -Milliseconds 250
                [MrdInput]::MoveForeground([int]$msg.x, [int]$msg.y, [int]$msg.width, [int]$msg.height)
            }
        }
    }
    catch {
        [Console]::Error.WriteLine($_.Exception.Message)
    }
}
