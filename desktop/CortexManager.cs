using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace CortexManagerDesktop {
    static class Program {
        [STAThread]
        static int Main(string[] args) {
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string root = args.Length > 1 ? Path.GetFullPath(args[1]) : Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
            string node = args.Length > 2 ? args[2] : "node.exe";
            try {
                if (args.Length > 0 && args[0] == "--self-test") {
                    string output = Path.Combine(root, "out", "desktop");
                    Directory.CreateDirectory(output);
                    string value = "local-encryption-test";
                    byte[] encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser);
                    if (Encoding.UTF8.GetString(ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser)) != value) throw new Exception("DPAPI round trip failed");
                    int testExit = 0;
                    Control.CheckForIllegalCrossThreadCalls = true;
                    using (MainForm form = new MainForm(root, node, true)) {
                        form.ShowInTaskbar = false; form.Opacity = 0;
                        form.Shown += async delegate {
                            try {
                                string fixture = Path.Combine(output, "diagnostics-fixture.json");
                                if (File.Exists(fixture)) {
                                    form.ConsumeLine(File.ReadAllText(fixture, Encoding.UTF8));
                                    if (!form.DiagnosticsLoaded) throw new Exception("Diagnostics UI did not load the fixture");
                                }
                                form.PerformLayout();
                                using (Bitmap bitmap = new Bitmap(form.Width, form.Height)) {
                                    form.DrawToBitmap(bitmap, new Rectangle(0, 0, bitmap.Width, bitmap.Height));
                                    bitmap.Save(Path.Combine(output, "desktop-preview.png"), System.Drawing.Imaging.ImageFormat.Png);
                                }
                                form.CaptureEditorPreviews(output);
                                if (form.RebuildEnabled || form.HasRunningWorker) throw new Exception("Unsafe initial UI state");
                                if (File.Exists(Path.Combine(output, "ui-mock-fetch.mjs"))) await form.RunReadOnlySelfTest();
                                File.WriteAllText(Path.Combine(output, "self-test.json"), "{\"success\":true,\"encryptedStorageRoundTrip\":true,\"rebuildInitiallyDisabled\":true,\"networkCalls\":0}");
                            } catch (Exception error) {
                                testExit = 1; File.WriteAllText(Path.Combine(output, "self-test-error.txt"), error.ToString());
                            } finally { form.Close(); }
                        };
                        Application.Run(form);
                    }
                    return testExit;
                }
                bool created;
                string identity;
                using (SHA256 sha = SHA256.Create()) identity = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root))).Replace("-", "");
                using (Mutex mutex = new Mutex(true, "Local\\CortexManagerDesktop-" + identity, out created)) {
                    if (!created) { MessageBox.Show("البرنامج مفتوح بالفعل لهذا المشروع.", "Cortex Manager"); return 0; }
                    try { Application.Run(new MainForm(root, node, false)); }
                    finally { mutex.ReleaseMutex(); }
                }
                return 0;
            } catch (Exception error) {
                if (args.Length > 0 && args[0] == "--self-test") {
                    File.WriteAllText(Path.Combine(root, "out", "desktop", "self-test-error.txt"), error.ToString()); return 1;
                }
                MessageBox.Show(error.Message, "Cortex Manager", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1;
            }
        }
    }

    sealed partial class MainForm : Form {
        readonly string root, node, session, reports, settingsFile;
        readonly bool selfTest;
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 16777216, RecursionLimit = 128 };
        readonly Color background = Color.FromArgb(15, 19, 31), card = Color.FromArgb(25, 31, 48), ink = Color.FromArgb(230, 235, 247);
        readonly TextBox token = new TextBox(), guild = new TextBox();
        readonly CheckBox remember = new CheckBox(), reviewed = new CheckBox(), admin = new CheckBox();
        readonly TextBox preview = new TextBox(), permissions = new TextBox(), log = new TextBox();
        readonly Label status = new Label(), presence = new Label();
        readonly Button inspect = new ActionButton(), online = new ActionButton(), offline = new ActionButton(), propose = new ActionButton(), rebuild = new ActionButton();
        readonly PageDeck tabs = new PageDeck();
        Process onlineProcess, jobProcess;
        bool busy, previewValid, ready;
        string inviteURL, adminInviteURL;
        public bool RebuildEnabled { get { return rebuild.Enabled; } }
        public bool HasRunningWorker { get { return busy || onlineProcess != null; } }
        public bool DiagnosticsLoaded { get { return inviteURL != null; } }

        public MainForm(string projectRoot, string nodePath, bool selfTest) {
            root = projectRoot; node = nodePath; this.selfTest = selfTest;
            session = Path.Combine(root, "out", "local-session-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            reports = Path.Combine(session, "out");
            settingsFile = Path.Combine(root, "out", "desktop", "settings.json");
            Text = "Cortex Manager v5 | مساحة إدارة Discord";
            ClientSize = new Size(1360, 880); MinimumSize = new Size(1160, 760);
            StartPosition = FormStartPosition.CenterScreen; BackColor = background; ForeColor = ink;
            Font = new Font("Segoe UI", 10); RightToLeft = RightToLeft.Yes;
            BuildUI();
            if (!selfTest) LoadSettings();
            ready = true; UpdateControls();
            token.TextChanged += delegate { CredentialsChanged(); };
            guild.TextChanged += delegate { CredentialsChanged(); };
            reviewed.CheckedChanged += delegate {
                if (!ready || Disposing || IsDisposed) return;
                if (reviewed.Checked && !previewValid) { reviewed.Checked = false; status.Text = "أنشئ معاينة ناجحة واقرأها أولاً لإتاحة التنفيذ."; }
                UpdateControls();
            };
            inspect.Click += async delegate { await RunJob("check"); };
            propose.Click += async delegate { await RunJob("preview"); };
            online.Click += delegate { StartOnline(); };
            offline.Click += delegate { StopOnline(); };
            rebuild.Click += async delegate { await ConfirmRebuild(); };
            FormClosing += OnClosing;
        }
        Label LabelAt(Control parent, string text, int x, int y, int w, int h) {
            Label label = new Label { Text = text, Bounds = new Rectangle(x, y, w, h), TextAlign = ContentAlignment.MiddleRight, ForeColor = ink, BackColor = Color.Transparent };
            parent.Controls.Add(label); return label;
        }
        void StyleButton(Button b, string text, Color color) {
            b.Text = text; b.Size = new Size(177, 42); b.Margin = new Padding(4, 4, 4, 4);
            b.BackColor = color; b.ForeColor = Color.White; b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderSize = 0;
            b.Cursor = Cursors.Hand; b.Font = new Font("Segoe UI", 10, FontStyle.Bold);
        }
        void StyleText(TextBox box) {
            box.BackColor = background; box.ForeColor = ink; box.BorderStyle = BorderStyle.FixedSingle;
            box.Font = new Font("Consolas", 11); box.RightToLeft = RightToLeft.No;
        }
        void StyleReport(TextBox box) {
            box.Dock = DockStyle.Fill; box.BackColor = card; box.ForeColor = ink; box.ReadOnly = true;
            box.BorderStyle = BorderStyle.None; box.Font = new Font("Segoe UI", 11); box.Multiline = true; box.ScrollBars = ScrollBars.Vertical;
        }
        void BuildUI() { BuildDashboard(); }
        void CredentialsChanged() { if (!ready || Disposing || IsDisposed) return; previewValid = false; reviewed.Checked = false; inviteURL = null; adminInviteURL = null; ResetInventory(); UpdateControls(); }
        bool ValidateCredentials() {
            if (String.IsNullOrWhiteSpace(token.Text) || !System.Text.RegularExpressions.Regex.IsMatch(guild.Text.Trim(), "^[0-9]{16,22}$")) {
                MessageBox.Show(this, "أدخل توكن البوت ورقم السيرفر الصحيح أولاً.", "البيانات المطلوبة"); return false;
            }
            return true;
        }
        void UpdateControls() {
            if (Disposing || IsDisposed) return;
            token.Enabled = !busy && onlineProcess == null; guild.Enabled = !busy;
            inspect.Enabled = !busy; propose.Enabled = !busy; online.Enabled = !busy && onlineProcess == null;
            offline.Enabled = onlineProcess != null; reviewed.Enabled = !busy;
            rebuild.Enabled = !busy && previewValid && reviewed.Checked;
            RefreshEditorControls();
        }
        void Post(Action action) { if (!Disposing && !IsDisposed && IsHandleCreated) try { BeginInvoke(action); } catch (InvalidOperationException) { } }
        void AppendLog(string line) {
            if (!String.IsNullOrEmpty(token.Text)) line = line.Replace(token.Text.Trim(), "[TOKEN]");
            log.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + line + Environment.NewLine);
            if (log.TextLength > 500000) log.Text = log.Text.Substring(log.TextLength - 300000);
            log.SelectionStart = log.TextLength; log.ScrollToCaret();
        }
        internal void ConsumeLine(string line) {
            line = line.TrimStart('\uFEFF', ' ', '\t');
            if (line.StartsWith("{")) {
                try {
                    Dictionary<string, object> message = Map(json.DeserializeObject(line));
                    if (message.ContainsKey("event") && Convert.ToString(message["event"]) == "presence") {
                        string state = Convert.ToString(message["status"]); presence.Text = Convert.ToString(message["message"]);
                        presence.ForeColor = state == "online" ? Color.FromArgb(87, 242, 135) : Color.FromArgb(255, 213, 148);
                        AppendLog(presence.Text); return;
                    }
                    if (Str(message, "event") == "diagnostics") { ShowDiagnostics(Map(message["data"])); return; }
                    if (Str(message, "event") == "edit-preview") {
                        Dictionary<string, object> data = Map(message["data"]); pendingEditHash = Str(data, "approvalHash");
                        if (pendingEditor != null) { pendingEditor.ShowReview(Str(data, "summary")); pendingEditor.AllowApply(true); }
                        AppendLog("جهزت معاينة التعديل؛ لم يُحفظ شيء في Discord."); return;
                    }
                    if (Str(message, "event") == "edit-applied") { editApplied = Flag(Map(message["data"]), "success"); AppendLog(editApplied ? "تم حفظ التعديل المحدد بنجاح." : "لم يكتمل الحفظ؛ راجع التقرير."); return; }
                    AppendLog("وصل رد من البرنامج؛ لا توجد بيانات تقنية لعرضها في السجل."); return;
                } catch (Exception error) { AppendLog("تعذّر عرض الرد: " + error.Message + " — حدّث السيرفر أو راجع الإصدار الحالي."); return; }
            }
            AppendLog(line);
        }
        Process CreateWorker(string operation) {
            Directory.CreateDirectory(session);
            ProcessStartInfo start = new ProcessStartInfo(node, Quote(Path.Combine(root, "src", "desktop-worker.mjs")) + " " + operation) {
                WorkingDirectory = session, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            if (selfTest) {
                string mock = Path.Combine(root, "out", "desktop", "ui-mock-fetch.mjs");
                if (!File.Exists(mock)) throw new Exception("Self-test requires its network-blocking mock before starting a worker");
                start.EnvironmentVariables["NODE_OPTIONS"] = "--import=" + new Uri(mock).AbsoluteUri;
            }
            Process process = new Process { StartInfo = start, EnableRaisingEvents = true };
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Post(delegate { ConsumeLine(e.Data); }); };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Post(delegate { if (operation != "online" && lastWorkerError == null) lastWorkerError = e.Data; AppendLog(e.Data); }); };
            return process;
        }
        void SendConfig(Process process, string confirmGuild, string confirmDelete) {
            // .NET Framework's stdin writer uses the Windows code page. Escape
            // Unicode JSON code units so Arabic and emoji survive every locale.
            string serialized = json.Serialize(new Dictionary<string, object> {
                { "token", token.Text.Trim() }, { "guildId", guild.Text.Trim() }, { "confirmGuildId", confirmGuild }, { "confirmDelete", confirmDelete },
                { "editRequest", pendingEditRequest }, { "editConfirmation", new Dictionary<string, object> { { "confirmed", true }, { "guildId", guild.Text.Trim() }, { "approvalHash", pendingEditHash } } }
            });
            StringBuilder wire = new StringBuilder(); foreach (char character in serialized) { if (character > 127) wire.Append("\\u" + ((int)character).ToString("x4")); else wire.Append(character); }
            process.StandardInput.WriteLine(wire.ToString()); process.StandardInput.Flush();
        }
        async Task RunJob(string operation, string confirmGuild = "", string confirmDelete = "") {
            if (busy || !ValidateCredentials()) return;
            busy = true;
            lastWorkerError = null;
            if (operation != "check" && operation != "inventory") { previewValid = false; reviewed.Checked = false; }
            UpdateControls(); status.Text = operation == "check" ? "جارٍ فحص صلاحيات البوت…" : operation == "inventory" ? "جارٍ تحميل القنوات والرتب من السيرفر…" : operation == "edit-preview" ? "جارٍ مراجعة التعديل دون حفظ…" : operation == "edit-apply" ? "جارٍ حفظ التعديل المؤكد…" : operation == "preview" ? "جارٍ تجهيز معاينة التصميم…" : "جارٍ تنفيذ الخطة المؤكدة…";
            AppendLog(status.Text);
            try {
                Process process = CreateWorker(operation); jobProcess = process;
                TaskCompletionSource<int> completed = new TaskCompletionSource<int>();
                process.Exited += delegate { process.WaitForExit(); completed.TrySetResult(process.ExitCode); };
                process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine(); SendConfig(process, confirmGuild, confirmDelete); process.StandardInput.Close();
                int code = await completed.Task;
                if (operation == "preview") {
                    string file = Path.Combine(reports, "preview.md");
                    if (File.Exists(file)) preview.Text = Newlines("معاينة فقط — راجع قوائم الإنشاء والحذف والحماية بالكامل\n\n" + File.ReadAllText(file, Encoding.UTF8));
                    previewValid = code == 0 && File.Exists(Path.Combine(reports, "approval.json")); tabs.SelectedIndex = 3;
                } else if (operation == "check") tabs.SelectedIndex = 4;
                else if (operation == "rebuild") tabs.SelectedIndex = 5;
                status.Text = code == 0 ? "اكتملت العملية. راجع التقرير قبل أي خطوة أخرى." : "توقفت العملية. راجع سجل التشغيل والتقارير لمعرفة السبب.";
                AppendLog(status.Text); process.Dispose(); jobProcess = null;
                if (code != 0 && operation == "edit-preview" && pendingEditor != null) pendingEditor.ShowReview(lastWorkerError ?? "تعذّرت المعاينة؛ راجع سجل العمليات.");
            } catch (Exception error) { status.Text = "تعذّر تشغيل العملية المحلية."; AppendLog(error.Message); }
            finally { busy = false; UpdateControls(); }
        }
        void StartOnline() {
            if (onlineProcess != null || !ValidateCredentials()) return;
            try {
                Process process = CreateWorker("online"); onlineProcess = process;
                process.Exited += delegate { process.WaitForExit(); Post(delegate {
                    if (onlineProcess == process) { onlineProcess = null; presence.Text = "اتصال البرنامج: متوقف — راجع السجل إذا لم توقفه بنفسك"; presence.ForeColor = Color.Silver; UpdateControls(); }
                    process.Dispose();
                }); };
                process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine(); SendConfig(process, "", "");
                presence.Text = "جارٍ بدء اتصال البوت…"; UpdateControls();
            } catch (Exception error) { onlineProcess = null; AppendLog(error.Message); UpdateControls(); }
        }
        void StopOnline() {
            Process process = onlineProcess;
            if (process == null) return;
            try { process.StandardInput.WriteLine("{\"action\":\"stop\"}"); process.StandardInput.Flush(); process.StandardInput.Close(); }
            catch { try { if (!process.HasExited) process.Kill(); } catch { } }
            presence.Text = "جارٍ إيقاف اتصال البرنامج…";
        }
        void ShowDiagnostics(Dictionary<string, object> data) {
            StringBuilder report = new StringBuilder();
            report.AppendLine("السيرفر: " + data["guildName"] + "  (" + data["guildId"] + ")");
            report.AppendLine("البوت: " + data["botName"] + "  |  أعلى رتبة للبوت: " + data["topPosition"]);
            report.AppendLine("\nالصلاحيات الفعلية في السيرفر\n");
            permissionTable.Rows.Clear();
            foreach (object item in Items(data["permissions"])) {
                Dictionary<string, object> p = Map(item);
                report.AppendLine((Convert.ToBoolean(p["granted"]) ? "✓ متاحة  " : "✕ غير متاحة  ") + p["name"]);
                int index = permissionTable.Rows.Add(EntityEditor.PermissionLabel(Str(p, "name")), Flag(p, "granted") ? "✓ متاحة" : "غير متاحة");
                permissionTable.Rows[index].Cells[1].Style.ForeColor = Flag(p, "granted") ? Color.FromArgb(105, 219, 178) : Color.FromArgb(255, 196, 127);
            }
            report.AppendLine("\nالرتب المحمية والمحفوظة\n");
            foreach (object item in Items(data["roles"])) {
                Dictionary<string, object> r = Map(item);
                if (r["preserved"] != null) report.AppendLine(r["name"] + " — " + r["id"] + " — " + r["preserved"]);
            }
            report.AppendLine("\nصلاحيات الرتب الجديدة التي لا يستطيع البوت منحها حالياً\n");
            foreach (object item in Items(data["missingRights"])) {
                Dictionary<string, object> r = Map(item);
                List<string> missing = new List<string>(); foreach (object right in Items(r["missing"])) missing.Add(Convert.ToString(right));
                report.AppendLine(r["role"] + ": " + String.Join(", ", missing));
            }
            report.AppendLine("\nقنوات لا يستطيع البوت إدارتها (تُحفظ)\n");
            foreach (object item in Items(data["inaccessibleChannels"])) {
                Dictionary<string, object> channel = Map(item); report.AppendLine(channel["name"] + " — " + channel["id"]);
            }
            report.AppendLine("\nAdmin لا يتجاوز حماية البرنامج للرتب والقنوات. إذا بقيت رتبة قديمة أعلى من البوت، تُحفظ؛ لا تحرّك OWNER أو CO_OWNER لأجل الأداة.");
            permissions.Text = Newlines(report.ToString()); AppendLog("اكتمل فحص الصلاحيات — " + data["guildName"]);
            if (data.ContainsKey("inventory")) RenderInventory(Map(data["inventory"]));
            inviteURL = Convert.ToString(data["inviteURL"]); adminInviteURL = Convert.ToString(data["adminInviteURL"]);
        }
        async Task OpenInvite() {
            if (busy) return;
            if (inviteURL == null) await RunJob("check");
            string address = admin.Checked ? adminInviteURL : inviteURL;
            if (String.IsNullOrEmpty(address)) return;
            Uri uri = new Uri(address);
            if (uri.Scheme != "https" || uri.Host != "discord.com" || uri.AbsolutePath != "/oauth2/authorize") return;
            string message = admin.Checked ? "سيفتح Discord لطلب Administrator للبوت في هذا السيرفر. راجع الطلب ووافق من حسابك إذا أردت منح كل الصلاحيات. حماية OWNER وCO_OWNER تبقى فعالة في الأداة." : "سيفتح Discord لطلب الصلاحيات المحددة اللازمة للتصميم. لن تُمنح صلاحيات حتى توافق من حسابك.";
            if (MessageBox.Show(this, message, "تفويض البوت", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) == DialogResult.OK) {
                try { Process.Start(new ProcessStartInfo(address) { UseShellExecute = true }); }
                catch (Exception error) { MessageBox.Show(this, "تعذّر فتح المتصفح.\n" + error.Message); }
            }
        }
        async Task ConfirmRebuild() {
            if (!previewValid || !reviewed.Checked || busy) return;
            using (Confirmation dialog = new Confirmation(guild.Text.Trim())) {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                try {
                    string backup = Path.Combine(session, "backups", DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                    Directory.CreateDirectory(backup);
                    foreach (string file in new string[] { "snapshot.json", "approval.json", "plan.json", "preview.md" }) File.Copy(Path.Combine(reports, file), Path.Combine(backup, file), false);
                    AppendLog("حُفظت نسخة المعاينة قبل التنفيذ: " + backup);
                } catch (Exception error) { MessageBox.Show(this, "تعذّر حفظ النسخة السابقة؛ لم يبدأ التنفيذ.\n" + error.Message); return; }
                await RunJob("rebuild", dialog.GuildID, dialog.DeletionPhrase);
            }
        }
        void SaveSettings() {
            if (!ValidateCredentials()) return;
            try {
                Directory.CreateDirectory(Path.GetDirectoryName(settingsFile));
                string protectedToken = remember.Checked ? Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(token.Text.Trim()), null, DataProtectionScope.CurrentUser)) : null;
                File.WriteAllText(settingsFile, json.Serialize(new Dictionary<string, object> { { "guildId", guild.Text.Trim() }, { "protectedToken", protectedToken } }), Encoding.UTF8);
                MessageBox.Show(this, remember.Checked ? "حُفظ التوكن مشفّراً لحساب ويندوز الحالي ورقم السيرفر." : "حُفظ رقم السيرفر فقط. لا يوجد توكن محفوظ في الإعدادات.", "الإعدادات");
            } catch (Exception error) { MessageBox.Show(this, "تعذّر حفظ الإعدادات.\n" + error.Message); }
        }
        void LoadSettings() {
            if (!File.Exists(settingsFile)) return;
            try {
                Dictionary<string, object> data = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(settingsFile, Encoding.UTF8));
                guild.Text = Convert.ToString(data["guildId"]);
                if (data.ContainsKey("protectedToken") && data["protectedToken"] != null) {
                    token.Text = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(Convert.ToString(data["protectedToken"])), null, DataProtectionScope.CurrentUser)); remember.Checked = true;
                }
            } catch { AppendLog("لم تُفتح الإعدادات المحفوظة. أدخل بياناتك محلياً من جديد."); }
        }
        void OnClosing(object sender, FormClosingEventArgs e) {
            if (busy) { e.Cancel = true; MessageBox.Show(this, "هناك عملية قيد التنفيذ. انتظر انتهائها وراجع التقرير قبل إغلاق البرنامج.", "عملية نشطة"); return; }
            ready = false;
            Process process = onlineProcess;
            if (process != null) {
                StopOnline();
                try { if (!process.WaitForExit(2500)) process.Kill(); } catch { }
            }
        }
        internal async Task RunReadOnlySelfTest() {
            File.AppendAllText(Path.Combine(root, "out", "desktop", "ui-test-trace.txt"), "Starting permission check\n");
            token.Text = "test-placeholder"; guild.Text = "111111111111111111";
            await RunJob("check");
            File.AppendAllText(Path.Combine(root, "out", "desktop", "ui-test-trace.txt"), "Permission check completed\n");
            if (!DiagnosticsLoaded || permissionTable.Rows.Count == 0 || channelTree.Nodes.Count == 0 || roleTable.Rows.Count == 0) throw new Exception("Permission/inventory worker did not update the desktop UI");
            Dictionary<string, object> editableRole = null;
            foreach (object item in Items(inventoryData["roles"])) { Dictionary<string, object> role = Map(item); if (Value(role, "readOnlyReason") == null) { editableRole = role; break; } }
            if (editableRole == null) throw new Exception("Missing editable role fixture");
            string testName = "🎮・رتبة تجريبية";
            roleEditor.LoadEntity(editableRole, inventoryData, false, 0); roleEditor.TestRename(testName);
            await ReviewEditor(roleEditor);
            if (pendingEditHash == null || !roleEditor.ApplyEnabled) throw new Exception("Single-role edit review failed");
            Dictionary<string, object> storedPlan = Map(json.DeserializeObject(File.ReadAllText(Path.Combine(reports, "edit-plan.json"), Encoding.UTF8)));
            if (Str(Map(storedPlan["body"]), "name") != testName) throw new Exception("Arabic/emoji edit text was corrupted on stdin");
            if (log.Text.Contains("\"event\":\"diagnostics\"")) throw new Exception("Raw diagnostic JSON leaked into the UI");
            InvalidateEdit();
            await RunJob("preview");
            File.AppendAllText(Path.Combine(root, "out", "desktop", "ui-test-trace.txt"), "Preview completed\n");
            if (!previewValid || RebuildEnabled) throw new Exception("Desktop preview approval gating failed");
            reviewed.Checked = true;
            if (!RebuildEnabled) throw new Exception("Reviewed preview did not enable confirmation button");
            reviewed.Checked = false;
            using (Confirmation confirm = new Confirmation(guild.Text)) {
                if (confirm.GuildID != "" || confirm.DeletionPhrase != "") throw new Exception("Confirmation must not be pre-filled");
            }
            File.AppendAllText(Path.Combine(root, "out", "desktop", "ui-test-trace.txt"), "All UI checks completed\n");
        }
        static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
        static string Newlines(string value) { return value.Replace("\r\n", "\n").Replace("\n", Environment.NewLine); }
    }

    sealed class ActionButton : Button {
        protected override void OnPaint(PaintEventArgs e) {
            if (Enabled) { base.OnPaint(e); return; }
            e.Graphics.Clear(BackColor);
            TextRenderer.DrawText(e.Graphics, Text, Font, ClientRectangle, Color.FromArgb(173, 183, 199),
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.RightToLeft);
        }
    }

    sealed class Confirmation : Form {
        readonly TextBox guild = new TextBox(), phrase = new TextBox();
        public string GuildID { get { return guild.Text; } }
        public string DeletionPhrase { get { return phrase.Text; } }
        public Confirmation(string expected) {
            Text = "تأكيد إعادة بناء السيرفر"; ClientSize = new Size(700, 360); StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
            RightToLeft = RightToLeft.Yes; Font = new Font("Segoe UI", 11);
            Label warning = new Label { Bounds = new Rectangle(24, 20, 652, 72), Text = "هذا التنفيذ سيحذف القنوات والرتب القديمة المذكورة في المعاينة. الرسائل والمرفقات لا تُستعاد. الرتب والقنوات المحمية تبقى محفوظة.", ForeColor = Color.DarkRed };
            Label label = new Label { Bounds = new Rectangle(24, 100, 652, 30), Text = "اكتب رقم السيرفر للتأكيد: " + expected };
            guild.Bounds = new Rectangle(24, 134, 652, 30); guild.RightToLeft = RightToLeft.No;
            Label instructions = new Label { Bounds = new Rectangle(24, 181, 652, 28), Text = "اكتب العبارة التالية تماماً:", TextAlign = ContentAlignment.MiddleRight };
            Label literal = new Label { Bounds = new Rectangle(24, 211, 652, 28), Text = "DELETE_ALL_OLD_CHANNELS_AND_ROLES", RightToLeft = RightToLeft.No, Font = new Font("Consolas", 13, FontStyle.Bold), TextAlign = ContentAlignment.MiddleCenter };
            phrase.Bounds = new Rectangle(24, 245, 652, 30); phrase.RightToLeft = RightToLeft.No;
            Button ok = new Button { Bounds = new Rectangle(362, 302, 152, 38), Text = "تأكيد التنفيذ", Enabled = false, DialogResult = DialogResult.OK };
            Button cancel = new Button { Bounds = new Rectangle(524, 302, 152, 38), Text = "إلغاء", DialogResult = DialogResult.Cancel };
            EventHandler validate = delegate { if (!Disposing && !IsDisposed) ok.Enabled = guild.Text == expected && phrase.Text == "DELETE_ALL_OLD_CHANNELS_AND_ROLES"; };
            guild.TextChanged += validate; phrase.TextChanged += validate;
            Controls.AddRange(new Control[] { warning, label, guild, instructions, literal, phrase, ok, cancel }); CancelButton = cancel;
        }
    }
}
