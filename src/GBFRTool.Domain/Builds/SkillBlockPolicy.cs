using GBFRTool.Domain.Skills;

namespace GBFRTool.Domain.Builds;

public sealed record SkillBlockPolicy(
    IReadOnlySet<SkillId> ForbiddenSkillIds,
    IReadOnlySet<SkillId> SoftBlockedSkillIds);
