// EmirSandbox.cs - runs one program of the coding agent isolated. Three ways (--mode):
//
// appcontainer (this file): a Windows AppContainer. The program can read and write only what the
//   container is granted: the project folder (read and write) and the folders of the program it
//   runs (read). It cannot reach the user's other files, and without the internetClient capability
//   it has no network (loopback included). Programs that start other programs through named pipes
//   (Node, Rust) cannot run in it.
// user (Accounts.cs, Restricted.cs): a local account of its own with a restricted token, for whole
//   process trees. Needs the one-time setup (--setup).
// low (Restricted.cs): the low integrity level: nothing outside the project can be changed.
//
// In every mode a job object stops the program and everything it started when the launcher ends
// (the app kills the launcher on timeout) and caps the number of processes and their memory.
//
// Usage: emir-sandbox.exe [--mode <mode>] --root <project folder> [--read <folder>]... [--net] -- <program> [args...]
//        emir-sandbox.exe [--mode <mode>] --check --root <project folder> [--read <folder>]...
//        emir-sandbox.exe --mode <low|user> --prepare --root <project folder> [--read <folder>]...
//        emir-sandbox.exe --audit --root <project folder>
//        emir-sandbox.exe --setup | --remove | --account-status
// Exit code: the program's own exit code; 125 when the isolated environment could not be set up
// (the reason is printed to stderr after "emir-sandbox:").
//
// Built with the C# compiler of the .NET Framework that every Windows 10/11 has (C# 5), see
// scripts/build-sandbox.cjs.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

internal static partial class EmirSandbox
{
    private const string ProfileName = "EmirCode.Sandbox";
    private const string ProfileDisplayName = "Emir Code isolated commands";
    private const int SetupFailed = 125;

    private static int Main(string[] argv)
    {
        try
        {
            return Run(argv);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("emir-sandbox: " + e.Message);
            return SetupFailed;
        }
    }

    private static int Run(string[] argv)
    {
        string root = null;
        string mode = "appcontainer";
        string action = null;
        string file = null;
        string group = null;
        bool net = false;
        bool check = false;
        bool prepare = false;
        bool netProbe = false;
        bool audit = false;
        var reads = new List<string>();
        int i = 0;
        for (; i < argv.Length; i++)
        {
            string a = argv[i];
            if (a == "--") { i++; break; }
            if (a == "--root" && i + 1 < argv.Length) root = argv[++i];
            else if (a == "--read" && i + 1 < argv.Length) reads.Add(argv[++i]);
            else if (a == "--mode" && i + 1 < argv.Length) mode = argv[++i];
            else if (a == "--group" && i + 1 < argv.Length) group = argv[++i];
            else if (a == "--net") net = true;
            else if (a == "--check") check = true;
            else if (a == "--prepare") prepare = true;
            else if (a == "--net-probe") netProbe = true;
            else if (a == "--audit") audit = true;
            else if (a == "--stage2" || a == "--setup" || a == "--remove" || a == "--account-status") action = a.Substring(2);
            else if ((a == "--setup-elevated" || a == "--remove-elevated") && i + 1 < argv.Length) { action = a.Substring(2); file = argv[++i]; }
            else throw new ArgumentException("unknown option " + a);
        }
        if (action == "setup") return SetupAccounts();
        if (action == "remove") return RemoveAccounts();
        if (action == "setup-elevated") return SetupElevated(file);
        if (action == "remove-elevated") return RemoveElevated(file);
        if (action == "account-status") return AccountStatus();

        if (root == null || !Directory.Exists(root)) throw new ArgumentException("the project folder does not exist");
        if (audit)
        {
            // Other folders next to the project are reachable by every account of this computer,
            // so also by the account of isolated programs. The app warns the user.
            string parent = Path.GetDirectoryName(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar));
            if (parent != null && OpenToAllUsers(parent)) Console.WriteLine("parent-open");
            return 0;
        }
        bool noProgram = check || prepare || netProbe;
        if (!noProgram && i >= argv.Length) throw new ArgumentException("no program given");
        if (action == "stage2" || mode != "appcontainer")
        {
            string program = noProgram ? null : argv[i];
            var programArgs = new string[noProgram ? 0 : argv.Length - i - 1];
            if (!noProgram) Array.Copy(argv, i + 1, programArgs, 0, programArgs.Length);
            if (action == "stage2") return RunStage2(root, group, program, programArgs, check, netProbe);
            if (mode == "low") return RunLow(root, program, programArgs, prepare, check);
            if (mode == "user") return RunAsSandboxAccount(root, reads, net, program, programArgs, prepare, check, netProbe);
            throw new ArgumentException("unknown mode " + mode);
        }
        if (prepare) throw new ArgumentException("--prepare needs --mode low or --mode user");

