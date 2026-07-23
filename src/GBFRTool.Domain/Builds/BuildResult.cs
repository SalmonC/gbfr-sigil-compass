namespace GBFRTool.Domain.Builds;

public sealed record BuildResult(
    IReadOnlyList<string> SelectedInstanceIds,
    IReadOnlyList<bool> OptionalCoverageByTargetPosition,
    IReadOnlyList<PrimaryTargetMatch> PrimaryTargetMatches,
    int MatchedOptionalTargetCount,
    int MatchedPrimarySlotCount,
    int ExactPrimaryTargetCount,
    int AvoidSkillOccurrences,
    int UsedSlots,
    int LevelSum,
    string CanonicalSignature,
    string RankingExplanation);
