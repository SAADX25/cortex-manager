using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Reflection;

[assembly: AssemblyTitle("Cortex Manager 6")]
[assembly: AssemblyDescription("Modern local Discord management dashboard")]
[assembly: AssemblyVersion("6.0.0.0")]
[assembly: AssemblyFileVersion("6.0.0.0")]

// The window is rendered by installed Microsoft Edge. This process owns only its
// local Node service; it never terminates other browsers or a legacy bot session.
internal static class ModernLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        Process service = null;
        Mutex single = null;
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            bool demo = Array.IndexOf(args, "--demo") >= 0;
            string server = Path.Combine(root, "src", "desktop-server.mjs");
            if (!File.Exists(server)) throw new Exception("احتفظ بملف CortexManager.exe داخل مجلد المشروع الكامل، ثم افتحه مجددًا.");
            string node = FindNode();
            string edge = FindEdge();
            string id;
            using (SHA256 sha = SHA256.Create()) id = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-", "").Substring(0, 20);
            bool created;
            single = new Mutex(true, "Local\\CortexManagerModern6-" + id + (demo ? "-demo" : ""), out created);
            if (!created)
            {
                MessageBox.Show("لوحة Cortex Manager 6 مفتوحة بالفعل. ابحث عن نافذتها في شريط المهام.\nيمكنك تمييزها عن النسخة القديمة بشعار C البنفسجي وشارة MODERN 6.", "Cortex Manager 6", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            var ready = new ManualResetEvent(false);
            string localUrl = null, startupError = null;
            var serializer = new JavaScriptSerializer();
            service = new Process();
            service.StartInfo = new ProcessStartInfo(node, Quote(server) + " --root " + Quote(root) + (demo ? " --demo" : ""))
            {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            service.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data == null) { ready.Set(); return; }
                try
                {
                    var data = serializer.Deserialize<System.Collections.Generic.Dictionary<string, object>>(e.Data);
                    if (data.ContainsKey("event") && Convert.ToString(data["event"]) == "ready")
                    {
                        localUrl = Convert.ToString(data["url"]);
                        ready.Set();
                    }
                }
                catch { /* Only a ready envelope is consumed. */ }
            };
            service.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (!String.IsNullOrEmpty(e.Data)) startupError = e.Data;
            };
            if (!service.Start()) throw new Exception("تعذر تشغيل الخدمة المحلية.");
            service.BeginOutputReadLine(); service.BeginErrorReadLine();
            if (!ready.WaitOne(20000) || String.IsNullOrEmpty(localUrl))
                throw new Exception("تعذر تجهيز لوحة التحكم المحلية. " + (startupError ?? "تحقق من تثبيت Node.js 22.9 أو أحدث."));
            Uri uri;
            if (!Uri.TryCreate(localUrl, UriKind.Absolute, out uri) || uri.Scheme != "http" || uri.Host != "127.0.0.1" || uri.Port < 1)
                throw new Exception("عنوان خدمة محلية غير صالح.");
            string profile = Path.Combine(root, "out", "desktop-modern", demo ? "demo-profile" : "browser-profile");
            Directory.CreateDirectory(profile);
            var browserInfo = new ProcessStartInfo(edge,
                "--app=" + Quote(localUrl) + " --user-data-dir=" + Quote(profile) +
                " --no-first-run --no-default-browser-check --disable-background-mode --window-size=1480,960")
            { UseShellExecute = false, CreateNoWindow = true };
            Process.Start(browserInfo);
            // Edge may hand the window to an existing process in this dedicated
            // profile. The service's authenticated UI lifecycle determines exit.
            service.WaitForExit();
            return service.ExitCode;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Cortex Manager 6 — تعذر التشغيل", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            if (service != null)
            {
                try { if (!service.HasExited) { service.StandardInput.WriteLine("{\"action\":\"shutdown\"}"); service.StandardInput.Close(); service.WaitForExit(8000); } }
                catch { }
                service.Dispose();
            }
            if (single != null) single.Dispose();
        }
    }

    private static string FindNode()
    {
        string[] candidates = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
        };
        foreach (string value in candidates) if (File.Exists(value)) return value;
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try { string candidate = Path.Combine(directory.Trim('"'), "node.exe"); if (File.Exists(candidate)) return candidate; } catch { }
        }
        throw new Exception("ثبّت Node.js 22.9 أو أحدث ثم افتح البرنامج مجددًا.");
    }

    private static string FindEdge()
    {
        using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
        {
            string registered = key == null ? null : Convert.ToString(key.GetValue(""));
            if (!String.IsNullOrEmpty(registered) && File.Exists(registered)) return registered;
        }
        string[] roots = { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) };
        foreach (string directory in roots)
        {
            string candidate = Path.Combine(directory, "Microsoft", "Edge", "Application", "msedge.exe");
            if (File.Exists(candidate)) return candidate;
        }
        throw new Exception("يحتاج التصميم الجديد Microsoft Edge. ثبّته ثم افتح البرنامج مجددًا.");
    }

    private static string Quote(string value)
    {
        // Windows CommandLineToArgvW quoting, including trailing backslashes.
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value)
        {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') { result.Append('\\', slashes * 2 + 1); result.Append(ch); slashes = 0; continue; }
            result.Append('\\', slashes); result.Append(ch); slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
    }
}
