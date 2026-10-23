using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CortexManagerDesktop {
    sealed partial class MainForm {
        readonly TreeView channelTree = new TreeView();
        readonly DataGridView roleTable = new DataGridView(), permissionTable = new DataGridView();
        readonly TextBox channelSearch = new TextBox(), roleSearch = new TextBox();
        readonly Label serverHeading = new Label(), serverDetails = new Label(), channelMetric = new Label(), categoryMetric = new Label(), roleMetric = new Label(), voiceMetric = new Label();
        readonly Button refreshServer = new ActionButton();
        readonly List<Button> navigation = new List<Button>();
        readonly EntityEditor channelEditor = new EntityEditor(false), roleEditor = new EntityEditor(true);
        Dictionary<string, object> inventoryData, pendingEditRequest;
        EntityEditor pendingEditor;
        string pendingEditHash;
        string lastWorkerError;
        bool editApplied;

        internal static Dictionary<string, object> Map(object value) {
            Dictionary<string, object> map = value as Dictionary<string, object>;
            if (map == null) throw new Exception("بنية بيانات غير متوقعة"); return map;
        }
        internal static IEnumerable<object> Items(object value) {
            if (value == null) yield break;
            IEnumerable list = value as IEnumerable;
            if (list == null || value is string) throw new Exception("قائمة بيانات غير صالحة");
            foreach (object item in list) yield return item;
        }
        internal static object Value(Dictionary<string, object> map, string key, object fallback = null) { object value; return map != null && map.TryGetValue(key, out value) ? value : fallback; }
        internal static string Str(Dictionary<string, object> map, string key) { return Convert.ToString(Value(map, key)); }
        internal static int Num(Dictionary<string, object> map, string key) { return Convert.ToInt32(Value(map, key, 0)); }
        internal static bool Flag(Dictionary<string, object> map, string key) { return Convert.ToBoolean(Value(map, key, false)); }

        void BuildDashboard() {
            TableLayoutPanel shell = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), RowCount = 3, ColumnCount = 1 };
            shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 70)); shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 28)); Controls.Add(shell);
            Panel heading = new Panel { Dock = DockStyle.Fill };
            Label brand = new Label { Text = "CORTEX / CONTROL", Dock = DockStyle.Left, Width = 440, Font = new Font("Segoe UI", 24, FontStyle.Bold), ForeColor = ink, TextAlign = ContentAlignment.MiddleLeft, RightToLeft = RightToLeft.No };
            Label arabic = new Label { Text = "مساحة إدارة مجتمعك", Dock = DockStyle.Right, Width = 420, Font = new Font("Segoe UI", 20, FontStyle.Bold), TextAlign = ContentAlignment.MiddleRight };
            heading.Controls.Add(brand); heading.Controls.Add(arabic); shell.Controls.Add(heading, 0, 0);
            TableLayoutPanel body = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, RightToLeft = RightToLeft.No };
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); body.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 210)); shell.Controls.Add(body, 0, 1);
            Panel sidebar = new Panel { Dock = DockStyle.Fill, BackColor = card, Padding = new Padding(12), Margin = new Padding(14, 0, 0, 0), RightToLeft = RightToLeft.Yes };
            Label section = new Label { Text = "مساحة العمل", Dock = DockStyle.Top, Height = 45, ForeColor = Color.FromArgb(148, 165, 199), TextAlign = ContentAlignment.MiddleRight };
            FlowLayoutPanel menu = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 378, FlowDirection = FlowDirection.TopDown, WrapContents = false };
            string[] labels = { "◈  نظرة عامة", "#  القنوات والأقسام", "◆  الرتب والصلاحيات", "✦  إعادة التصميم", "✓  صلاحيات البوت", "≡  سجل العمليات", "⚙  الاتصال والإعدادات" };
            for (int i = 0; i < labels.Length; i++) {
                int index = i; Button button = new ActionButton(); StyleButton(button, labels[i], card); button.Width = 172; button.Height = 43; button.TextAlign = ContentAlignment.MiddleRight;
                button.Click += delegate { tabs.SelectedIndex = index; }; menu.Controls.Add(button); navigation.Add(button);
            }
            Panel sideBottom = new Panel { Dock = DockStyle.Bottom, Height = 140 };
            presence.Dock = DockStyle.Top; presence.Height = 65; presence.ForeColor = Color.FromArgb(151, 166, 195); presence.Text = "● اتصال البرنامج متوقف";
            Label shield = new Label { Text = "حماية القيادة مفعّلة\nOWNER / CO_OWNER\nالمعاينة تسبق أي حفظ", Dock = DockStyle.Bottom, Height = 68, ForeColor = Color.FromArgb(105, 219, 178), Font = new Font("Segoe UI", 9) };
            sideBottom.Controls.Add(presence); sideBottom.Controls.Add(shield); sidebar.Controls.Add(menu); sidebar.Controls.Add(section); sidebar.Controls.Add(sideBottom); body.Controls.Add(sidebar, 1, 0);
            TableLayoutPanel workspace = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, RightToLeft = RightToLeft.Yes };
            workspace.RowStyles.Add(new RowStyle(SizeType.Absolute, 83)); workspace.RowStyles.Add(new RowStyle(SizeType.Absolute, 30)); workspace.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); body.Controls.Add(workspace, 0, 0);
            Panel server = new Panel { Dock = DockStyle.Fill, BackColor = card, Padding = new Padding(14) };
            serverHeading.Text = "اختر سيرفرك وابدأ الاستكشاف"; serverHeading.Dock = DockStyle.Top; serverHeading.Height = 32; serverHeading.Font = new Font("Segoe UI", 16, FontStyle.Bold);
            serverDetails.Text = "أدخل بيانات الاتصال في الإعدادات، ثم حمّل القنوات والرتب الحالية"; serverDetails.Dock = DockStyle.Bottom; serverDetails.Height = 24; serverDetails.ForeColor = Color.FromArgb(151, 166, 195);
            StyleButton(refreshServer, "تحديث السيرفر", Color.FromArgb(88, 101, 242)); refreshServer.Dock = DockStyle.Left; refreshServer.Width = 145;
            refreshServer.Click += async delegate { await RunJob("inventory"); };
            server.Controls.Add(serverHeading); server.Controls.Add(serverDetails); server.Controls.Add(refreshServer); workspace.Controls.Add(server, 0, 0);
            status.Dock = DockStyle.Fill; status.Text = "جاهز — لا توجد أي تغييرات تلقائية"; status.ForeColor = Color.FromArgb(158, 184, 239); workspace.Controls.Add(status, 0, 1);
            tabs.Dock = DockStyle.Fill; workspace.Controls.Add(tabs, 0, 2);
            tabs.SelectionChanged += delegate {
                for (int i = 0; i < navigation.Count; i++) navigation[i].BackColor = tabs.SelectedIndex == i ? Color.FromArgb(68, 76, 164) : card;
            };
            tabs.AddPage(BuildOverview()); tabs.AddPage(BuildChannelPage()); tabs.AddPage(BuildRolePage()); tabs.AddPage(BuildRedesignPage()); tabs.AddPage(BuildPermissionPage());
            StyleReport(log); Panel logPage = Page(); logPage.Controls.Add(log); tabs.AddPage(logPage); tabs.AddPage(BuildSettingsPage()); tabs.SelectedIndex = 0;
            channelEditor.ReviewRequested += async delegate { await ReviewEditor(channelEditor); };
            roleEditor.ReviewRequested += async delegate { await ReviewEditor(roleEditor); };
            channelEditor.ApplyRequested += async delegate { await SaveEditor(channelEditor); };
            roleEditor.ApplyRequested += async delegate { await SaveEditor(roleEditor); };
            channelEditor.DraftChanged += delegate { InvalidateEdit(); }; roleEditor.DraftChanged += delegate { InvalidateEdit(); };
            Label footer = new Label { Text = "القراءة لا تغيّر السيرفر • المسودات محلية حتى التأكيد • لا طرد، لا حظر، لا حذف للسيرفر", Dock = DockStyle.Fill, ForeColor = Color.FromArgb(130, 150, 184), TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Segoe UI", 9) }; shell.Controls.Add(footer, 0, 2);
        }
        Panel Page() { return new Panel { Dock = DockStyle.Fill, BackColor = background, Padding = new Padding(0, 10, 0, 0) }; }
        Panel BuildOverview() {
            Panel page = Page(); TableLayoutPanel content = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1 };
            content.RowStyles.Add(new RowStyle(SizeType.Absolute, 108)); content.RowStyles.Add(new RowStyle(SizeType.Absolute, 215)); content.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); page.Controls.Add(content);
            TableLayoutPanel metrics = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 1 };
            Label[] counters = { categoryMetric, channelMetric, voiceMetric, roleMetric }; string[] names = { "الأقسام", "قنوات نصية", "قنوات صوتية", "الرتب" };
            for (int i = 0; i < 4; i++) {
                metrics.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25)); Panel tile = new Panel { Dock = DockStyle.Fill, BackColor = card, Padding = new Padding(14), Margin = new Padding(4) };
                Label title = new Label { Text = names[i], Dock = DockStyle.Top, Height = 23, ForeColor = Color.FromArgb(151, 166, 195) };
                counters[i].Text = "—"; counters[i].Dock = DockStyle.Fill; counters[i].Font = new Font("Segoe UI", 27, FontStyle.Bold); counters[i].ForeColor = Color.FromArgb(158, 149, 255); tile.Controls.Add(counters[i]); tile.Controls.Add(title); metrics.Controls.Add(tile, i, 0);
            }
            content.Controls.Add(metrics, 0, 0);
            Panel intro = new Panel { Dock = DockStyle.Fill, BackColor = card, Padding = new Padding(22), Margin = new Padding(4, 12, 4, 4) };
            Label copy = new Label { Text = "كل تفاصيل سيرفرك، في مكان واحد\n\nاستعرض الأقسام والغرف كما هي في Discord، وابحث بين الرتب.\nاختر أي عنصر لإعداد اسمه وصلاحياته، ثم راجع الفرق قبل الحفظ.", Dock = DockStyle.Fill, Font = new Font("Segoe UI", 13) };
            Button browse = new ActionButton(); StyleButton(browse, "استكشاف القنوات  ←", Color.FromArgb(88, 101, 242)); browse.Dock = DockStyle.Bottom; browse.Click += delegate { tabs.SelectedIndex = 1; }; intro.Controls.Add(copy); intro.Controls.Add(browse); content.Controls.Add(intro, 0, 1);
            Label notes = new Label { Text = "مساحة عمل آمنة\n\n• العناصر المحمية تظهر للعرض فقط.\n• إضافة قناة أو رتبة لا توزع صلاحيات على الأعضاء تلقائياً.\n• كل تعديل يحتاج معاينة وموافقة حفظ مستقلة.\n• إعادة التصميم الشاملة موجودة في قسم منفصل.", Dock = DockStyle.Fill, Padding = new Padding(20), ForeColor = Color.FromArgb(156, 173, 202), Font = new Font("Segoe UI", 11) }; content.Controls.Add(notes, 0, 2); return page;
        }
        Panel BuildChannelPage() {
            Panel page = Page(); SplitContainer split = new SplitContainer { Dock = DockStyle.Fill, SplitterWidth = 12, BackColor = background, RightToLeft = RightToLeft.No };
            split.Size = new Size(1050, 620); split.SplitterDistance = 380; split.Panel1MinSize = 245; split.Panel2MinSize = 420;
            Panel browser = new Panel { Dock = DockStyle.Fill, BackColor = card, Padding = new Padding(12), RightToLeft = RightToLeft.Yes };
            channelTree.Dock = DockStyle.Fill; channelTree.BackColor = card; channelTree.ForeColor = ink; channelTree.BorderStyle = BorderStyle.None; channelTree.ShowLines = false; channelTree.ItemHeight = 31; channelTree.HideSelection = false; channelTree.FullRowSelect = true; channelTree.Font = new Font("Segoe UI", 11);
            channelTree.AfterSelect += delegate { Dictionary<string, object> item = channelTree.SelectedNode.Tag as Dictionary<string, object>; if (item != null) { InvalidateEdit(); channelEditor.LoadEntity(item, inventoryData, false, 0); } };
            Panel search = new Panel { Dock = DockStyle.Top, Height = 65 }; Label title = new Label { Text = "القنوات الحالية • بحث بالاسم", Dock = DockStyle.Top, Height = 28 }; channelSearch.Dock = DockStyle.Bottom; StyleText(channelSearch); channelSearch.TextChanged += delegate { PopulateChannels(); }; search.Controls.Add(title); search.Controls.Add(channelSearch);
            FlowLayoutPanel add = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 82, FlowDirection = FlowDirection.RightToLeft, WrapContents = true };
            foreach (int type in new int[] { 4, 0, 2 }) {
                int captured = type; Button button = new ActionButton(); StyleButton(button, type == 4 ? "+ قسم" : type == 0 ? "+ نصية" : "+ صوتية", Color.FromArgb(50, 61, 86)); button.Size = new Size(105, 32);
                button.Click += delegate { if (inventoryData != null && !busy) { InvalidateEdit(); channelEditor.LoadEntity(null, inventoryData, true, captured); } }; add.Controls.Add(button);
            }
            browser.Controls.Add(channelTree); browser.Controls.Add(search); browser.Controls.Add(add); split.Panel1.Controls.Add(browser); split.Panel2.Controls.Add(channelEditor); page.Controls.Add(split); return page;
        }
        Panel BuildRolePage() {
            Panel page = Page(); SplitContainer split = new SplitContainer { Dock = DockStyle.Fill, SplitterWidth = 12, BackColor = background, RightToLeft = RightToLeft.No };
            split.Size = new Size(1050, 620); split.SplitterDistance = 390; split.Panel1MinSize = 245; split.Panel2MinSize = 420;
            Panel browser = new Panel { Dock = DockStyle.Fill, BackColor = card, Padding = new Padding(12), RightToLeft = RightToLeft.Yes };
            ConfigureGrid(roleTable); roleTable.Columns.Add("name", "اسم الرتبة"); roleTable.Columns.Add("position", "الترتيب"); roleTable.Columns.Add("lock", "الحالة"); roleTable.Columns[1].Width = 60; roleTable.Columns[2].Width = 85;
            roleTable.SelectionChanged += delegate { if (roleTable.CurrentRow != null) { Dictionary<string, object> item = roleTable.CurrentRow.Tag as Dictionary<string, object>; if (item != null) { InvalidateEdit(); roleEditor.LoadEntity(item, inventoryData, false, 0); } } };
            Panel search = new Panel { Dock = DockStyle.Top, Height = 65 }; Label title = new Label { Text = "الرتب الحالية • بحث بالاسم", Dock = DockStyle.Top, Height = 28 }; roleSearch.Dock = DockStyle.Bottom; StyleText(roleSearch); roleSearch.TextChanged += delegate { PopulateRoles(); }; search.Controls.Add(title); search.Controls.Add(roleSearch);
            Button add = new ActionButton(); StyleButton(add, "+ إضافة رتبة", Color.FromArgb(50, 61, 86)); add.Dock = DockStyle.Bottom; add.Click += delegate { if (inventoryData != null && !busy) { InvalidateEdit(); roleEditor.LoadEntity(null, inventoryData, true, 0); } };
            browser.Controls.Add(roleTable); browser.Controls.Add(search); browser.Controls.Add(add); split.Panel1.Controls.Add(browser); split.Panel2.Controls.Add(roleEditor); page.Controls.Add(split); return page;
        }
        Panel BuildRedesignPage() {
            Panel page = Page(); Panel actions = new Panel { Dock = DockStyle.Top, Height = 100, BackColor = card, Padding = new Padding(10) };
            FlowLayoutPanel buttons = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 48, FlowDirection = FlowDirection.RightToLeft };
            StyleButton(propose, "معاينة التصميم الشامل", Color.FromArgb(88, 101, 242)); StyleButton(rebuild, "تنفيذ إعادة البناء…", Color.FromArgb(155, 59, 75)); Button folder = new ActionButton(); StyleButton(folder, "مجلد التقارير", Color.FromArgb(50, 61, 86)); folder.Click += delegate { OpenReports(); }; buttons.Controls.AddRange(new Control[] { propose, rebuild, folder });
            reviewed.Text = "راجعت خطة الحذف والإنشاء — أريد إتاحة زر التأكيد"; reviewed.Dock = DockStyle.Bottom; reviewed.Height = 32; reviewed.ForeColor = Color.FromArgb(255, 213, 148); actions.Controls.Add(reviewed); actions.Controls.Add(buttons);
            StyleReport(preview); preview.Text = Newlines("إعادة تصميم شاملة\n\nهذا القسم منفصل عن تحرير عنصر واحد. أنشئ معاينة واقرأ قائمة الحذف والإنشاء والحماية بالكامل قبل التنفيذ.\n\nلتعديل غرفة أو رتبة موجودة فقط، استخدم القنوات أو الرتب من القائمة الجانبية."); page.Controls.Add(preview); page.Controls.Add(actions); return page;
        }
        Panel BuildPermissionPage() {
            Panel page = Page(); ConfigureGrid(permissionTable); permissionTable.Columns.Add("name", "الصلاحية"); permissionTable.Columns.Add("status", "حالة البوت");
            Panel top = new Panel { Dock = DockStyle.Top, Height = 95, BackColor = card, Padding = new Padding(12) };
            StyleButton(inspect, "فحص صلاحيات البوت", Color.FromArgb(88, 101, 242)); inspect.Dock = DockStyle.Right; inspect.Width = 190;
            Button authorize = new ActionButton(); StyleButton(authorize, "رابط تفويض Discord", Color.FromArgb(50, 61, 86)); authorize.Dock = DockStyle.Left; authorize.Width = 195; authorize.Click += async delegate { await OpenInvite(); };
            admin.Text = "طلب Administrator اختياري — يحتاج موافقتك داخل Discord"; admin.Dock = DockStyle.Bottom; admin.Height = 27; top.Controls.Add(admin); top.Controls.Add(inspect); top.Controls.Add(authorize); page.Controls.Add(permissionTable); page.Controls.Add(top); return page;
        }
        Panel BuildSettingsPage() {
            Panel page = Page(); Panel settings = new Panel { Dock = DockStyle.Top, Height = 220, Padding = new Padding(22), BackColor = card };
            TableLayoutPanel fields = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 4 };
            fields.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150)); fields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            fields.Controls.Add(new Label { Text = "توكن البوت", Dock = DockStyle.Fill }, 0, 0); token.Dock = DockStyle.Fill; token.UseSystemPasswordChar = true; StyleText(token); fields.Controls.Add(token, 1, 0);
            fields.Controls.Add(new Label { Text = "رقم السيرفر", Dock = DockStyle.Fill }, 0, 1); guild.Dock = DockStyle.Fill; StyleText(guild); fields.Controls.Add(guild, 1, 1);
            remember.Text = "حفظ التوكن بتشفير ويندوز لهذا المستخدم"; remember.Dock = DockStyle.Fill; fields.Controls.Add(remember, 1, 2);
            FlowLayoutPanel actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft };
            Button save = new ActionButton(); StyleButton(save, "حفظ الاتصال", Color.FromArgb(50, 61, 86)); save.Click += delegate { SaveSettings(); };
            StyleButton(online, "تشغيل البوت Online", Color.FromArgb(32, 130, 105)); StyleButton(offline, "إيقاف الاتصال", Color.FromArgb(70, 76, 94)); actions.Controls.AddRange(new Control[] { save, online, offline }); fields.Controls.Add(actions, 1, 3); settings.Controls.Add(fields);
            TextBox guide = new TextBox(); StyleReport(guide); guide.Text = Newlines("ابدأ من هنا\n\n1. أدخل التوكن ورقم السيرفر ثم احفظ الاتصال إن رغبت.\n2. اضغط تحديث السيرفر لعرض الغرف والرتب الحقيقية.\n3. اختر عنصراً من القنوات أو الرتب، وعدّل مسودتك ثم راجع الفرق قبل الحفظ.\n4. القفل يعني أن العنصر محمي أو أن البوت لا يستطيع إدارته.\n5. إبقاء البوت Online اختياري ويتطلب بقاء الجهاز والبرنامج يعملان.\n6. إعادة التصميم الشاملة منفصلة وتتطلب تأكيد الحذف ورقم السيرفر.\n\nالتوكن لا يظهر في السجل. نسخة الإعدادات وتوزيع الرتب لا تحفظ رسائل القنوات أو مرفقاتها."); page.Controls.Add(guide); page.Controls.Add(settings); return page;
        }
        void OpenReports() { try { System.IO.Directory.CreateDirectory(reports); System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", Quote(reports)) { UseShellExecute = true }); } catch (Exception e) { AppendLog(e.Message); } }
        internal static void ConfigureGrid(DataGridView grid) {
            grid.Dock = DockStyle.Fill; grid.BackgroundColor = Color.FromArgb(25, 31, 48); grid.BorderStyle = BorderStyle.None; grid.EnableHeadersVisualStyles = false; grid.RowHeadersVisible = false;
            grid.AllowUserToAddRows = false; grid.AllowUserToDeleteRows = false; grid.AllowUserToResizeRows = false; grid.ReadOnly = true; grid.MultiSelect = false; grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill; grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(38, 47, 68); grid.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(180, 193, 220); grid.ColumnHeadersHeight = 36;
            grid.DefaultCellStyle.BackColor = Color.FromArgb(25, 31, 48); grid.DefaultCellStyle.ForeColor = Color.FromArgb(230, 235, 247); grid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(65, 71, 133); grid.DefaultCellStyle.SelectionForeColor = Color.White;
            grid.GridColor = Color.FromArgb(40, 49, 69); grid.RowTemplate.Height = 34; grid.RightToLeft = RightToLeft.Yes;
        }
        void RenderInventory(Dictionary<string, object> data) {
            if (Str(data, "guildId") != guild.Text.Trim() && !selfTest) throw new Exception("بيانات السيرفر لا تطابق الاتصال الحالي");
            inventoryData = data; serverHeading.Text = Str(data, "guildName"); serverDetails.Text = "SERVER ID  " + Str(data, "guildId") + "  •  آخر قراءة " + DateTime.Now.ToString("HH:mm:ss");
            List<Dictionary<string, object>> channels = Items(Value(data, "channels")).Select(Map).ToList();
            categoryMetric.Text = channels.Count(x => Num(x, "type") == 4).ToString(); channelMetric.Text = channels.Count(x => Num(x, "type") == 0 || Num(x, "type") == 5).ToString(); voiceMetric.Text = channels.Count(x => Num(x, "type") == 2 || Num(x, "type") == 13).ToString(); roleMetric.Text = Items(Value(data, "roles")).Count().ToString();
            PopulateChannels(); PopulateRoles();
        }
        void PopulateChannels() {
            channelTree.BeginUpdate(); channelTree.Nodes.Clear();
            if (inventoryData != null) {
                List<Dictionary<string, object>> channels = Items(Value(inventoryData, "channels")).Select(Map).ToList(); string query = channelSearch.Text.Trim();
                Func<Dictionary<string, object>, bool> match = c => Str(c, "name").IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0;
                foreach (Dictionary<string, object> category in channels.Where(c => Num(c, "type") == 4)) {
                    List<Dictionary<string, object>> children = channels.Where(c => Str(c, "parent_id") == Str(category, "id") && (match(c) || match(category))).ToList();
                    if (!match(category) && children.Count == 0) continue;
                    TreeNode node = new TreeNode("▣  " + Str(category, "name") + "  · " + children.Count + (Value(category, "readOnlyReason") != null ? "  [محمي]" : "")) { Tag = category, ForeColor = Color.FromArgb(166, 158, 255) };
                    foreach (Dictionary<string, object> child in children) node.Nodes.Add(ChannelNode(child)); channelTree.Nodes.Add(node);
                }
                foreach (Dictionary<string, object> channel in channels.Where(c => Num(c, "type") != 4 && !channels.Any(p => Str(p, "id") == Str(c, "parent_id")) && match(c))) channelTree.Nodes.Add(ChannelNode(channel));
                channelTree.ExpandAll();
            }
            channelTree.EndUpdate();
        }
        TreeNode ChannelNode(Dictionary<string, object> c) { return new TreeNode((Num(c, "type") == 2 ? "♪  " : "#  ") + Str(c, "name") + (Value(c, "readOnlyReason") != null ? "  [محمي]" : "")) { Tag = c }; }
        void PopulateRoles() {
            roleTable.Rows.Clear(); if (inventoryData == null) return;
            foreach (Dictionary<string, object> role in Items(Value(inventoryData, "roles")).Select(Map)) {
                if (Str(role, "name").IndexOf(roleSearch.Text.Trim(), StringComparison.OrdinalIgnoreCase) < 0) continue;
                int index = roleTable.Rows.Add(Str(role, "name"), Num(role, "position"), Value(role, "readOnlyReason") == null ? "قابل للتعديل" : "محمي"); roleTable.Rows[index].Tag = role;
                int color = Num(role, "color"); if (color != 0) roleTable.Rows[index].Cells[0].Style.ForeColor = Color.FromArgb((color >> 16) & 255, (color >> 8) & 255, color & 255);
            }
            roleTable.ClearSelection(); roleTable.CurrentCell = null;
        }
        void InvalidateEdit() { pendingEditHash = null; pendingEditor = null; channelEditor.AllowApply(false); roleEditor.AllowApply(false); }
        async Task ReviewEditor(EntityEditor editor) {
            if (busy || inventoryData == null) return;
            try { pendingEditRequest = editor.BuildRequest(); pendingEditor = editor; pendingEditHash = null; await RunJob("edit-preview"); }
            catch (Exception error) { MessageBox.Show(this, error.Message, "مراجعة المسودة"); }
        }
        async Task SaveEditor(EntityEditor editor) {
            if (busy || pendingEditor != editor || pendingEditHash == null) return;
            if (MessageBox.Show(this, "هل تريد حفظ التغييرات المعروضة في المعاينة على السيرفر المحدد؟\n\nسيُعدّل عنصر واحد فقط. لا تتضمن هذه العملية أي حذف.", "تأكيد الحفظ في Discord", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            editApplied = false; await RunJob("edit-apply");
            InvalidateEdit(); await RunJob("inventory");
        }
        void RefreshEditorControls() { refreshServer.Enabled = !busy; channelTree.Enabled = !busy; roleTable.Enabled = !busy; channelEditor.Enabled = !busy; roleEditor.Enabled = !busy; channelEditor.SetBusy(busy); roleEditor.SetBusy(busy); }
        void ResetInventory() { if (channelTree == null) return; inventoryData = null; channelTree.Nodes.Clear(); roleTable.Rows.Clear(); permissionTable.Rows.Clear(); serverHeading.Text = "حمّل السيرفر لعرض محتوياته"; channelEditor.Clear(); roleEditor.Clear(); InvalidateEdit(); }
        internal void CaptureEditorPreviews(string directory) {
            if (inventoryData == null) return;
            foreach (int page in new int[] { 1, 2 }) {
                tabs.SelectedIndex = page;
                string key = page == 1 ? "channels" : "roles";
                Dictionary<string, object> item = Items(Value(inventoryData, key)).Select(Map).FirstOrDefault(x => Value(x, "readOnlyReason") == null && (page == 2 || Num(x, "type") == 0));
                if (item != null) (page == 1 ? channelEditor : roleEditor).LoadEntity(item, inventoryData, false, 0);
                PerformLayout();
                using (Bitmap bitmap = new Bitmap(Width, Height)) { DrawToBitmap(bitmap, new Rectangle(0, 0, bitmap.Width, bitmap.Height)); bitmap.Save(System.IO.Path.Combine(directory, page == 1 ? "desktop-channels.png" : "desktop-roles.png"), System.Drawing.Imaging.ImageFormat.Png); }
            }
            tabs.SelectedIndex = 0;
        }
    }

    sealed class PageDeck : Panel {
        readonly List<Control> pages = new List<Control>(); int selected = -1;
        public event EventHandler SelectionChanged;
        public int SelectedIndex { get { return selected; } set { if (value < 0 || value >= pages.Count) return; selected = value; for (int i = 0; i < pages.Count; i++) pages[i].Visible = i == value; pages[value].BringToFront(); if (SelectionChanged != null) SelectionChanged(this, EventArgs.Empty); } }
        public void AddPage(Control page) { page.Dock = DockStyle.Fill; pages.Add(page); Controls.Add(page); page.Visible = pages.Count == 1; }
    }

    sealed class Choice {
        public string ID, Text; public Dictionary<string, object> Item;
        public override string ToString() { return Text; }
    }

    sealed class EntityEditor : UserControl {
        static readonly Dictionary<string, string> permissionLabels = new Dictionary<string, string> {
            { "Administrator", "مدير كامل" }, { "ManageChannels", "إدارة القنوات" }, { "ManageRoles", "إدارة الرتب" }, { "ManageGuild", "إدارة السيرفر" },
            { "ViewChannel", "مشاهدة القناة" }, { "SendMessages", "إرسال الرسائل" }, { "ReadMessageHistory", "قراءة سجل الرسائل" }, { "Connect", "الاتصال بالصوت" }, { "Speak", "التحدث" },
            { "ManageMessages", "إدارة الرسائل" }, { "ModerateMembers", "تقييد الأعضاء مؤقتاً" }, { "KickMembers", "طرد الأعضاء" }, { "BanMembers", "حظر الأعضاء" },
            { "ViewAuditLog", "عرض سجل التدقيق" }, { "AddReactions", "إضافة تفاعلات" }, { "EmbedLinks", "تضمين الروابط" }, { "AttachFiles", "إرفاق الملفات" },
            { "MoveMembers", "نقل الأعضاء صوتياً" }, { "ManageNicknames", "إدارة الألقاب" }, { "ManageEvents", "إدارة الفعاليات" }, { "ManageThreads", "إدارة المواضيع" },
            { "CreatePublicThreads", "إنشاء مواضيع عامة" }, { "CreatePrivateThreads", "إنشاء مواضيع خاصة" }, { "SendMessagesInThreads", "الرسائل داخل المواضيع" }
        };
        internal static string PermissionLabel(string key) { string label; return permissionLabels.TryGetValue(key, out label) ? label : key; }
        readonly bool roleMode; readonly TextBox name = new TextBox(), topic = new TextBox(), color = new TextBox(), summary = new TextBox();
        readonly ComboBox parent = new ComboBox(), overwriteRole = new ComboBox();
        readonly NumericUpDown number = new NumericUpDown(); readonly Label numberCaption = new Label(); readonly CheckBox hoist = new CheckBox(), mentionable = new CheckBox();
        readonly DataGridView flags = new DataGridView(); readonly Label title = new Label(), hint = new Label();
        readonly Button review = new ActionButton(), apply = new ActionButton();
        readonly Panel optional = new Panel();
        Dictionary<string, object> entity, inventory; bool creating, loading, locked = true, busy, canApply; int channelType;
        readonly Dictionary<string, Dictionary<string, string>> overwriteDraft = new Dictionary<string, Dictionary<string, string>>();
        public event EventHandler ReviewRequested, ApplyRequested, DraftChanged;
        internal bool ApplyEnabled { get { return apply.Enabled; } }
        internal void TestRename(string value) { name.Text = value; }
        public EntityEditor(bool role) {
            roleMode = role; Dock = DockStyle.Fill; BackColor = Color.FromArgb(25, 31, 48); ForeColor = Color.FromArgb(230, 235, 247); Padding = new Padding(16); RightToLeft = RightToLeft.Yes;
            TableLayoutPanel layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 7, ColumnCount = 1 };
            foreach (int height in new int[] { 55, 68, 118, 35 }) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 90)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48)); Controls.Add(layout);
            title.Text = role ? "محرّر الرتبة" : "محرّر القناة"; title.Dock = DockStyle.Top; title.Height = 27; title.Font = new Font("Segoe UI", 14, FontStyle.Bold); hint.Dock = DockStyle.Bottom; hint.Height = 25; hint.ForeColor = Color.FromArgb(151, 166, 195); hint.Text = "اختر عنصراً من القائمة لعرض التفاصيل";
            Panel heading = new Panel { Dock = DockStyle.Fill }; heading.Controls.Add(title); heading.Controls.Add(hint); layout.Controls.Add(heading, 0, 0);
            Panel identity = new Panel { Dock = DockStyle.Fill }; Label nameLabel = new Label { Text = "الاسم", Dock = DockStyle.Top, Height = 24 }; name.Dock = DockStyle.Bottom; PaintInput(name); identity.Controls.Add(nameLabel); identity.Controls.Add(name); layout.Controls.Add(identity, 0, 1);
            optional.Dock = DockStyle.Fill;
            if (role) {
                Label label = new Label { Text = "اللون بصيغة HEX", Dock = DockStyle.Top, Height = 24 }; color.Dock = DockStyle.Top; PaintInput(color); color.RightToLeft = RightToLeft.No;
                Button choose = new ActionButton { Text = "اختيار اللون", Dock = DockStyle.Top, Height = 28, BackColor = Color.FromArgb(50, 61, 86), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
                choose.Click += delegate { using (ColorDialog dialog = new ColorDialog()) if (dialog.ShowDialog() == DialogResult.OK) color.Text = "#" + (dialog.Color.ToArgb() & 0xffffff).ToString("X6"); };
                FlowLayoutPanel options = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 32, FlowDirection = FlowDirection.RightToLeft }; hoist.Text = "عرض منفصل"; hoist.Width = 145; mentionable.Text = "قابلة للمنشن"; mentionable.Width = 145; options.Controls.Add(hoist); options.Controls.Add(mentionable);
                optional.Controls.Add(choose); optional.Controls.Add(color); optional.Controls.Add(label); optional.Controls.Add(options);
            } else {
                TableLayoutPanel fields = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 3 };
                fields.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 100)); fields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
                fields.RowStyles.Add(new RowStyle(SizeType.Absolute, 34)); fields.RowStyles.Add(new RowStyle(SizeType.Absolute, 46)); fields.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
                parent.DropDownStyle = ComboBoxStyle.DropDownList; parent.Dock = DockStyle.Fill;
                parent.FlatStyle = FlatStyle.Flat; parent.BackColor = Color.FromArgb(38, 47, 68); parent.ForeColor = ForeColor;
                topic.Multiline = true; topic.Dock = DockStyle.Fill; PaintInput(topic);
                number.Dock = DockStyle.Fill; number.Maximum = 21600; number.BackColor = Color.FromArgb(15, 19, 31); number.ForeColor = ForeColor;
                fields.Controls.Add(new Label { Text = "القسم", Dock = DockStyle.Fill }, 0, 0); fields.Controls.Add(parent, 1, 0);
                fields.Controls.Add(new Label { Text = "الوصف", Dock = DockStyle.Fill }, 0, 1); fields.Controls.Add(topic, 1, 1);
                numberCaption.Dock = DockStyle.Fill; fields.Controls.Add(numberCaption, 0, 2); fields.Controls.Add(number, 1, 2); optional.Controls.Add(fields);
            }
            layout.Controls.Add(optional, 0, 2);
            if (role) layout.Controls.Add(new Label { Text = "صلاحيات الرتبة • التغييرات تُراجع قبل الحفظ", Dock = DockStyle.Fill, ForeColor = Color.FromArgb(151, 166, 195) }, 0, 3);
            else { overwriteRole.Dock = DockStyle.Fill; overwriteRole.DropDownStyle = ComboBoxStyle.DropDownList; overwriteRole.FlatStyle = FlatStyle.Flat; overwriteRole.BackColor = Color.FromArgb(38, 47, 68); overwriteRole.ForeColor = ForeColor; layout.Controls.Add(overwriteRole, 0, 3); overwriteRole.SelectedIndexChanged += delegate { LoadChannelFlags(); }; }
            MainForm.ConfigureGrid(flags); flags.ReadOnly = false; flags.Columns.Add("name", "الصلاحية"); flags.Columns[0].ReadOnly = true;
            if (role) flags.Columns.Add(new DataGridViewCheckBoxColumn { Name = "value", HeaderText = "مفعّلة", Width = 75 });
            else flags.Columns.Add(new DataGridViewComboBoxColumn { Name = "value", HeaderText = "إذن القناة", DataSource = new string[] { "وراثة", "سماح", "منع" }, FlatStyle = FlatStyle.Flat, DisplayStyleForCurrentCellOnly = true });
            flags.Columns[1].FillWeight = 40; flags.CurrentCellDirtyStateChanged += delegate { if (flags.IsCurrentCellDirty) flags.CommitEdit(DataGridViewDataErrorContexts.Commit); };
            flags.CellValueChanged += delegate(object sender, DataGridViewCellEventArgs e) { if (loading || e.RowIndex < 0) return; if (!roleMode) StoreChannelDraft(e.RowIndex); Changed(); };
            flags.DataError += delegate(object sender, DataGridViewDataErrorEventArgs e) { e.ThrowException = false; }; layout.Controls.Add(flags, 0, 4);
            summary.Multiline = true; summary.ReadOnly = true; summary.ScrollBars = ScrollBars.Vertical; summary.Dock = DockStyle.Fill; PaintInput(summary); summary.Text = "المسودة محلية. راجع الفرق قبل الحفظ."; layout.Controls.Add(summary, 0, 5);
            FlowLayoutPanel actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
            review.Text = "مراجعة التعديل"; apply.Text = "حفظ في Discord";
            foreach (Button button in new Button[] { review, apply }) { button.Size = new Size(160, 38); button.FlatStyle = FlatStyle.Flat; button.FlatAppearance.BorderSize = 0; button.ForeColor = Color.White; button.BackColor = button == review ? Color.FromArgb(88, 101, 242) : Color.FromArgb(32, 130, 105); actions.Controls.Add(button); }
            review.Click += delegate { if (ReviewRequested != null) ReviewRequested(this, EventArgs.Empty); }; apply.Click += delegate { if (ApplyRequested != null) ApplyRequested(this, EventArgs.Empty); }; layout.Controls.Add(actions, 0, 6);
            name.TextChanged += delegate { Changed(); }; topic.TextChanged += delegate { Changed(); }; color.TextChanged += delegate { Changed(); }; parent.SelectedIndexChanged += delegate { if (creating && !loading) LoadChannelFlags(); Changed(); }; number.ValueChanged += delegate { Changed(); }; hoist.CheckedChanged += delegate { Changed(); }; mentionable.CheckedChanged += delegate { Changed(); }; Clear();
        }
        void PaintInput(TextBox box) { box.BackColor = Color.FromArgb(15, 19, 31); box.ForeColor = ForeColor; box.BorderStyle = BorderStyle.FixedSingle; box.Font = new Font("Segoe UI", 10); }
        void Changed() { if (loading || Disposing || IsDisposed) return; canApply = false; UpdateButtons(); summary.Text = "مسودة غير محفوظة — اضغط مراجعة التعديل لعرض الفرق."; if (DraftChanged != null) DraftChanged(this, EventArgs.Empty); }
        public void Clear() { loading = true; entity = null; inventory = null; name.Text = ""; topic.Text = ""; flags.Rows.Clear(); hint.Text = "حمّل السيرفر واختر عنصراً"; locked = true; loading = false; UpdateButtons(); }
        public void LoadEntity(Dictionary<string, object> item, Dictionary<string, object> server, bool create, int type) {
            loading = true; entity = item; inventory = server; creating = create; channelType = item == null ? type : MainForm.Num(item, "type"); canApply = false; overwriteDraft.Clear();
            locked = item != null && MainForm.Value(item, "readOnlyReason") != null;
            title.Text = create ? (roleMode ? "رتبة جديدة" : type == 4 ? "قسم جديد" : type == 2 ? "قناة صوتية جديدة" : "قناة نصية جديدة") : MainForm.Str(item, "name");
            hint.Text = locked ? "محمي • " + MainForm.Str(item, "readOnlyReason") : create ? "عنصر جديد • لا يُنشأ قبل التأكيد" : "ID  " + MainForm.Str(item, "id");
            hint.ForeColor = locked ? Color.FromArgb(255, 196, 127) : Color.FromArgb(151, 166, 195);
            name.Text = item == null ? "" : MainForm.Str(item, "name"); name.ReadOnly = locked;
            flags.Rows.Clear();
            if (roleMode) {
                color.Text = "#" + (item == null ? 0x5865f2 : MainForm.Num(item, "color")).ToString("X6"); hoist.Checked = item != null && MainForm.Flag(item, "hoist"); mentionable.Checked = item != null && MainForm.Flag(item, "mentionable");
                foreach (Dictionary<string, object> permission in MainForm.Items(MainForm.Value(item ?? server, item == null ? "permissions" : "flags")).Select(MainForm.Map)) {
                    bool granted = item != null && MainForm.Flag(permission, "granted"); int index = flags.Rows.Add(PermissionLabel(MainForm.Str(permission, "name")), granted); flags.Rows[index].Tag = permission; flags.Rows[index].Cells[1].ReadOnly = locked || (!granted && !MainForm.Flag(permission, item == null ? "granted" : "canGrant"));
                }
                optional.Enabled = !locked;
            } else {
                parent.Items.Clear(); parent.Items.Add(new Choice { ID = "", Text = "بدون قسم" });
                foreach (Dictionary<string, object> category in MainForm.Items(MainForm.Value(server, "channels")).Select(MainForm.Map).Where(c => MainForm.Num(c, "type") == 4)) parent.Items.Add(new Choice { ID = MainForm.Str(category, "id"), Text = MainForm.Str(category, "name") });
                parent.SelectedIndex = 0; for (int i = 0; i < parent.Items.Count; i++) if (((Choice)parent.Items[i]).ID == (item == null ? "" : MainForm.Str(item, "parent_id"))) parent.SelectedIndex = i;
                parent.Enabled = !locked && channelType != 4; topic.Text = item == null ? "" : MainForm.Str(item, "topic"); topic.ReadOnly = locked || channelType != 0;
                number.Maximum = channelType == 2 ? 99 : 21600; number.Value = item == null ? 0 : Math.Min(number.Maximum, MainForm.Num(item, channelType == 2 ? "user_limit" : "rate_limit_per_user")); number.Enabled = !locked && channelType != 4;
                numberCaption.Text = channelType == 2 ? "حد الأعضاء" : "تهدئة / ثانية";
                number.AccessibleDescription = channelType == 2 ? "حد الأعضاء؛ صفر يعني بلا حد" : "Slowmode بالثواني";
                overwriteRole.Items.Clear(); foreach (Dictionary<string, object> role in MainForm.Items(MainForm.Value(server, "roles")).Select(MainForm.Map)) overwriteRole.Items.Add(new Choice { ID = MainForm.Str(role, "id"), Text = "أذونات: " + MainForm.Str(role, "name"), Item = role });
                if (overwriteRole.Items.Count > 0) overwriteRole.SelectedIndex = overwriteRole.Items.Count - 1;
            }
            summary.Text = locked ? "هذا العنصر متاح للعرض فقط. لا توجد عملية حفظ له." : "المسودة محلية — راجع التعديل قبل الحفظ."; loading = false; if (!roleMode) LoadChannelFlags(); UpdateButtons();
        }
        void LoadChannelFlags() {
            if (roleMode || inventory == null || overwriteRole.SelectedItem == null) return;
            loading = true; flags.Rows.Clear(); Choice role = (Choice)overwriteRole.SelectedItem;
            Dictionary<string, object> source = entity;
            if (source == null && parent.SelectedItem != null) source = MainForm.Items(MainForm.Value(inventory, "channels")).Select(MainForm.Map).FirstOrDefault(c => MainForm.Str(c, "id") == ((Choice)parent.SelectedItem).ID);
            Dictionary<string, object> overwrite = MainForm.Items(MainForm.Value(source, "overwrites")).Select(MainForm.Map).FirstOrDefault(w => MainForm.Str(w, "id") == role.ID && MainForm.Num(w, "type") == 0);
            foreach (object value in MainForm.Items(MainForm.Value(inventory, "channelPermissionNames"))) {
                string permission = Convert.ToString(value), state = "inherit";
                if (overwrite != null) { Dictionary<string, object> flag = MainForm.Items(MainForm.Value(overwrite, "flags")).Select(MainForm.Map).FirstOrDefault(p => MainForm.Str(p, "name") == permission); if (flag != null) state = MainForm.Str(flag, "state"); }
                Dictionary<string, string> draft; if (overwriteDraft.TryGetValue(role.ID, out draft) && draft.ContainsKey(permission)) state = draft[permission];
                int index = flags.Rows.Add(PermissionLabel(permission), DisplayState(state)); flags.Rows[index].Tag = permission;
            }
            bool protectedRole = MainForm.Value(role.Item, "readOnlyReason") != null && MainForm.Str(role.Item, "id") != MainForm.Str(inventory, "guildId");
            flags.ReadOnly = locked || protectedRole; loading = false;
        }
        static string DisplayState(string state) { return state == "allow" ? "سماح" : state == "deny" ? "منع" : "وراثة"; }
        void StoreChannelDraft(int row) {
            if (overwriteRole.SelectedItem == null) return; Choice role = (Choice)overwriteRole.SelectedItem;
            Dictionary<string, string> draft; if (!overwriteDraft.TryGetValue(role.ID, out draft)) { draft = new Dictionary<string, string>(); overwriteDraft[role.ID] = draft; }
            string state = Convert.ToString(flags.Rows[row].Cells[1].Value); draft[Convert.ToString(flags.Rows[row].Tag)] = state == "سماح" ? "allow" : state == "منع" ? "deny" : "inherit";
        }
        public Dictionary<string, object> BuildRequest() {
            if (locked || inventory == null) throw new Exception("اختر عنصراً قابلاً للتعديل أولاً");
            flags.EndEdit(); Dictionary<string, object> values = new Dictionary<string, object>();
            if (creating || name.Text.Trim() != MainForm.Str(entity, "name")) values["name"] = name.Text.Trim();
            Dictionary<string, object> result = new Dictionary<string, object> { { "kind", roleMode ? "role" : "channel" }, { "action", creating ? "create" : "update" }, { "values", values } };
            if (!creating) { result["id"] = MainForm.Str(entity, "id"); result["revision"] = MainForm.Str(entity, "revision"); }
            if (roleMode) {
                int parsed; if (!Int32.TryParse(color.Text.Trim().TrimStart('#'), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out parsed) || parsed < 0 || parsed > 0xffffff) throw new Exception("اكتب اللون مثل #5865F2");
                if (creating || parsed != MainForm.Num(entity, "color")) values["color"] = parsed;
                if (creating || hoist.Checked != MainForm.Flag(entity, "hoist")) values["hoist"] = hoist.Checked;
                if (creating || mentionable.Checked != MainForm.Flag(entity, "mentionable")) values["mentionable"] = mentionable.Checked;
                Dictionary<string, object> changes = new Dictionary<string, object>();
                foreach (DataGridViewRow row in flags.Rows) { Dictionary<string, object> permission = MainForm.Map(row.Tag); bool current = Convert.ToBoolean(row.Cells[1].Value); if (creating ? current : current != MainForm.Flag(permission, "granted")) changes[MainForm.Str(permission, "name")] = current; } result["permissionChanges"] = changes;
            } else {
                if (creating) values["type"] = channelType;
                string parentID = parent.SelectedItem == null ? "" : ((Choice)parent.SelectedItem).ID;
                if (channelType != 4 && (creating || parentID != MainForm.Str(entity, "parent_id"))) values["parent_id"] = parentID == "" ? null : parentID;
                if (channelType == 0) { if (creating || topic.Text != MainForm.Str(entity, "topic")) values["topic"] = topic.Text; if (creating || (int)number.Value != MainForm.Num(entity, "rate_limit_per_user")) values["rate_limit_per_user"] = (int)number.Value; }
                if (channelType == 2 && (creating || (int)number.Value != MainForm.Num(entity, "user_limit"))) values["user_limit"] = (int)number.Value;
                result["overwriteChanges"] = overwriteDraft.Select(pair => new Dictionary<string, object> { { "roleId", pair.Key }, { "permissions", pair.Value } }).ToArray();
            }
            return result;
        }
        public void ShowReview(string text) { summary.Text = text.Replace("\r\n", "\n").Replace("\n", Environment.NewLine); }
        public void AllowApply(bool value) { canApply = value; UpdateButtons(); }
        public void SetBusy(bool value) { busy = value; UpdateButtons(); }
        void UpdateButtons() { if (Disposing || IsDisposed) return; review.Enabled = !busy && !locked && inventory != null; apply.Enabled = review.Enabled && canApply; }
    }
}
