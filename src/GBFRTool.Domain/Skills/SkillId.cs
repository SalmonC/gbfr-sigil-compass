namespace GBFRTool.Domain.Skills;

public readonly record struct SkillId
{
    public SkillId(string value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        Value = value;
    }

    public string Value { get; }

    public override string ToString() => Value;
}
