namespace GBFRTool.Application.Common;

public sealed class Outcome<T>
{
    internal Outcome(T? value, ApplicationError? error)
    {
        Value = value;
        Error = error;
    }

    public T? Value { get; }

    public ApplicationError? Error { get; }

    public bool IsSuccess => Error is null;

}

public static class Outcome
{
    public static Outcome<T> Success<T>(T value) => new(value, null);

    public static Outcome<T> Failure<T>(ApplicationError error) => new(default, error);
}
