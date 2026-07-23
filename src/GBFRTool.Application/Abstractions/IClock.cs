namespace GBFRTool.Application.Abstractions;

public interface IClock
{
    DateTimeOffset UtcNow { get; }
}
