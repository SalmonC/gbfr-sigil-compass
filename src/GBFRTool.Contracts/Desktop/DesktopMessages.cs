using System.Text.Json;
using System.Text.Json.Serialization;

namespace GBFRTool.Contracts.Desktop;

public static class DesktopProtocol
{
    public const int CurrentVersion = 1;
    public const int DefaultMaxFrameBytes = 16 * 1024 * 1024;
}

public sealed record DesktopEnvelope(
    int ProtocolVersion,
    string MessageType,
    string RequestId,
    string CorrelationId,
    JsonElement Payload);

public sealed record EngineHello(
    string EngineVersion,
    string BuildManifestHash,
    string CatalogSchemaVersion,
    int MaxFrameBytes,
    IReadOnlyList<string> Capabilities);

[JsonConverter(typeof(JsonStringEnumConverter<TargetDomain>))]
public enum TargetDomain
{
    Mandatory,
    BasicPrimary,
    Optional,
    BasicSubstitutionOrder,
    Forbidden,
    Avoid
}

public sealed record TargetEntry(string TargetEntryId, string SkillId, TargetDomain Domain, int Position);

public sealed record OpenTargetDraftRequest(string? ProfileId);

public sealed record TargetDraftView(
    string DraftId,
    long Revision,
    IReadOnlyList<TargetEntry> Entries,
    int OptionalCount,
    int OptionalLimit,
    int OptionalRemaining,
    int OverflowCount,
    bool CanAnalyze);

public sealed record ApplyTargetEditRequest(
    string DraftId,
    long BaseRevision,
    string EditId,
    TargetEdit Edit);

public sealed record TargetEdit(
    string Kind,
    TargetDomain? Domain,
    string? SkillId,
    string? TargetEntryId,
    string? InsertAfterEntryId);

public sealed record DesktopFailure(string Code, string MessageKey, IReadOnlyDictionary<string, string> Details);

public sealed record ImportInventoryRequest(string SnapshotPath);

public sealed record ImportedInventoryView(
    string InventoryId,
    string ParserVersion,
    string SaveFormatVersion,
    IReadOnlyList<RawSigilView> Sigils,
    IReadOnlyList<DesktopDiagnostic> Diagnostics);

public sealed record RawSigilView(
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

public sealed record DesktopDiagnostic(
    string Severity,
    string Code,
    string Message,
    IReadOnlyDictionary<string, string>? Metadata);
