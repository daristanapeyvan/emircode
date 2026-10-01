// Restricted.cs - two ways to run a whole process tree (npm, cargo, test runners):
//
// Write-protected ("low"): the program runs at the low integrity level. Windows then refuses every
//   write to files, registry keys and processes of the normal level, so nothing outside the project
//   can be changed. Reading the user's files and the network stay possible.
//
// Stage 2 of full isolation: the launcher was started as the sandbox account (see Accounts.cs) and
//   starts the program with a restricted token. An access must then be allowed twice: for the
//   sandbox account, and for one of the restricting identities (the account itself, the sandbox
//   group, Users, Everyone). Folders that grant something only to "Authenticated Users" (other
//   drives, folders created under C:\) stay read-only this way.
//
// An AppContainer cannot run such trees: Node and Rust create the pipes to their child processes
// under names an AppContainer may not use.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

internal static partial class EmirSandbox
{
    private const string UsersSid = "S-1-5-32-545";
    private const string EveryoneSid = "S-1-1-0";
    private const string RestrictedSid = "S-1-5-12";
    private const string LowIntegritySid = "S-1-16-4096";

    // ---------------------------------------------------------------- write-protected

    private static int RunLow(string root, string program, string[] args, bool prepareOnly, bool check)
    {
        string home = PrepareHome(LowHome());
        // A rule for an AppContainer's own identity (written by an earlier version) would close the
        // folder to low-integrity programs.
        IntPtr container;
        if (DeriveAppContainerSidFromAppContainerName(ProfileName, out container) == 0)
        {
            try { RemoveRule(root, new SecurityIdentifier(container)); } finally { FreeSid(container); }
        }
        LabelLow(root);
        if (prepareOnly) return 0;
        UseHome(home);

        IntPtr token = LowToken();
        string user = WindowsIdentity.GetCurrent().User.Value;
        using (var desktop = new HiddenDesktop("D:(A;;GA;;;" + user + ")(A;;GA;;;SY)S:(ML;;NW;;;LW)"))
        {
            IntPtr job = CreateSandboxJob();
            try
            {
                string commandLine = check ? CommandLine(SystemCmd(), new[] { "/d", "/c", "exit 0" }) : CommandLine(program, args);
                return StartWithToken(token, root, commandLine, desktop.Name, job);
            }
            finally
            {
                CloseHandle(job); // stops whatever is still running in it
                CloseHandle(token);
            }
        }
    }

