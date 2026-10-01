// Accounts.cs - full isolation: programs run as a local account of their own.
//
// Setting it up needs an administrator once (a Windows prompt). It creates
//   - two hidden local accounts: one whose outgoing connections are blocked (Filters.cs, and a
//     rule of the Windows firewall), and one without that block, used when the user allows the
//     internet for isolated commands;
//   - a local group holding both, which project folders are opened to.
// The accounts' passwords are random; this user's copy is encrypted with DPAPI.
//
// A command then runs in two stages: this launcher logs the account on and starts itself as that
// account (stage 1, below), and that copy starts the program with a restricted token (stage 2,
// Restricted.cs). The account cannot open the user's profile at all, and its network is cut,
// except connections to this computer itself (localhost).
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32;

internal static partial class EmirSandbox
{
    private const string OfflineAccount = "EmirCodeSandbox";
    private const string OnlineAccount = "EmirCodeSandboxNet";
    private const string SandboxGroup = "EmirCodeSandboxUsers";
    private const string FirewallRuleName = "Emir Code isolated commands (no network)";
    private const string HiddenAccountsKey = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList";

    private sealed class Credentials
    {
        public string OfflinePassword;
        public string OnlinePassword;
        public string GroupSid;
    }

    private static string SandboxDataDir()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EmirCode", "sandbox");
    }

    private static string CredentialsFile()
    {
        return Path.Combine(SandboxDataDir(), "accounts.dat");
    }

    private static string SelfPath()
    {
        return Assembly.GetExecutingAssembly().Location;
    }

    private static Credentials LoadCredentials()
    {
        string file = CredentialsFile();
        if (!File.Exists(file)) return null;
        try
        {
            string[] lines = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(file), null, DataProtectionScope.CurrentUser)).Split('\n');
            if (lines.Length < 3) return null;
            return new Credentials { OfflinePassword = lines[0], OnlinePassword = lines[1], GroupSid = lines[2] };
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static string AccountSid(string name)
    {
        try
        {
            return ((SecurityIdentifier)new NTAccount(Environment.MachineName, name).Translate(typeof(SecurityIdentifier))).Value;
        }
        catch (Exception)
        {
            return null;
        }
    }

    // ---------------------------------------------------------------- status

    /// Prints "configured" when the accounts exist and this user holds their passwords.
    private static int AccountStatus()
    {
        Credentials credentials = LoadCredentials();
        bool configured = credentials != null && AccountSid(OfflineAccount) != null && AccountSid(OnlineAccount) != null && AccountSid(SandboxGroup) == credentials.GroupSid;
        Console.WriteLine(configured ? "configured" : "not-configured");
        return 0;
    }

    // ---------------------------------------------------------------- setup (asks for an administrator)

    private static int SetupAccounts()
    {
        string dir = SandboxDataDir();
        Directory.CreateDirectory(dir);
        string request = Path.Combine(dir, "setup-request.txt");
        string result = Path.Combine(dir, "setup-result.txt");
        string offline = NewPassword();
        string online = NewPassword();
        try
        {
            File.Delete(result);
            File.WriteAllText(request, offline + "\n" + online + "\n" + result + "\n");
            if (IsAdministrator()) SetupElevated(request);
            else RunElevated("--setup-elevated " + Quote(request));
            string[] lines = File.Exists(result) ? File.ReadAllLines(result) : new string[0];
            if (lines.Length < 2 || lines[0] != "ok")
            {
                throw new InvalidOperationException(lines.Length > 0 ? string.Join(" ", lines) : "the setup did not run");
            }
            string groupSid = lines[1];
            File.WriteAllBytes(CredentialsFile(), ProtectedData.Protect(Encoding.UTF8.GetBytes(offline + "\n" + online + "\n" + groupSid), null, DataProtectionScope.CurrentUser));
            for (int k = 2; k < lines.Length; k++) Console.WriteLine(lines[k]);
            Console.WriteLine("configured");
            return 0;
        }
        finally
        {
            try { File.Delete(request); } catch (Exception) { }
            try { File.Delete(result); } catch (Exception) { }
        }
    }

    private static int RemoveAccounts()
    {
        string dir = SandboxDataDir();
        Directory.CreateDirectory(dir);
        string result = Path.Combine(dir, "remove-result.txt");
        try
        {
            File.Delete(result);
            if (IsAdministrator()) RemoveElevated(result);
            else RunElevated("--remove-elevated " + Quote(result));
            string[] lines = File.Exists(result) ? File.ReadAllLines(result) : new string[0];
            if (lines.Length < 1 || lines[0] != "ok") throw new InvalidOperationException(lines.Length > 0 ? string.Join(" ", lines) : "the removal did not run");
            try { File.Delete(CredentialsFile()); } catch (Exception) { }
            try { Directory.Delete(Path.Combine(dir, "home"), true); } catch (Exception) { }
            Console.WriteLine("removed");
            return 0;
        }
        finally
        {
            try { File.Delete(result); } catch (Exception) { }
        }
    }

    /// Already running as an administrator (a build server): no prompt is needed.
    private static bool IsAdministrator()
    {
        return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
    }

    /// Starts this launcher again as an administrator (the Windows prompt) and waits for it.
    private static void RunElevated(string arguments)
    {
        var start = new ProcessStartInfo(SelfPath(), arguments) { Verb = "runas", UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden };
        try
        {
            using (Process process = Process.Start(start))
            {
                process.WaitForExit();
            }
        }
        catch (Win32Exception e)
        {
            if (e.NativeErrorCode == 1223) throw new InvalidOperationException("the administrator approval was declined");
            throw;
        }
    }

    private static string NewPassword()
    {
        var bytes = new byte[24];
        using (var random = new RNGCryptoServiceProvider()) random.GetBytes(bytes);
        // Letters and digits from the random bytes, plus one of each kind a password policy may ask for.
        return "Ec7!" + Convert.ToBase64String(bytes).Replace('+', 'x').Replace('/', 'y').Replace("=", "");
    }

    // ---------------------------------------------------------------- the administrator's part

    private static int SetupElevated(string requestFile)
    {
        string resultFile = null;
        try
        {
            string[] request = File.ReadAllLines(requestFile);
            File.Delete(requestFile);
            if (request.Length < 3) throw new InvalidOperationException("the setup request is incomplete");
            resultFile = request[2];
            var notes = new List<string>();

            EnsureGroup();
            EnsureAccount(OfflineAccount, request[0]);
            EnsureAccount(OnlineAccount, request[1]);
            string groupSid = AccountSid(SandboxGroup);
            string offlineSid = AccountSid(OfflineAccount);
            string onlineSid = AccountSid(OnlineAccount);
            if (groupSid == null || offlineSid == null || onlineSid == null) throw new InvalidOperationException("the accounts were not found after they were created");

            // Members of "Users": the right to log on locally, and read access to Windows and programs.
            string users = ((NTAccount)new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null).Translate(typeof(NTAccount))).Value;
            users = users.Substring(users.IndexOf('\\') + 1);
            foreach (string account in new[] { OfflineAccount, OnlineAccount })
            {
                AddMember(users, account);
                AddMember(SandboxGroup, account);
            }

            using (RegistryKey key = Registry.LocalMachine.CreateSubKey(HiddenAccountsKey))
            {
                key.SetValue(OfflineAccount, 0, RegistryValueKind.DWord);
                key.SetValue(OnlineAccount, 0, RegistryValueKind.DWord);
            }

            try
            {
                DenyRemoteLogon(offlineSid);
                DenyRemoteLogon(onlineSid);
            }
            catch (Exception e)
            {
                notes.Add("note: remote logon could not be denied (" + e.Message + ")");
            }

            // Two ways to cut the account's network: a filter in the filtering platform, which
            // Windows applies whether or not its firewall is switched on, and a firewall rule.
            try
            {
                BlockNetworkWithFilters(offlineSid);
            }
            catch (Exception e)
            {
                notes.Add("filter-failed: " + e.Message);
            }
            try
            {
                BlockNetwork(offlineSid);
            }
            catch (Exception e)
            {
                notes.Add("firewall-failed: " + e.Message);
            }

            var lines = new List<string> { "ok", groupSid };
            lines.AddRange(notes);
            File.WriteAllLines(resultFile, lines.ToArray());
            return 0;
        }
        catch (Exception e)
        {
            if (resultFile != null) File.WriteAllLines(resultFile, new[] { "error", e.Message });
            return SetupFailed;
        }
    }

    private static int RemoveElevated(string resultFile)
    {
        try
        {
            try { RemoveNetworkFilters(); } catch (Exception) { }
            try { RemoveFirewallRule(); } catch (Exception) { }
            foreach (string account in new[] { OfflineAccount, OnlineAccount })
            {
                uint code = NetUserDel(null, account);
                if (code != 0 && code != NERR_UserNotFound) throw new Win32Exception((int)code, "the account " + account + " could not be removed (" + code + ")");
            }
            uint groupCode = NetLocalGroupDel(null, SandboxGroup);
            if (groupCode != 0 && groupCode != NERR_GroupNotFound && groupCode != ERROR_NO_SUCH_ALIAS) throw new Win32Exception((int)groupCode, "the group could not be removed (" + groupCode + ")");
            using (RegistryKey key = Registry.LocalMachine.OpenSubKey(HiddenAccountsKey, true))
            {
                if (key != null)
                {
                    key.DeleteValue(OfflineAccount, false);
                    key.DeleteValue(OnlineAccount, false);
                }
            }
            File.WriteAllLines(resultFile, new[] { "ok" });
            return 0;
        }
        catch (Exception e)
        {
            File.WriteAllLines(resultFile, new[] { "error", e.Message });
            return SetupFailed;
        }
    }

    private static void EnsureGroup()
    {
        var info = new LOCALGROUP_INFO_1 { name = SandboxGroup, comment = "Accounts that run the isolated commands of Emir Code" };
        uint parameter;
        uint code = NetLocalGroupAdd(null, 1, ref info, out parameter);
        if (code != 0 && code != ERROR_ALIAS_EXISTS && code != NERR_GroupExists) throw new Win32Exception((int)code, "the group could not be created (" + code + ")");
    }

    private static void EnsureAccount(string name, string password)
    {
        var info = new USER_INFO_1
        {
            name = name,
            password = password,
            priv = 1, // USER_PRIV_USER
            comment = "Runs the isolated commands of Emir Code",
            flags = 0x1 | 0x40 | 0x10000, // UF_SCRIPT | UF_PASSWD_CANT_CHANGE | UF_DONT_EXPIRE_PASSWD
        };
        uint parameter;
        uint code = NetUserAdd(null, 1, ref info, out parameter);
        if (code == NERR_UserExists)
        {
            // Set up before (by this or another user of the computer): the password is renewed.
            var renewed = new USER_INFO_1003 { password = password };
            code = NetUserSetInfo(null, name, 1003, ref renewed, out parameter);
        }
        if (code != 0) throw new Win32Exception((int)code, "the account " + name + " could not be created (" + code + ")");
    }

    private static void AddMember(string group, string account)
    {
        var member = new LOCALGROUP_MEMBERS_INFO_3 { domainandname = Environment.MachineName + "\\" + account };
        uint code = NetLocalGroupAddMembers(null, group, 3, ref member, 1);
        if (code != 0 && code != ERROR_MEMBER_IN_ALIAS) throw new Win32Exception((int)code, account + " could not be added to " + group + " (" + code + ")");
    }

    /// The accounts are for local use by the launcher only: no logon over the network or Remote Desktop.
    private static void DenyRemoteLogon(string sidText)
    {
        var attributes = new LSA_OBJECT_ATTRIBUTES();
        attributes.Length = Marshal.SizeOf(typeof(LSA_OBJECT_ATTRIBUTES));
        IntPtr policy;
        uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x10 | 0x800 /* create account, lookup names */, out policy);
        if (status != 0) throw new Win32Exception(LsaNtStatusToWinError(status));
        var buffers = new List<IntPtr>();
        try
        {
            var sid = new SecurityIdentifier(sidText);
            var sidBytes = new byte[sid.BinaryLength];
            sid.GetBinaryForm(sidBytes, 0);
            string[] names = { "SeDenyNetworkLogonRight", "SeDenyRemoteInteractiveLogonRight" };
            var rights = new LSA_UNICODE_STRING[names.Length];
            for (int k = 0; k < names.Length; k++)
            {
                IntPtr buffer = Marshal.StringToHGlobalUni(names[k]);
                buffers.Add(buffer);
                rights[k] = new LSA_UNICODE_STRING { Buffer = buffer, Length = (ushort)(names[k].Length * 2), MaximumLength = (ushort)(names[k].Length * 2 + 2) };
            }
            status = LsaAddAccountRights(policy, sidBytes, rights, (uint)rights.Length);
            if (status != 0) throw new Win32Exception(LsaNtStatusToWinError(status));
        }
        finally
        {
            foreach (IntPtr buffer in buffers) Marshal.FreeHGlobal(buffer);
            LsaClose(policy);
        }
    }

    /// A Windows firewall rule that blocks every outgoing connection of the account.
    private static void BlockNetwork(string sid)
    {
        object rules = FirewallRules();
        try { Invoke(rules, "Remove", FirewallRuleName); } catch (Exception) { }
        object rule = Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FWRule", true));
        SetProperty(rule, "Name", FirewallRuleName);
        SetProperty(rule, "Description", "Programs that the Emir Code agent runs isolated have no network.");
        SetProperty(rule, "Direction", 2); // outgoing
        SetProperty(rule, "Action", 0); // block
        SetProperty(rule, "Profiles", 0x7FFFFFFF); // every profile
        SetProperty(rule, "LocalUserAuthorizedList", "O:LSD:(A;;CC;;;" + sid + ")");
        SetProperty(rule, "Enabled", true);
        Invoke(rules, "Add", rule);
    }

    private static void RemoveFirewallRule()
    {
        Invoke(FirewallRules(), "Remove", FirewallRuleName);
    }

    private static object FirewallRules()
    {
        object policy = Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FwPolicy2", true));
        return policy.GetType().InvokeMember("Rules", BindingFlags.GetProperty, null, policy, null);
    }

    private static void SetProperty(object target, string name, object value)
    {
        target.GetType().InvokeMember(name, BindingFlags.SetProperty, null, target, new[] { value });
    }

    private static object Invoke(object target, string name, params object[] arguments)
    {
        return target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, arguments);
    }

    // ---------------------------------------------------------------- stage 1: log the account on

    private static int RunAsSandboxAccount(string root, List<string> reads, bool net, string program, string[] args, bool prepareOnly, bool check, bool netProbe)
    {
        Credentials credentials = LoadCredentials();
        if (credentials == null) throw new InvalidOperationException("full isolation is not set up on this computer");
        var group = new SecurityIdentifier(credentials.GroupSid);
        string home = PrepareHome(Path.Combine(SandboxDataDir(), "home"));

        Grant(root, group, FileSystemRights.Modify | FileSystemRights.Synchronize);
        GrantAncestors(root, group);
        Grant(home, group, FileSystemRights.Modify | FileSystemRights.Synchronize);
        GrantAncestors(home, group);
        // The account starts this launcher itself (stage 2) and reads the tools the program needs.
        reads.Add(Path.GetDirectoryName(SelfPath()));
        foreach (string dir in reads)
        {
            if (!Directory.Exists(dir)) continue;
            try
            {
                Grant(dir, group, FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize);
                GrantAncestors(dir, group);
            }
            catch (UnauthorizedAccessException)
            {
                // Folders of the administrators (Program Files, C:\Python3xx) are readable by every user.
            }
        }
        if (prepareOnly) return 0;

        UseHome(home);
        string account = net ? OnlineAccount : OfflineAccount;
        Environment.SetEnvironmentVariable("USERNAME", account);
        IntPtr environment = EnvironmentBlock();
        string user = WindowsIdentity.GetCurrent().User.Value;
        var pi = new PROCESS_INFORMATION();
        // A desktop of its own inside the user's window station (a process of another account does
        // not start on a separate window station). The account is let into the station with the
        // least that a process needs to start there: no clipboard, no screen, no other desktops.
        using (var desktop = new HiddenDesktop("D:(A;;GA;;;" + group.Value + ")(A;;GA;;;" + user + ")(A;;GA;;;SY)", group, StationRightsOfGuest))
        {
            IntPtr job = CreateSandboxJob();
            try
            {
                var commandLine = new StringBuilder(Quote(SelfPath()) + " --stage2 --root " + Quote(root) + " --group " + group.Value);
                if (netProbe) commandLine.Append(" --net-probe");
                else if (check) commandLine.Append(" --check");
                else
                {
                    commandLine.Append(" -- ").Append(Quote(program));
                    foreach (string a in args) commandLine.Append(' ').Append(Quote(a));
                }

                var si = new STARTUPINFO();
                si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                si.lpDesktop = desktop.Name;
                if (StandardHandles().Count > 0)
                {
                    si.dwFlags = STARTF_USESTDHANDLES;
                    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
                    si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
                    si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
                }
                if (!CreateProcessWithLogonW(account, ".", net ? credentials.OnlinePassword : credentials.OfflinePassword, 0, SelfPath(), commandLine,
                    CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, environment, root, ref si, out pi))
                {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "the isolated account could not start the program (" + error + "): " + new Win32Exception(error).Message);
                }
                if (!AssignProcessToJobObject(job, pi.hProcess))
                {
                    int error = Marshal.GetLastWin32Error();
                    TerminateProcess(pi.hProcess, SetupFailed);
                    throw new Win32Exception(error, "the program could not be put into its job (" + error + ")");
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
                CloseHandle(job); // stops whatever is still running in it
                Marshal.FreeHGlobal(environment);
            }
        }
    }

    /// The launcher's own environment as the block CreateProcessWithLogonW takes; without it the
    /// program would get the (empty) environment of the account.
    private static IntPtr EnvironmentBlock()
    {
        var names = new List<string>();
        IDictionary variables = Environment.GetEnvironmentVariables();
        foreach (DictionaryEntry entry in variables) names.Add((string)entry.Key);
        names.Sort(StringComparer.OrdinalIgnoreCase);
        var block = new StringBuilder();
        foreach (string name in names) block.Append(name).Append('=').Append((string)variables[name]).Append('\0');
        block.Append('\0');
        return Marshal.StringToHGlobalUni(block.ToString());
    }

    /// READ_CONTROL, WINSTA_ACCESSGLOBALATOMS and WINSTA_EXITWINDOWS: without any of the three a
    /// process of the account does not start. The job object gives the program an atom table of
    /// its own and refuses the calls that would end the user's session.
    private const int StationRightsOfGuest = 0x20000 | 0x20 | 0x40;

    private const uint NERR_GroupNotFound = 2220;
    private const uint NERR_UserNotFound = 2221;
    private const uint NERR_GroupExists = 2223;
    private const uint NERR_UserExists = 2224;
    private const uint ERROR_NO_SUCH_ALIAS = 1376;
    private const uint ERROR_MEMBER_IN_ALIAS = 1378;
    private const uint ERROR_ALIAS_EXISTS = 1379;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct USER_INFO_1
    {
        public string name;
        public string password;
        public uint password_age;
        public uint priv;
        public string home_dir;
        public string comment;
        public uint flags;
        public string script_path;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct USER_INFO_1003
    {
        public string password;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct LOCALGROUP_INFO_1
    {
        public string name;
        public string comment;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct LOCALGROUP_MEMBERS_INFO_3
    {
        public string domainandname;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_UNICODE_STRING
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_OBJECT_ATTRIBUTES
    {
        public int Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public int Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint NetUserAdd(string server, uint level, ref USER_INFO_1 info, out uint parameterError);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint NetUserSetInfo(string server, string user, uint level, ref USER_INFO_1003 info, out uint parameterError);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint NetUserDel(string server, string user);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint NetLocalGroupAdd(string server, uint level, ref LOCALGROUP_INFO_1 info, out uint parameterError);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint NetLocalGroupDel(string server, string group);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint NetLocalGroupAddMembers(string server, string group, uint level, ref LOCALGROUP_MEMBERS_INFO_3 members, uint count);

    [DllImport("advapi32.dll")]
    private static extern uint LsaOpenPolicy(IntPtr systemName, ref LSA_OBJECT_ATTRIBUTES attributes, uint access, out IntPtr policy);

    [DllImport("advapi32.dll")]
    private static extern uint LsaAddAccountRights(IntPtr policy, byte[] sid, LSA_UNICODE_STRING[] rights, uint count);

    [DllImport("advapi32.dll")]
    private static extern uint LsaClose(IntPtr policy);

    [DllImport("advapi32.dll")]
    private static extern int LsaNtStatusToWinError(uint status);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessWithLogonW(string user, string domain, string password, uint logonFlags, string applicationName, StringBuilder commandLine,
        uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);
}
