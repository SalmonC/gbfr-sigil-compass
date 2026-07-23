using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using GBFRTool.Contracts.Desktop;
using GBFRTool.Contracts.SaveReader;
using GBFRTool.Engine.Host;

var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
{
    PropertyNameCaseInsensitive = false,
    Converters = { new JsonStringEnumConverter() }
};

if (args.Contains("--self-test", StringComparer.Ordinal))
{
    return EngineSelfTest.Run();
}

var sessions = new Dictionary<string, TargetDraftSession>(StringComparer.Ordinal);
string? line;
while ((line = await Console.In.ReadLineAsync()) is not null)
{
    if (System.Text.Encoding.UTF8.GetByteCount(line) > DesktopProtocol.DefaultMaxFrameBytes)
    {
        await WriteFailureAsync("", "", "desktop.protocol.frame_too_large");
        return 2;
    }

    DesktopEnvelope? envelope = null;
    try
    {
        envelope = JsonSerializer.Deserialize<DesktopEnvelope>(line, jsonOptions);
        if (envelope is null || envelope.ProtocolVersion != DesktopProtocol.CurrentVersion)
        {
            await WriteFailureAsync(envelope?.RequestId ?? "", envelope?.CorrelationId ?? "", "desktop.protocol.version_mismatch");
            continue;
        }

        object payload = envelope.MessageType switch
        {
            "engine.hello" => new EngineHello(
                "0.2.0",
                Environment.GetEnvironmentVariable("GBFR_ENGINE_MANIFEST_SHA256") ?? "development-unverified",
                "gbfr-2.0.2-6aba7fc633e8",
                DesktopProtocol.DefaultMaxFrameBytes,
                ["fileImport", "profilePersistence", "shareCode", "targetDraftV1", "rawTraitHashes"]),
            "inventory.import" => await ImportInventoryAsync(envelope),
            "targetDraft.open" => OpenDraft(envelope, sessions),
            "targetDraft.apply" => ApplyEdit(envelope, sessions),
            _ => throw new DraftProtocolException("desktop.protocol.message_type_unknown")
        };

        await WriteResponseAsync(envelope, $"{envelope.MessageType}.ok", payload);
    }
    catch (DraftProtocolException exception)
    {
        await WriteFailureAsync(envelope?.RequestId ?? "", envelope?.CorrelationId ?? "", exception.Code);
    }
    catch (JsonException)
    {
        await WriteFailureAsync("", "", "desktop.protocol.invalid_json");
    }
}

async Task<ImportedInventoryView> ImportInventoryAsync(DesktopEnvelope envelope)
{
    var request = envelope.Payload.Deserialize<ImportInventoryRequest>(jsonOptions)
        ?? throw new DraftProtocolException("desktop.protocol.payload_invalid");
    if (string.IsNullOrWhiteSpace(request.SnapshotPath))
    {
        throw new DraftProtocolException("inventory.path_invalid");
    }

    try
    {
        var workerName = OperatingSystem.IsWindows()
            ? "GBFRTool.SaveReader.Worker.exe"
            : "GBFRTool.SaveReader.Worker";
        var workerPath = Path.Combine(AppContext.BaseDirectory, workerName);
        if (!File.Exists(workerPath)) throw new DraftProtocolException("inventory.worker_missing");
        var startInfo = new ProcessStartInfo(workerPath)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = AppContext.BaseDirectory
        };
        startInfo.ArgumentList.Add("--parse");
        startInfo.ArgumentList.Add(request.SnapshotPath);
        using var worker = Process.Start(startInfo)
            ?? throw new DraftProtocolException("inventory.worker_start_failed");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var outputTask = worker.StandardOutput.ReadToEndAsync(timeout.Token);
        var errorTask = worker.StandardError.ReadToEndAsync(timeout.Token);
        await worker.WaitForExitAsync(timeout.Token);
        var output = await outputTask;
        var error = await errorTask;
        if (worker.ExitCode != 0 || output.Length > DesktopProtocol.DefaultMaxFrameBytes)
        {
            throw new DraftProtocolException(error.Contains("checksum", StringComparison.OrdinalIgnoreCase)
                ? "inventory.checksum_invalid"
                : "inventory.save_invalid");
        }
        var parsed = JsonSerializer.Deserialize<WorkerParsedInventory>(output, jsonOptions)
            ?? throw new DraftProtocolException("inventory.worker_response_invalid");
        var inventoryId = Guid.NewGuid().ToString("N");
        var view = new ImportedInventoryView(
            inventoryId,
            parsed.ParserVersion,
            parsed.SaveFormatVersion,
            parsed.Sigils.Select(sigil => new RawSigilView(
                sigil.GemUnitId,
                sigil.InventorySlotId,
                sigil.SigilHash,
                sigil.SigilLevel,
                sigil.PrimaryTraitHash,
                sigil.PrimaryLevel,
                sigil.SecondaryTraitHash,
                sigil.SecondaryLevel,
                sigil.Flags,
                sigil.WornByCharacterId)).ToArray(),
            parsed.Diagnostics.Select(diagnostic => new DesktopDiagnostic(
                diagnostic.Severity,
                diagnostic.Code,
                diagnostic.Message,
                diagnostic.Metadata)).ToArray());
        return view;
    }
    catch (InvalidDataException)
    {
        throw new DraftProtocolException("inventory.save_invalid");
    }
    catch (IOException)
    {
        throw new DraftProtocolException("inventory.read_failed");
    }
    catch (OperationCanceledException)
    {
        throw new DraftProtocolException("inventory.worker_timeout");
    }
}

return 0;

object OpenDraft(DesktopEnvelope envelope, IDictionary<string, TargetDraftSession> sessions)
{
    _ = envelope.Payload.Deserialize<OpenTargetDraftRequest>(jsonOptions)
        ?? throw new DraftProtocolException("desktop.protocol.payload_invalid");
    var session = new TargetDraftSession(Guid.NewGuid().ToString("N"));
    sessions.Add(session.DraftId, session);
    return session.CurrentView;
}

object ApplyEdit(DesktopEnvelope envelope, IDictionary<string, TargetDraftSession> sessions)
{
    var request = envelope.Payload.Deserialize<ApplyTargetEditRequest>(jsonOptions)
        ?? throw new DraftProtocolException("desktop.protocol.payload_invalid");
    if (!sessions.TryGetValue(request.DraftId, out var session))
    {
        throw new DraftProtocolException("desktop.draft.not_found");
    }

    return session.Apply(request);
}

async Task WriteResponseAsync(DesktopEnvelope request, string messageType, object payload)
{
    var response = new
    {
        protocolVersion = DesktopProtocol.CurrentVersion,
        messageType,
        requestId = request.RequestId,
        correlationId = request.CorrelationId,
        payload
    };
    await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, jsonOptions));
}

async Task WriteFailureAsync(string requestId, string correlationId, string code)
{
    var response = new
    {
        protocolVersion = DesktopProtocol.CurrentVersion,
        messageType = "desktop.failure",
        requestId,
        correlationId,
        payload = new DesktopFailure(code, code, new Dictionary<string, string>(StringComparer.Ordinal))
    };
    await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, jsonOptions));
}
