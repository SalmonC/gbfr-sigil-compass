namespace GBFRTool.Domain.Builds;

public sealed record BuildAnalysis(
    string SnapshotId,
    string RequestHash,
    string ComparatorVersion,
    long RunSeed,
    SolverStatus Status,
    IReadOnlyList<BuildResult> Results,
    IReadOnlyList<string> Diagnostics);

public enum SolverStatus
{
    Completed,
    NoHardConstraintFeasibleSolution,
    Cancelled,
    TimedOut
}