        IntPtr sid = ContainerSid();
        try
        {
            // Folders are opened to a capability of the container, not to the container itself: a
            // rule for an AppContainer's own identity makes Windows refuse low-integrity programs
            // (the write-protected mode) every access to the folder.
            SecurityIdentifier identity = ProjectCapability();
            RemoveRule(root, new SecurityIdentifier(sid));
            Grant(root, identity, FileSystemRights.Modify | FileSystemRights.Synchronize);
            foreach (string dir in reads)
            {
                if (!Directory.Exists(dir)) continue;
                // Folders under Program Files and Windows are readable by every AppContainer already and
                // belong to the administrators; elsewhere (a per-user Python or Node) the rule is added.
                try
                {
                    Grant(dir, identity, FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize);
                }
                catch (UnauthorizedAccessException)
                {
                }
            }
            string temp = ContainerFolder(sid);
            if (temp != null)
            {
                string t = Path.Combine(temp, "Temp");
                Directory.CreateDirectory(t);
                Environment.SetEnvironmentVariable("TEMP", t);
                Environment.SetEnvironmentVariable("TMP", t);
            }
            if (check)
            {
                // A real start proves the container works on this system.
                string cmd = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe");
                return Launch(sid, false, root, cmd, new[] { "/d", "/c", "exit 0" });
            }
            var args = new string[argv.Length - i - 1];
            Array.Copy(argv, i + 1, args, 0, args.Length);
            return Launch(sid, net, root, argv[i], args);
        }
        finally
        {
            FreeSid(sid);
        }
    }

    // ---------------------------------------------------------------- container and access

    private static IntPtr ContainerSid()
    {
        IntPtr sid;
        int hr = CreateAppContainerProfile(ProfileName, ProfileDisplayName, ProfileDisplayName, IntPtr.Zero, 0, out sid);
        if (hr == unchecked((int)0x800700B7)) // HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)
        {
            hr = DeriveAppContainerSidFromAppContainerName(ProfileName, out sid);
        }
        if (hr != 0) throw new Win32Exception(hr, "the AppContainer profile could not be created (0x" + hr.ToString("X8") + ")");
        return sid;
    }

    private static string ContainerFolder(IntPtr sid)
    {
        IntPtr text;
        if (!ConvertSidToStringSid(sid, out text)) return null;
        string sidString = Marshal.PtrToStringUni(text);
        LocalFree(text);
        IntPtr folder;
        if (GetAppContainerFolderPath(sidString, out folder) != 0) return null;
        string result = Marshal.PtrToStringUni(folder);
        Marshal.FreeCoTaskMem(folder);
        return result;
    }

    /// The capability that project folders are opened to ("emirCodeProject", derived the way Windows
    /// derives the identities of named capabilities: the SHA-256 of the upper-case name).
    private static SecurityIdentifier ProjectCapability()
    {
        byte[] hash;
        using (var sha = System.Security.Cryptography.SHA256.Create()) hash = sha.ComputeHash(Encoding.Unicode.GetBytes("EMIRCODEPROJECT"));
        var text = new StringBuilder("S-1-15-3-1024");
        for (int k = 0; k < 8; k++) text.Append('-').Append(BitConverter.ToUInt32(hash, k * 4));
        return new SecurityIdentifier(text.ToString());
    }

    /// Takes the rules of an identity off a folder and its content again (when the folder has any).
    private static void RemoveRule(string dir, SecurityIdentifier sid)
    {
        var info = new DirectoryInfo(dir);
        DirectorySecurity security = info.GetAccessControl(AccessControlSections.Access);
        bool found = false;
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, false, typeof(SecurityIdentifier)))
        {
            if (rule.IdentityReference.Equals(sid)) found = true;
        }
        if (!found) return;
        security.PurgeAccessRules(sid);
        info.SetAccessControl(security);
    }

    /// Gives an identity access to a folder and everything in it, once (the rule is kept).
    private static void Grant(string dir, SecurityIdentifier sid, FileSystemRights rights)
    {
        var info = new DirectoryInfo(dir);
        DirectorySecurity security = info.GetAccessControl(AccessControlSections.Access);
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (rule.AccessControlType == AccessControlType.Allow && rule.IdentityReference.Equals(sid) && (rule.FileSystemRights & rights) == rights)
            {
                return;
            }
        }
        security.AddAccessRule(new FileSystemAccessRule(sid, rights, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        info.SetAccessControl(security);
    }

    // ---------------------------------------------------------------- the program

    private static int Launch(IntPtr containerSid, bool net, string cwd, string program, string[] args)
    {
        IntPtr capabilitySid = IntPtr.Zero;
        IntPtr projectSid = IntPtr.Zero;
        IntPtr capabilities = IntPtr.Zero;
        IntPtr securityCapabilities = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr handleList = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        var pi = new PROCESS_INFORMATION();
        try
        {
            var sc = new SECURITY_CAPABILITIES { AppContainerSid = containerSid };
            int entry = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
            capabilities = Marshal.AllocHGlobal(entry * 2);
            if (!ConvertStringSidToSid(ProjectCapability().Value, out projectSid)) throw new Win32Exception();
            Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = projectSid, Attributes = SE_GROUP_ENABLED }, capabilities, false);
            sc.Capabilities = capabilities;
            sc.CapabilityCount = 1;
            if (net)
            {
                if (!ConvertStringSidToSid("S-1-15-3-1", out capabilitySid)) throw new Win32Exception(); // internetClient
                Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = capabilitySid, Attributes = SE_GROUP_ENABLED }, IntPtr.Add(capabilities, entry), false);
                sc.CapabilityCount = 2;
            }
            securityCapabilities = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
            Marshal.StructureToPtr(sc, securityCapabilities, false);

            // Only the three standard handles are inherited (the app's pipes).
            var handles = new List<IntPtr>();
            foreach (int which in new[] { STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE })
            {
                IntPtr h = GetStdHandle(which);
                if (h == IntPtr.Zero || h == new IntPtr(-1) || handles.Contains(h)) continue;
                if (SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) handles.Add(h);
            }
            handleList = Marshal.AllocHGlobal(IntPtr.Size * Math.Max(1, handles.Count));
            for (int k = 0; k < handles.Count; k++) Marshal.WriteIntPtr(handleList, k * IntPtr.Size, handles[k]);

            IntPtr size = IntPtr.Zero;
            int attributes = handles.Count > 0 ? 2 : 1;
            InitializeProcThreadAttributeList(IntPtr.Zero, attributes, 0, ref size);
            attributeList = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attributeList, attributes, 0, ref size)) throw new Win32Exception();
            if (!UpdateProcThreadAttribute(attributeList, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, securityCapabilities, (IntPtr)Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)), IntPtr.Zero, IntPtr.Zero))
            {
                throw new Win32Exception();
            }
            if (handles.Count > 0 && !UpdateProcThreadAttribute(attributeList, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handleList, (IntPtr)(IntPtr.Size * handles.Count), IntPtr.Zero, IntPtr.Zero))
            {
                throw new Win32Exception();
            }

            var si = new STARTUPINFOEX();
            si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            si.lpAttributeList = attributeList;
            if (handles.Count > 0)
            {
                si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
                si.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
                si.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
                si.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
            }

            var commandLine = new StringBuilder(Quote(program));
            foreach (string a in args) commandLine.Append(' ').Append(Quote(a));

            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception();
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
            limits.BasicLimitInformation.ActiveProcessLimit = 64;
            limits.JobMemoryLimit = (UIntPtr)(4UL * 1024 * 1024 * 1024);
            int limitsSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr limitsPtr = Marshal.AllocHGlobal(limitsSize);
            try
            {
                Marshal.StructureToPtr(limits, limitsPtr, false);
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, limitsPtr, (uint)limitsSize)) throw new Win32Exception();
            }
            finally
            {
                Marshal.FreeHGlobal(limitsPtr);
            }

            if (!CreateProcess(null, commandLine, IntPtr.Zero, IntPtr.Zero, handles.Count > 0,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                IntPtr.Zero, cwd, ref si, out pi))
            {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "\"" + program + "\" could not start in the AppContainer: " + new Win32Exception(error).Message);
            }
            if (!AssignProcessToJobObject(job, pi.hProcess))
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
            if (job != IntPtr.Zero) CloseHandle(job); // kills whatever is still running in it
            if (attributeList != IntPtr.Zero) { DeleteProcThreadAttributeList(attributeList); Marshal.FreeHGlobal(attributeList); }
            if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
            if (securityCapabilities != IntPtr.Zero) Marshal.FreeHGlobal(securityCapabilities);
            if (capabilities != IntPtr.Zero) Marshal.FreeHGlobal(capabilities);
            if (capabilitySid != IntPtr.Zero) LocalFree(capabilitySid);
            if (projectSid != IntPtr.Zero) LocalFree(projectSid);
        }
    }

    /// Windows command-line quoting (CommandLineToArgvW rules).
    private static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) == -1) return arg;
        var sb = new StringBuilder("\"");
        for (int i = 0; ; i++)
        {
            int backslashes = 0;
            while (i < arg.Length && arg[i] == '\\') { i++; backslashes++; }
            if (i == arg.Length) { sb.Append('\\', backslashes * 2); break; }
            if (arg[i] == '"') { sb.Append('\\', backslashes * 2 + 1); sb.Append('"'); }
            else { sb.Append('\\', backslashes); sb.Append(arg[i]); }
        }
        sb.Append('"');
        return sb.ToString();
    }

    // ---------------------------------------------------------------- Win32

    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;
    private const uint HANDLE_FLAG_INHERIT = 1;
    private const uint SE_GROUP_ENABLED = 4;
    private const int PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
    private const int PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const int STARTF_USESTDHANDLES = 0x00000100;
    private const uint INFINITE = 0xFFFFFFFF;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    private const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    private const uint JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x00000400;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_CAPABILITIES
    {
        public IntPtr AppContainerSid;
        public IntPtr Capabilities;
        public uint CapabilityCount;
        public uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SID_AND_ATTRIBUTES
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int CreateAppContainerProfile(string name, string displayName, string description, IntPtr capabilities, uint capabilityCount, out IntPtr sid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int GetAppContainerFolderPath(string sidString, out IntPtr path);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr text);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertStringSidToSid(string text, out IntPtr sid);

    [DllImport("advapi32.dll")]
    private static extern IntPtr FreeSid(IntPtr sid);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr mem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int which);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previousValue, IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr list);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, int exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
}
