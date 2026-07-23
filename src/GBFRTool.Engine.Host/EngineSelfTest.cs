using GBFRTool.Contracts.Desktop;

namespace GBFRTool.Engine.Host;

internal static class EngineSelfTest
{
    public static int Run()
    {
        var session = new TargetDraftSession("fixture-draft");
        AddMany(session, TargetDomain.Mandatory,
            "test.attack.celestial-1", "test.attack.celestial-2", "test.attack.celestial-3",
            "test.attack.celestial-4", "test.attack.fatebreaker",
            "test.attack.damage-cap", "test.attack.damage-cap", "test.attack.damage-cap");
        AddMany(session, TargetDomain.BasicPrimary,
            "test.basic.stun", "test.basic.stun", "test.basic.stun", "test.basic.hp", "test.basic.hp");
        AddMany(session, TargetDomain.Optional,
            "test.attack.damage-cap", "test.attack.berserker-echo", "test.attack.spartan-echo",
            "test.attack.supplementary", "test.attack.supplementary", "test.attack.supplementary",
            "test.attack.dodge-payback", "test.special.war-elemental");

        var view = session.CurrentView;
        if (view.Revision != 21 || view.OptionalCount != 8 || view.OptionalLimit != 11
            || view.OptionalRemaining != 3 || view.OverflowCount != 0)
        {
            Console.Error.WriteLine("Fixture capacity self-test failed.");
            return 1;
        }

        try
        {
            AddMany(session, TargetDomain.Forbidden, "test.attack.damage-cap");
            Console.Error.WriteLine("Cross-domain conflict self-test failed.");
            return 1;
        }
        catch (DraftProtocolException exception) when (exception.Code == "desktop.draft.skill_occupied")
        {
            Console.WriteLine("Engine protocol 1; fixture capacity 8/11; priority-boundary sharing verified");
            return 0;
        }
    }

    private static void AddMany(TargetDraftSession session, TargetDomain domain, params string[] skillIds)
    {
        foreach (var skillId in skillIds)
        {
            var request = new ApplyTargetEditRequest(
                session.DraftId,
                session.Revision,
                Guid.NewGuid().ToString("N"),
                new TargetEdit("add", domain, skillId, null, null));
            session.Apply(request);
        }
    }
}
