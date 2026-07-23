using GBFRTool.Domain.Skills;

namespace GBFRTool.Domain.Inventory;

public sealed record SigilInstance(
    string InstanceId,
    long SourceSlotId,
    uint SigilHash,
    int SigilLevel,
    SkillId PrimarySkillId,
    int PrimaryLevel,
    SkillId SecondarySkillId,
    int SecondaryLevel,
    uint Flags,
    string? WornByCharacterId);
