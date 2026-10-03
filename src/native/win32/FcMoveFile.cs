// file-converter-core — minimal Win32 no-clobber primitive.
// Compiled with the in-box .NET Framework csc.exe; no SDK, no native framework.
// Exposes exactly ONE operation: MoveFileExW(src, dst, 0) — note dwFlags=0,
// i.e. MOVEFILE_REPLACE_EXISTING is deliberately NOT set, so an existing
// destination makes the call fail with ERROR_FILE_EXISTS (80).
using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class FcMoveFile
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool MoveFileExW(string lpExistingFileName, string lpNewFileName, int dwFlags);

    private static int Main(string[] args)
    {
        if (args.Length != 2)
        {
            Console.Error.WriteLine("usage: fc-movefile <src> <dst>");
            return 2;
        }
        // flags = 0: atomic same-volume move, fail if destination exists.
        // MoveFileEx reports an existing target as ERROR_ALREADY_EXISTS (183);
        // ERROR_FILE_EXISTS (80) is kept for completeness across Windows builds.
        if (MoveFileExW(LongPath(args[0]), LongPath(args[1]), 0)) return 0;
        int err = Marshal.GetLastWin32Error();
        bool exists = err == 183 || err == 80;
        Console.Error.WriteLine(exists ? "FILE_EXISTS" : "WIN32_" + err);
        return exists ? 3 : 4;
    }

    private static string LongPath(string p)
    {
        if (p.StartsWith(@"\\?\", StringComparison.Ordinal)) return p;
        string full = Path.GetFullPath(p);
        if (full.StartsWith(@"\\", StringComparison.Ordinal)) return @"\\?\UNC\" + full.Substring(2);
        return @"\\?\" + full;
    }
}
