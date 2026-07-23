namespace GBFRTool.Contracts.SaveReader;

public sealed record WorkerHello(
    int ProtocolVersion,
    string WorkerVersion,
    IReadOnlyList<string> Capabilities);

public sealed record ImportSaveRequest(
    int ProtocolVersion,
    string CorrelationId,
    string SnapshotPath,
    string ExpectedSha256,
    string CatalogVersion);

public sealed record ImportSaveResponse(
    int ProtocolVersion,
    string CorrelationId,
    string ParserVersion,
    string GameDataVersion,
    IReadOnlyList<WireSigilInstance> Sigils,
    IReadOnlyList<WireDiagnostic> Diagnostics);

public sealed record WireSigilInstance(
    string InstanceId,
    long SourceSlotId,
    uint SigilHash,
    int SigilLevel,
    string PrimarySkillId,
    int PrimaryLevel,
    string SecondarySkillId,
    int SecondaryLevel,
    uint Flags,
    string? WornByCharacterId);

public sealed record WireDiagnostic(
    string Severity,
    string Code,
    string Message,
    IReadOnlyDictionary<string, string>? Metadata);

public sealed record WorkerFailure(
    int ProtocolVersion,
    string CorrelationId,
    string Code,
    string Message,
    bool Retryable);

public sealed record WorkerParsedInventory(
    string ParserVersion,
    string SaveFormatVersion,
    IReadOnlyList<WorkerRawSigil> Sigils,
    IReadOnlyList<WorkerDiagnostic> Diagnostics);

public sealed record WorkerRawSigil(
    long GemUnitId,
    long InventorySlotId,
    uint SigilHash,
    int SigilLevel,
    uint PrimaryTraitHash,
    int PrimaryLevel,
    uint SecondaryTraitHash,
    int SecondaryLevel,
    uint Flags,
    string? WornByCharacterId);

public sealed record WorkerDiagnostic(
    string Severity,
    string Code,
    string Message,
    IReadOnlyDictionary<string, string>? Metadata);
