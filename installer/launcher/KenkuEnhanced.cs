// KenkuEnhanced.exe – what the Start menu and desktop shortcuts start.
//
// A tiny Windows program with no window of its own. It runs
//   node\node.exe helper\launch.js [arguments]
// without a black console window. launch.js starts the helper in the background
// (if it isn't running yet) and opens the small KenkuEnhanced window.
// If that goes wrong, it shows launch.js's explanation in a message box.
//
// Built by .github/workflows/release.yml with the C# compiler that comes with
// Windows (.NET Framework 4):
//   csc /target:winexe /win32icon:KenkuEnhanced.ico /out:KenkuEnhanced.exe KenkuEnhanced.cs

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("KenkuEnhanced")]
[assembly: AssemblyProduct("KenkuEnhanced")]
[assembly: AssemblyDescription("Starts the KenkuEnhanced helper and opens its window")]

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(dir, "node", "node.exe");
        if (!File.Exists(node)) node = "node.exe"; // a copy without bundled Node.js: use the installed one
        string script = Path.Combine(dir, "helper", "launch.js");

        var line = new StringBuilder(Quote(script));
        foreach (string a in args) line.Append(' ').Append(Quote(a));

        var psi = new ProcessStartInfo(node, line.ToString());
        psi.WorkingDirectory = dir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardError = true;
        psi.RedirectStandardOutput = true;

        try
        {
            using (Process p = Process.Start(psi))
            {
                // Read its messages as they come. Wait with a time limit, so a program
                // it started in the background can never keep this one waiting.
                var errors = new StringBuilder();
                p.OutputDataReceived += delegate { };
                p.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                    if (e.Data != null) lock (errors) errors.AppendLine(e.Data);
                };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(120000)) return 0; // still going: leave it be
                System.Threading.Thread.Sleep(200); // the last lines
                string err;
                lock (errors) err = errors.ToString();
                if (p.ExitCode != 0)
                {
                    Show((err.Trim().Length > 0 ? err.Trim() : "KenkuEnhanced couldn't start.") +
                         "\n\nYou can also start \"Start KenkuEnhanced.bat --console\" in the KenkuEnhanced folder to see what happens.");
                }
                return p.ExitCode;
            }
        }
        catch (Exception e)
        {
            Show("KenkuEnhanced couldn't start Node.js (" + node + "):\n" + e.Message +
                 "\n\nReinstalling KenkuEnhanced from the Releases page fixes a missing Node.js.");
            return 1;
        }
    }

    static void Show(string text)
    {
        MessageBox.Show(text, "KenkuEnhanced", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    // Quote one argument the way Windows programs read their command line
    static string Quote(string s)
    {
        if (s.Length > 0 && s.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return s;
        var b = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in s)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') b.Append('\\', slashes * 2 + 1);
            else b.Append('\\', slashes);
            slashes = 0;
            b.Append(c);
        }
        b.Append('\\', slashes * 2).Append('"');
        return b.ToString();
    }
}