    /// The folder Windows keeps for low-integrity programs (AppData\LocalLow).
    private static string LowHome()
    {
        IntPtr path;
        var localLow = new Guid("A520A1A4-1780-4FF6-BD18-167343C5AF16");
        string baseDir = SHGetKnownFolderPath(ref localLow, 0, IntPtr.Zero, out path) == 0
            ? Marshal.PtrToStringUni(path)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "LocalLow");
        if (path != IntPtr.Zero) Marshal.FreeCoTaskMem(path);
        return Path.Combine(baseDir, "EmirCode", "sandbox");
    }

    private static IntPtr LowToken()
    {
        IntPtr processToken, token;
        if (!OpenProcessToken(GetCurrentProcess(), TokenAllAccess, out processToken)) throw new Win32Exception();
        try
        {
            if (!CreateRestrictedToken(processToken, DisableMaxPrivilege, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out token)) throw new Win32Exception();
        }
        finally
        {
            CloseHandle(processToken);
        }
        IntPtr lowSid;
        if (!ConvertStringSidToSid(LowIntegritySid, out lowSid)) throw new Win32Exception();
        try
        {
            var label = new SID_AND_ATTRIBUTES { Sid = lowSid, Attributes = SE_GROUP_INTEGRITY };
            if (!SetTokenIntegrity(token, TokenIntegrityLevel, ref label, (uint)Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES)) + 12))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "the low integrity level could not be set");
            }
        }
        finally
        {
            LocalFree(lowSid);
        }
        return token;
    }

    // ---------------------------------------------------------------- stage 2 of full isolation

    private static int RunStage2(string root, string groupSid, string program, string[] args, bool check, bool netProbe)
    {
        if (netProbe) return NetProbe();
        HardenSelf();
        string user = WindowsIdentity.GetCurrent().User.Value;
        IntPtr token = RestrictedToken(new[] { user, groupSid, UsersSid, EveryoneSid, RestrictedSid });
        try
        {
            string commandLine = check ? CommandLine(SystemCmd(), new[] { "/d", "/c", "exit 0" }) : CommandLine(program, args);
            // The job and the desktop come from stage 1: this process is already in them.
            return StartWithToken(token, root, commandLine, null, IntPtr.Zero);
        }
        finally
        {
            CloseHandle(token);
        }
    }

    private static IntPtr RestrictedToken(IList<string> restricting)
    {
        IntPtr processToken, token;
        if (!OpenProcessToken(GetCurrentProcess(), TokenAllAccess, out processToken)) throw new Win32Exception();
        int entry = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
        IntPtr sids = Marshal.AllocHGlobal(entry * restricting.Count);
        var native = new List<IntPtr>();
        try
        {
            for (int k = 0; k < restricting.Count; k++)
            {
                IntPtr sid;
                if (!ConvertStringSidToSid(restricting[k], out sid)) throw new Win32Exception();
                native.Add(sid);
                Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = sid, Attributes = 0 }, IntPtr.Add(sids, k * entry), false);
            }
            if (!CreateRestrictedToken(processToken, DisableMaxPrivilege, 0, IntPtr.Zero, 0, IntPtr.Zero, (uint)restricting.Count, sids, out token))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "the restricted token could not be created");
            }
            return token;
        }
        finally
        {
            foreach (IntPtr sid in native) LocalFree(sid);
            Marshal.FreeHGlobal(sids);
            CloseHandle(processToken);
        }
    }

    /// This process keeps the unrestricted token of the sandbox account while the program runs.
    /// The program must not be able to open it (and run code in it), so the process and its threads
    /// are closed to their owner; "owner rights" replaces the access an owner always has.
    private static void HardenSelf()
    {
        try
        {
            SetKernelObjectSecurity(GetCurrentProcess(), DaclInformation, SdBytes("D:(A;;0x1000;;;OW)(A;;GA;;;SY)"));
            byte[] threadSd = SdBytes("D:(A;;0x0800;;;OW)(A;;GA;;;SY)");
            foreach (ProcessThread thread in Process.GetCurrentProcess().Threads)
            {
                IntPtr handle = OpenThread(0x40000 /* WRITE_DAC */, false, (uint)thread.Id);
                if (handle == IntPtr.Zero) continue;
                SetKernelObjectSecurity(handle, DaclInformation, threadSd);
                CloseHandle(handle);
            }
        }
        catch (Exception)
        {
            // Hardening only: the program is restricted either way.
        }
    }

    private static byte[] SdBytes(string sddl)
    {
        var sd = new RawSecurityDescriptor(sddl);
        var bytes = new byte[sd.BinaryLength];
        sd.GetBinaryForm(bytes, 0);
        return bytes;
    }

    /// Exit code 0: the firewall refused the connection; 3: it connected; 4: no answer (no network).
    private static int NetProbe()
    {
        try
        {
            using (var client = new System.Net.Sockets.TcpClient())
            {
                IAsyncResult pending = client.BeginConnect("1.1.1.1", 443, null, null);
                if (!pending.AsyncWaitHandle.WaitOne(4000)) return 4;
                client.EndConnect(pending);
                return 3;
            }
        }
        catch (System.Net.Sockets.SocketException e)
        {
            return e.SocketErrorCode == System.Net.Sockets.SocketError.AccessDenied ? 0 : 4;
        }
    }

    // ---------------------------------------------------------------- shared

    /// The private home and temp folders of isolated programs: tools write their caches and
    /// settings there instead of into the user's profile.
    private static string PrepareHome(string home)
    {
        Directory.CreateDirectory(Path.Combine(home, "Temp"));
        Directory.CreateDirectory(Path.Combine(home, "AppData", "Roaming"));
        Directory.CreateDirectory(Path.Combine(home, "AppData", "Local"));
        return home;
    }

    private static void UseHome(string home)
    {
        string temp = Path.Combine(home, "Temp");
        Environment.SetEnvironmentVariable("TEMP", temp);
        Environment.SetEnvironmentVariable("TMP", temp);
        Environment.SetEnvironmentVariable("USERPROFILE", home);
        Environment.SetEnvironmentVariable("HOME", home);
        Environment.SetEnvironmentVariable("HOMEDRIVE", Path.GetPathRoot(home).TrimEnd('\\'));
        Environment.SetEnvironmentVariable("HOMEPATH", home.Substring(Path.GetPathRoot(home).Length - 1));
        Environment.SetEnvironmentVariable("APPDATA", Path.Combine(home, "AppData", "Roaming"));
        Environment.SetEnvironmentVariable("LOCALAPPDATA", Path.Combine(home, "AppData", "Local"));
        Environment.SetEnvironmentVariable("npm_config_cache", Path.Combine(home, "npm-cache"));
        Environment.SetEnvironmentVariable("npm_config_update_notifier", "false");
    }

    private static string SystemCmd()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe");
    }

    /// The command line of a program. Batch files (npm.cmd) run through cmd.exe; the app has
    /// refused every character cmd.exe gives a meaning to, so plain quoting is enough.
    private static string CommandLine(string program, string[] args)
    {
        if (program.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) || program.EndsWith(".bat", StringComparison.OrdinalIgnoreCase))
        {
            var inner = new StringBuilder("\"" + program + "\"");
            foreach (string a in args) inner.Append(' ').Append(a.Length == 0 || a.IndexOfAny(new[] { ' ', '\t' }) >= 0 ? "\"" + a + "\"" : a);
            return Quote(SystemCmd()) + " /d /s /c \"" + inner + "\"";
        }
        var commandLine = new StringBuilder(Quote(program));
        foreach (string a in args) commandLine.Append(' ').Append(Quote(a));
        return commandLine.ToString();
    }

    /// A job object: stops the whole tree with the launcher, limits its size, and cuts it off from
    /// the windows, the clipboard and the settings of the desktop.
    private static IntPtr CreateSandboxJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        limits.BasicLimitInformation.ActiveProcessLimit = 128;
        limits.JobMemoryLimit = (UIntPtr)(8UL * 1024 * 1024 * 1024);
        int limitsSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr limitsPtr = Marshal.AllocHGlobal(limitsSize);
        IntPtr ui = Marshal.AllocHGlobal(4);
        try
        {
            Marshal.StructureToPtr(limits, limitsPtr, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, limitsPtr, (uint)limitsSize)) throw new Win32Exception();
            Marshal.WriteInt32(ui, 0xFF); // every JOB_OBJECT_UILIMIT_*
            if (!SetInformationJobObject(job, JobObjectBasicUIRestrictions, ui, 4)) throw new Win32Exception();
        }
        finally
        {
            Marshal.FreeHGlobal(limitsPtr);
            Marshal.FreeHGlobal(ui);
        }
        return job;
    }

    /// The three standard handles, made inheritable (the app's pipes).
    private static List<IntPtr> StandardHandles()
    {
        var handles = new List<IntPtr>();
        foreach (int which in new[] { STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE })
        {
            IntPtr h = GetStdHandle(which);
            if (h == IntPtr.Zero || h == new IntPtr(-1) || handles.Contains(h)) continue;
            if (SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) handles.Add(h);
        }
        return handles;
    }

    private static int StartWithToken(IntPtr token, string cwd, string commandLine, string desktop, IntPtr job)
    {
        IntPtr attributeList = IntPtr.Zero;
        IntPtr handleList = IntPtr.Zero;
        var pi = new PROCESS_INFORMATION();
        try
        {
            List<IntPtr> handles = StandardHandles();
            handleList = Marshal.AllocHGlobal(IntPtr.Size * Math.Max(1, handles.Count));
            for (int k = 0; k < handles.Count; k++) Marshal.WriteIntPtr(handleList, k * IntPtr.Size, handles[k]);
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attributeList = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref size)) throw new Win32Exception();
            if (handles.Count > 0 && !UpdateProcThreadAttribute(attributeList, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handleList, (IntPtr)(IntPtr.Size * handles.Count), IntPtr.Zero, IntPtr.Zero))
            {
                throw new Win32Exception();
            }

            var si = new STARTUPINFOEX();
            si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            si.StartupInfo.lpDesktop = desktop;
            si.lpAttributeList = attributeList;
            if (handles.Count > 0)
            {
                si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
                si.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
                si.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
                si.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
            }

            if (!CreateProcessAsUser(token, null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, handles.Count > 0,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, cwd, ref si, out pi))
            {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "the program could not start: " + new Win32Exception(error).Message);
            }
            if (job != IntPtr.Zero && !AssignProcessToJobObject(job, pi.hProcess))
            {
                int error = Marshal.GetLastWin32Error();
                TerminateProcess(pi.hProcess, SetupFailed);
                throw new Win32Exception(error);
            }
            ResumeThread(pi.hThread);
            WaitForSingleObject(pi.hProcess, INFINITE);
            uint code;
            GetExitCodeProcess(pi.hProcess, out code);
            return unchecked((int)code);
        }
        finally
        {
            if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
            if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
            if (attributeList != IntPtr.Zero) { DeleteProcThreadAttributeList(attributeList); Marshal.FreeHGlobal(attributeList); }
            if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
        }
    }

    /// A desktop of its own: the program cannot see or send input to the user's windows, and has
    /// no screen to read. For a program of the same account the desktop is in a window station of
    /// its own too, which also separates the clipboard.
    private sealed class HiddenDesktop : IDisposable
    {
        private IntPtr station;
        private IntPtr desktop;
        public readonly string Name;

        /// With a `guest`, the desktop is created in the window station of the user instead, and
        /// the guest (another account) is let into that station with `stationRights`. The rule
        /// stays on the station until the user signs out.
        public HiddenDesktop(string sddl, SecurityIdentifier guest = null, int stationRights = 0)
        {
            IntPtr sd;
            uint sdSize;
            if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out sd, out sdSize)) throw new Win32Exception();
            try
            {
                var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), lpSecurityDescriptor = sd, bInheritHandle = false };
                if (guest != null)
                {
                    IntPtr current = GetProcessWindowStation();
                    GrantStation(current, guest, stationRights);
                    string desktopName = "EmirCode-" + Process.GetCurrentProcess().Id;
                    desktop = CreateDesktop(desktopName, null, IntPtr.Zero, 0, GenericAll, ref sa);
                    if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "the desktop could not be created");
                    var stationName = new StringBuilder(256);
                    uint length;
                    if (!GetUserObjectInformation(current, 2 /* UOI_NAME */, stationName, (uint)stationName.Capacity * 2, out length)) throw new Win32Exception();
                    Name = stationName + "\\" + desktopName;
                    return;
                }
                station = CreateWindowStation(null, 0, GenericAll, ref sa);
                if (station == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "the window station could not be created");
                IntPtr previous = GetProcessWindowStation();
                if (!SetProcessWindowStation(station)) throw new Win32Exception();
                desktop = CreateDesktop("EmirCode", null, IntPtr.Zero, 0, GenericAll, ref sa);
                int error = Marshal.GetLastWin32Error();
                SetProcessWindowStation(previous);
                if (desktop == IntPtr.Zero) throw new Win32Exception(error, "the desktop could not be created");
                var name = new StringBuilder(256);
                uint needed;
                if (!GetUserObjectInformation(station, 2 /* UOI_NAME */, name, (uint)name.Capacity * 2, out needed)) throw new Win32Exception();
                Name = name + "\\EmirCode";
            }
            finally
            {
                LocalFree(sd);
            }
        }

        private static void GrantStation(IntPtr station, SecurityIdentifier sid, int rights)
        {
            uint info = DaclInformation;
            uint needed;
            GetUserObjectSecurity(station, ref info, null, 0, out needed);
            var buffer = new byte[needed];
            if (!GetUserObjectSecurity(station, ref info, buffer, needed, out needed)) throw new Win32Exception(Marshal.GetLastWin32Error(), "the window station's access list could not be read");
            var descriptor = new RawSecurityDescriptor(buffer, 0);
            RawAcl acl = descriptor.DiscretionaryAcl;
            for (int k = 0; k < acl.Count; k++)
            {
                var ace = acl[k] as CommonAce;
                if (ace == null || ace.AceQualifier != AceQualifier.AccessAllowed || !ace.SecurityIdentifier.Equals(sid)) continue;
                if (ace.AccessMask == rights) return;
                acl.RemoveAce(k--);
            }
            acl.InsertAce(acl.Count, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, rights, sid, false, null));
            var bytes = new byte[descriptor.BinaryLength];
            descriptor.GetBinaryForm(bytes, 0);
            if (!SetUserObjectSecurity(station, ref info, bytes)) throw new Win32Exception(Marshal.GetLastWin32Error(), "the window station could not be opened to the isolated account");
        }

        public void Dispose()
        {
            if (desktop != IntPtr.Zero) { CloseDesktop(desktop); desktop = IntPtr.Zero; }
            if (station != IntPtr.Zero) { CloseWindowStation(station); station = IntPtr.Zero; }
        }
    }

    private const uint TokenAllAccess = 0xF01FF;
    private const uint DisableMaxPrivilege = 0x1;
    private const int TokenIntegrityLevel = 25;
    private const uint SE_GROUP_INTEGRITY = 0x20;
    private const uint GenericAll = 0x10000000;
    private const int JobObjectBasicUIRestrictions = 4;

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenThread(uint access, bool inherit, uint threadId);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CreateRestrictedToken(IntPtr token, uint flags, uint disableCount, IntPtr disable, uint privilegeCount, IntPtr privileges, uint restrictedCount, IntPtr restricted, out IntPtr newToken);

    [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "SetTokenInformation")]
    private static extern bool SetTokenIntegrity(IntPtr token, int infoClass, ref SID_AND_ATTRIBUTES info, uint length);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetKernelObjectSecurity(IntPtr handle, uint info, byte[] sd);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUser(IntPtr token, string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateWindowStationW")]
    private static extern IntPtr CreateWindowStation(string name, uint flags, uint access, ref SECURITY_ATTRIBUTES sa);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateDesktopW")]
    private static extern IntPtr CreateDesktop(string name, string device, IntPtr devmode, uint flags, uint access, ref SECURITY_ATTRIBUTES sa);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetProcessWindowStation();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetProcessWindowStation(IntPtr station);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseWindowStation(IntPtr station);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "GetUserObjectInformationW")]
    private static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder info, uint length, out uint needed);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetUserObjectSecurity(IntPtr handle, ref uint info, byte[] sd, uint length, out uint needed);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetUserObjectSecurity(IntPtr handle, ref uint info, byte[] sd);

    [DllImport("shell32.dll")]
    private static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);
}
