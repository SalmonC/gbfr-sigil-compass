namespace GBFRTool.Application.Common;

public sealed record OperationContext(string CorrelationId, DateTimeOffset StartedAt);
