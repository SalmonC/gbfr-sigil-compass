using GBFRTool.Domain.Skills;

namespace GBFRTool.Domain.Builds;

public sealed record PrimaryTargetMatch(
    int TargetPosition,
    SkillId RequestedSkillId,
    string? SigilInstanceId,
    SkillId? ActualPrimarySkillId,
    PrimaryTargetMatchKind Kind,
    int? SubstitutionPoolRank);

public enum PrimaryTargetMatchKind
{
    Missing,
    Exact,
    Substituted
}
