using GBFRTool.Domain.Skills;

namespace GBFRTool.Domain.Builds;

public sealed record BuildRequest(
    IReadOnlyList<SkillId> MandatoryTargets,
    IReadOnlyList<SkillId> OptionalTargets,
    BasicPrimaryTargetPolicy BasicPrimaryPolicy,
    SkillBlockPolicy SkillBlockPolicy,
    int MaxSlots,
    string? CharacterId,
    string CatalogVersion,
    int ResultLimit,
    long RunSeed);
