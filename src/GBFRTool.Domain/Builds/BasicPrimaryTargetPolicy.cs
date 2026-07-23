using GBFRTool.Domain.Skills;

namespace GBFRTool.Domain.Builds;

public sealed record BasicPrimaryTargetPolicy(
    IReadOnlyList<SkillId> OrderedTargets,
    bool PrioritizePrimaryPlacement,
    bool AllowSubstitution,
    IReadOnlyList<SkillId> OrderedSubstitutionPool)
{
    public int TargetCount => OrderedTargets.Count;
}
