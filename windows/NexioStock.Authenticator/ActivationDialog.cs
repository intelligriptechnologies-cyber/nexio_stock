using System.Net.Http.Json;
using System.Security.Authentication;
using System.Text.Json;
using System.Windows.Forms;

namespace NexioStock.Authenticator;

internal sealed class ActivationDialog : Form
{
    private readonly AuthenticatorState _state;
    private readonly TextBox _activationTokenBox;
    private readonly TextBox _backendBaseUrlBox;
    private readonly TextBox _machineLabelBox;
    private readonly Button _activateButton;
    private readonly Label _statusLabel;

    public ActivationDialog(AuthenticatorState state)
    {
        _state = state;
        Text = "Activate Authenticator";
        StartPosition = FormStartPosition.CenterParent;
        Width = 560;
        Height = 360;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 1,
            RowCount = 6,
        };

        layout.Controls.Add(new Label
        {
            Text = "Paste the one-time activation token from Shop Master. The app will contact your Nexio Stock backend and save the activation automatically.",
            AutoSize = true,
        });

        _activationTokenBox = new TextBox
        {
            Dock = DockStyle.Fill,
            PlaceholderText = "One-time activation token",
            Text = string.Empty,
        };
        layout.Controls.Add(LabeledField("Activation token", _activationTokenBox));

        _backendBaseUrlBox = new TextBox
        {
            Dock = DockStyle.Fill,
            PlaceholderText = "https://your-backend.example.com",
            Text = _state.BackendBaseUrl,
        };
        layout.Controls.Add(LabeledField("Backend base URL", _backendBaseUrlBox));

        _machineLabelBox = new TextBox
        {
            Dock = DockStyle.Fill,
            PlaceholderText = Environment.MachineName,
            Text = _state.MachineLabel,
        };
        layout.Controls.Add(LabeledField("Machine label (optional)", _machineLabelBox));

        _statusLabel = new Label
        {
            AutoSize = true,
            ForeColor = System.Drawing.Color.FromArgb(88, 96, 105),
            Text = "The app sends a stable machine fingerprint from this Windows machine.",
        };
        layout.Controls.Add(_statusLabel);

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            AutoSize = true,
        };

        _activateButton = new Button { Text = "Activate", AutoSize = true };
        _activateButton.Click += async (_, _) => await SaveActivationAsync();
        var cancelButton = new Button { Text = "Cancel", AutoSize = true };
        cancelButton.Click += (_, _) => DialogResult = DialogResult.Cancel;

        buttons.Controls.Add(_activateButton);
        buttons.Controls.Add(cancelButton);
        layout.Controls.Add(buttons);

        Controls.Add(layout);
    }

    private static Control LabeledField(string label, Control input)
    {
        var panel = new TableLayoutPanel
        {
            AutoSize = true,
            Dock = DockStyle.Top,
            ColumnCount = 1,
            RowCount = 2,
            Margin = new Padding(0, 8, 0, 0),
        };
        panel.Controls.Add(new Label
        {
            Text = label,
            AutoSize = true,
            Margin = new Padding(0, 0, 0, 6),
        });
        panel.Controls.Add(input);
        return panel;
    }

    private async Task SaveActivationAsync()
    {
        SetBusy(true, "Activating with backend...");
        try
        {
            var request = BuildRequest();
            using var httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            using var response = await httpClient.PostAsJsonAsync(request.Endpoint, request.Payload);
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException(await BuildErrorMessageAsync(response));
            }

            var payload = await response.Content.ReadFromJsonAsync<ActivationPayload>();
            if (payload is null || string.IsNullOrWhiteSpace(payload.secret_base32))
            {
                throw new InvalidOperationException("Backend returned an invalid activation response.");
            }

            _state.ShopName = payload.shop_name;
            _state.ShopCode = payload.shop_code;
            _state.SecretBase32 = payload.secret_base32;
            _state.SecretVersion = payload.secret_version;
            _state.StepSeconds = payload.step_seconds;
            _state.BackendBaseUrl = request.BaseUrl;
            _state.MachineLabel = request.Payload.machine_label ?? string.Empty;
            _state.Save();
            DialogResult = DialogResult.OK;
        }
        catch (HttpRequestException ex) when (ex.InnerException is AuthenticationException)
        {
            MessageBox.Show(
                this,
                "Secure connection failed. Check the backend HTTPS certificate and URL, then try again.",
                "Activation Failed",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
        catch (HttpRequestException)
        {
            MessageBox.Show(
                this,
                "Could not reach the backend. Check the base URL, network connection, and server status.",
                "Activation Failed",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
        catch (TaskCanceledException)
        {
            MessageBox.Show(
                this,
                "The backend did not respond in time. Check the network connection and try again.",
                "Activation Failed",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Activation Failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            SetBusy(false, "The app sends a stable machine fingerprint from this Windows machine.");
        }
    }

    private ActivationRequest BuildRequest()
    {
        var activationToken = _activationTokenBox.Text.Trim();
        if (activationToken.Length < 16)
        {
            throw new InvalidOperationException("Enter a valid activation token.");
        }

        var baseUrl = _backendBaseUrlBox.Text.Trim().TrimEnd('/');
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri) ||
            (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidOperationException("Enter a valid backend base URL starting with http:// or https://.");
        }

        var endpoint = new Uri(baseUri, "/auth/authenticator/activate");
        var machineLabel = _machineLabelBox.Text.Trim();

        return new ActivationRequest(
            baseUrl,
            endpoint,
            new ActivationPayloadRequest
            {
                activation_token = activationToken,
                machine_label = string.IsNullOrWhiteSpace(machineLabel) ? null : machineLabel,
                machine_fingerprint = MachineIdentity.GetStableFingerprint(),
                app_version = Application.ProductVersion,
            }
        );
    }

    private static async Task<string> BuildErrorMessageAsync(HttpResponseMessage response)
    {
        try
        {
            var error = await response.Content.ReadFromJsonAsync<ApiError>();
            if (!string.IsNullOrWhiteSpace(error?.detail))
            {
                return error.detail;
            }
        }
        catch (JsonException)
        {
        }

        return $"Activation failed with HTTP {(int)response.StatusCode} ({response.ReasonPhrase}).";
    }

    private void SetBusy(bool busy, string statusText)
    {
        _activateButton.Enabled = !busy;
        _activationTokenBox.Enabled = !busy;
        _backendBaseUrlBox.Enabled = !busy;
        _machineLabelBox.Enabled = !busy;
        _statusLabel.Text = statusText;
    }

    private sealed record ActivationRequest(string BaseUrl, Uri Endpoint, ActivationPayloadRequest Payload);

    private sealed class ActivationPayloadRequest
    {
        public string activation_token { get; set; } = string.Empty;
        public string? machine_label { get; set; }
        public string machine_fingerprint { get; set; } = string.Empty;
        public string app_version { get; set; } = string.Empty;
    }

    private sealed class ActivationPayload
    {
        public string shop_name { get; set; } = string.Empty;
        public string shop_code { get; set; } = string.Empty;
        public string secret_base32 { get; set; } = string.Empty;
        public int secret_version { get; set; }
        public int step_seconds { get; set; } = 300;
    }

    private sealed class ApiError
    {
        public string? detail { get; set; }
    }
}
