using GBFRTool.Contracts.Desktop;

namespace GBFRTool.Engine.Host;

internal sealed class TargetDraftSession
{
    private readonly List<TargetEntry> entries = [];
    private readonly Dictionary<string, TargetDraftView> completedEdits = new(StringComparer.Ordinal);

    public TargetDraftSession(string draftId)
    {
        DraftId = draftId;
    }

    public string DraftId { get; }

    public long Revision { get; private set; }

    public TargetDraftView CurrentView => CreateView();

    public TargetDraftView Apply(ApplyTargetEditRequest request)
    {
        if (!string.Equals(request.DraftId, DraftId, StringComparison.Ordinal))
        {
            throw new DraftProtocolException("desktop.draft.not_found");
        }

        if (completedEdits.TryGetValue(request.EditId, out var completed))
        {
            return completed;
        }

        if (request.BaseRevision != Revision)
        {
            throw new DraftProtocolException("desktop.draft.revision_conflict");
        }

        switch (request.Edit.Kind)
        {
            case "add":
                Add(request.Edit);
                break;
            case "remove":
                Remove(request.Edit);
                break;
            default:
                throw new DraftProtocolException("desktop.draft.edit_kind_unsupported");
        }

        Revision++;
        Reindex();
        var view = CreateView();
        completedEdits.Add(request.EditId, view);
        return view;
    }

    private void Add(TargetEdit edit)
    {
        if (edit.Domain is null || string.IsNullOrWhiteSpace(edit.SkillId))
        {
            throw new DraftProtocolException("desktop.draft.edit_invalid");
        }

        if (!edit.SkillId.StartsWith("test.", StringComparison.Ordinal))
        {
            throw new DraftProtocolException("catalog.fixture_only");
        }

        var domain = edit.Domain.Value;
        var allowsDuplicates = domain is TargetDomain.Mandatory or TargetDomain.BasicPrimary or TargetDomain.Optional;
        if (!allowsDuplicates && entries.Any(entry =>
                entry.Domain == domain && string.Equals(entry.SkillId, edit.SkillId, StringComparison.Ordinal)))
        {
            throw new DraftProtocolException("desktop.draft.duplicate_not_allowed");
        }

        if (entries.Any(entry =>
                entry.Domain != domain
                && !CanShareAcrossPriorityBoundary(entry.Domain, domain)
                && string.Equals(entry.SkillId, edit.SkillId, StringComparison.Ordinal)))
        {
            throw new DraftProtocolException("desktop.draft.skill_occupied");
        }

        if (domain == TargetDomain.BasicPrimary && !edit.SkillId.StartsWith("test.basic.", StringComparison.Ordinal))
        {
            throw new DraftProtocolException("desktop.draft.basic_skill_required");
        }

        var targetCount = entries.Count(entry =>
            entry.Domain is TargetDomain.Mandatory or TargetDomain.BasicPrimary or TargetDomain.Optional);
        if (targetCount >= 24 && domain is TargetDomain.Mandatory or TargetDomain.BasicPrimary or TargetDomain.Optional)
        {
            throw new DraftProtocolException("desktop.draft.capacity_reached");
        }

        var newEntry = new TargetEntry(Guid.NewGuid().ToString("N"), edit.SkillId, domain, 0);
        var insertIndex = entries.Count;
        if (!string.IsNullOrWhiteSpace(edit.InsertAfterEntryId))
        {
            var anchorIndex = entries.FindIndex(entry =>
                string.Equals(entry.TargetEntryId, edit.InsertAfterEntryId, StringComparison.Ordinal));
            if (anchorIndex < 0)
            {
                throw new DraftProtocolException("desktop.draft.anchor_not_found");
            }

            insertIndex = anchorIndex + 1;
        }

        entries.Insert(insertIndex, newEntry);
    }

    private void Remove(TargetEdit edit)
    {
        if (string.IsNullOrWhiteSpace(edit.TargetEntryId))
        {
            throw new DraftProtocolException("desktop.draft.edit_invalid");
        }

        var removed = entries.RemoveAll(entry =>
            string.Equals(entry.TargetEntryId, edit.TargetEntryId, StringComparison.Ordinal));
        if (removed != 1)
        {
            throw new DraftProtocolException("desktop.draft.entry_not_found");
        }
    }

    private static bool CanShareAcrossPriorityBoundary(TargetDomain left, TargetDomain right) =>
        (left == TargetDomain.Mandatory && right == TargetDomain.Optional)
        || (left == TargetDomain.Optional && right == TargetDomain.Mandatory);

    private void Reindex()
    {
        foreach (var domain in Enum.GetValues<TargetDomain>())
        {
            var position = 0;
            for (var index = 0; index < entries.Count; index++)
            {
                var entry = entries[index];
                if (entry.Domain == domain)
                {
                    entries[index] = entry with { Position = position++ };
                }
            }
        }
    }

    private TargetDraftView CreateView()
    {
        var mandatoryCount = entries.Count(entry => entry.Domain == TargetDomain.Mandatory);
        var basicCount = entries.Count(entry => entry.Domain == TargetDomain.BasicPrimary);
        var optionalCount = entries.Count(entry => entry.Domain == TargetDomain.Optional);
        var targetCount = mandatoryCount + basicCount + optionalCount;
        var optionalLimit = Math.Max(0, 24 - mandatoryCount - basicCount);
        var overflow = Math.Max(0, targetCount - 24);

        return new TargetDraftView(
            DraftId,
            Revision,
            entries.ToArray(),
            optionalCount,
            optionalLimit,
            Math.Max(0, optionalLimit - optionalCount),
            overflow,
            overflow == 0 && targetCount > 0);
    }
}

internal sealed class DraftProtocolException(string code) : Exception(code)
{
    public string Code { get; } = code;
}
