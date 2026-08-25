using System.Drawing;
using System.Windows.Forms;

namespace NexioStock.Authenticator;

internal sealed class MainForm : Form
{
    private readonly AuthenticatorState _state;
    private readonly Label _shopNameLabel;
    private readonly Label _shopCodeLabel;
    private readonly Label _accessKeyLabel;
    private readonly Label _countdownLabel;
    private readonly Label _versionLabel;
    private readonly System.Windows.Forms.Timer _timer;

    public MainForm()
    {
        _state = AuthenticatorState.LoadOrDefault();

        Text = "Nexio Stock Authenticator";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(420, 280);
        BackColor = Color.FromArgb(247, 248, 250);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(20),
            ColumnCount = 1,
            RowCount = 6,
        };

        _shopNameLabel = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI", 16, FontStyle.Bold),
            Text = _state.ShopName,
        };
        _shopCodeLabel = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI", 10, FontStyle.Regular),
            ForeColor = Color.FromArgb(88, 96, 105),
            Text = $"Shop Code: {_state.ShopCode}",
        };
        _accessKeyLabel = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI", 32, FontStyle.Bold),
            Text = _state.IsActivated ? "------" : "Activate App",
        };
        _countdownLabel = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI", 11, FontStyle.Regular),
            ForeColor = Color.FromArgb(88, 96, 105),
            Text = _state.IsActivated ? "Refreshing..." : "Activation required",
        };
        _versionLabel = new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI", 9, FontStyle.Regular),
            ForeColor = Color.FromArgb(120, 127, 136),
            Text = _state.IsActivated ? $"Secret v{_state.SecretVersion}" : "No activation present",
        };

        var activateButton = new Button
        {
            Text = "Activate / Update",
            AutoSize = true,
            Height = 36,
            Padding = new Padding(12, 6, 12, 6),
        };
        activateButton.Click += (_, _) => ShowActivationDialog();

        layout.Controls.Add(_shopNameLabel);
        layout.Controls.Add(_shopCodeLabel);
        layout.Controls.Add(_accessKeyLabel);
        layout.Controls.Add(_countdownLabel);
        layout.Controls.Add(_versionLabel);
        layout.Controls.Add(activateButton);
        Controls.Add(layout);

        _timer = new System.Windows.Forms.Timer { Interval = 1000 };
        _timer.Tick += (_, _) => RefreshCode();
        _timer.Start();

        RefreshCode();
    }

    private void ShowActivationDialog()
    {
        using var dialog = new ActivationDialog(_state);
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _shopNameLabel.Text = _state.ShopName;
            _shopCodeLabel.Text = $"Shop Code: {_state.ShopCode}";
            _versionLabel.Text = $"Secret v{_state.SecretVersion}";
            RefreshCode();
        }
    }

    private void RefreshCode()
    {
        if (!_state.IsActivated)
        {
            _accessKeyLabel.Text = "Activate App";
            _countdownLabel.Text = "Paste a one-time activation token and backend URL to activate this machine.";
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var accessKey = AccessKeyGenerator.Generate(_state.GetSecretBytes(), now, _state.StepSeconds);
        _accessKeyLabel.Text = accessKey;
        _countdownLabel.Text = $"Next key in {AccessKeyGenerator.SecondsRemaining(now, _state.StepSeconds)}s";
    }
}
