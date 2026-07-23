using System.Buffers.Binary;
using System.IO.Hashing;
using System.Security.Cryptography;
using FlatSharp;
using GBFRTool.SaveReader.Core.FlatBuffers;
using GBFRTool.SaveReader.Core.Model;

namespace GBFRTool.SaveReader.Core;

public sealed class ReadOnlyGbfrSaveParser : IReadOnlySaveParser
{
    private const uint EmptyHash = 0x887AE0B0;
    private const uint HashSeedType = 1003;
    private const uint TraitHashType = 1701;
    private const uint TraitLevelType = 1702;
    private const uint GemSlotType = 2702;
    private const uint GemHashType = 2703;
    private const uint GemLevelType = 2704;
    private const uint GemWornByType = 2706;
    private const uint GemFlagsType = 2707;
    private const uint GemUnitBase = 30_000;
    private const uint TraitUnitBase = 120_000_000;
    private const ulong SaveHashSeed = 0x2F1A43EBCD;

    private static readonly (int Start, int Subtract)[] HashSections =
    [
        (0x58, 0x80), (0x30, 0xA0), (0x28, 0x30), (0x38, 0xC0), (0x40, 0xB0),
        (0x68, 0x50), (0x48, 0x60), (0x70, 0x90), (0x50, 0x40), (0x60, 0x70)
    ];

    public async Task<ParsedSave> ParseAsync(Stream source, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!source.CanRead || !source.CanSeek)
        {
            throw new InvalidDataException("save.stream_must_be_readable_and_seekable");
        }

        if (source.Length is < 64 or > 128 * 1024 * 1024)
        {
            throw new InvalidDataException("save.file_size_invalid");
        }

        var bytes = new byte[checked((int)source.Length)];
        source.Position = 0;
        await source.ReadExactlyAsync(bytes, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();

        var span = bytes.AsSpan();
        var mainVersion = BinaryPrimitives.ReadInt32LittleEndian(span);
        var subVersion = BinaryPrimitives.ReadInt32LittleEndian(span[16..]);
        var slotOffset = BinaryPrimitives.ReadInt64LittleEndian(span[28..]);
        var slotSize = BinaryPrimitives.ReadInt64LittleEndian(span[44..]);
        ValidateRange(slotOffset, slotSize, bytes.Length);

        var slotBytes = span.Slice(checked((int)slotOffset), checked((int)slotSize)).ToArray();
        var slotData = SaveDataBinary.Serializer.Parse(new ArrayInputBuffer(slotBytes));
        var diagnostics = new List<ParseDiagnostic>();
        ValidateChecksum(slotBytes, slotData, diagnostics);

        var uintIndex = CreateUniqueUIntIndex(slotData.UIntTable ?? []);
        var intIndex = CreateUniqueIntIndex(slotData.IntTable ?? []);

        var sigils = new List<ParsedSigil>();
        var occupiedCount = 0;
        var singleTraitCount = 0;
        foreach (var unit in slotData.UIntTable ?? [])
        {
            if (unit.IDType != GemHashType || unit.UnitID < GemUnitBase || unit.ValueData is not { Count: > 0 })
            {
                continue;
            }

            var sigilHash = unit.ValueData[0];
            if (sigilHash is 0 or EmptyHash)
            {
                continue;
            }
            occupiedCount++;

            var gemIndex = unit.UnitID - GemUnitBase;
            var primaryUnit = checked(TraitUnitBase + (gemIndex * 100));
            var secondaryUnit = checked(primaryUnit + 1);
            var primaryHash = GetUInt(uintIndex, TraitHashType, primaryUnit);
            var secondaryHash = GetUInt(uintIndex, TraitHashType, secondaryUnit);
            if (primaryHash is 0 or EmptyHash || secondaryHash is 0 or EmptyHash)
            {
                singleTraitCount++;
                continue;
            }

            sigils.Add(new ParsedSigil(
                unit.UnitID,
                GetUInt(uintIndex, GemSlotType, unit.UnitID),
                sigilHash,
                GetInt(intIndex, GemLevelType, unit.UnitID),
                primaryHash,
                GetInt(intIndex, TraitLevelType, primaryUnit),
                secondaryHash,
                GetInt(intIndex, TraitLevelType, secondaryUnit),
                GetUInt(uintIndex, GemFlagsType, unit.UnitID),
                FormatOptionalHash(GetUInt(uintIndex, GemWornByType, unit.UnitID))));
        }

        diagnostics.Add(new ParseDiagnostic(
            "info",
            "save.inventory.vplus_count",
            $"读取到 {sigils.Count} 个双词条因子。",
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["sha256"] = Convert.ToHexStringLower(SHA256.HashData(bytes)),
                ["mainVersion"] = mainVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["subVersion"] = subVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["occupiedCount"] = occupiedCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["singleTraitCount"] = singleTraitCount.ToString(System.Globalization.CultureInfo.InvariantCulture)
            }));

        return new ParsedSave(
            "gbfr-readonly-flatbuffer-v2",
            $"save-format-{mainVersion}.{subVersion}",
            sigils.OrderBy(sigil => sigil.SourceSlotId).ToArray(),
            diagnostics);
    }

    private static void ValidateRange(long offset, long length, int fileLength)
    {
        if (offset < 0 || length <= 0 || offset > fileLength || length > fileLength - offset || length > int.MaxValue)
        {
            throw new InvalidDataException("save.slot_range_invalid");
        }
    }

    private static void ValidateChecksum(
        byte[] slotBytes,
        SaveDataBinary slotData,
        List<ParseDiagnostic> diagnostics)
    {
        if (slotBytes.Length < 0x14)
        {
            throw new InvalidDataException("save.slot_too_small");
        }

        var hashesOffset = BinaryPrimitives.ReadUInt32LittleEndian(slotBytes.AsSpan(slotBytes.Length - 0x14));
        if (hashesOffset > slotBytes.Length - (HashSections.Length * sizeof(ulong)))
        {
            throw new InvalidDataException("save.hash_table_range_invalid");
        }

        var seedUnit = (slotData.UIntTable ?? []).FirstOrDefault(unit =>
            unit.IDType == HashSeedType && unit.ValueData is { Count: > 0 });
        if (seedUnit?.ValueData is not { Count: > 0 })
        {
            throw new InvalidDataException("save.hash_seed_missing");
        }

        var hashIndex = checked((int)(seedUnit.ValueData[0] % HashSections.Length));
        var section = HashSections[hashIndex];
        var sectionLength = checked((int)hashesOffset - (section.Start + section.Subtract));
        if (section.Start < 0 || sectionLength <= 0 || section.Start > slotBytes.Length - sectionLength)
        {
            throw new InvalidDataException("save.hash_section_range_invalid");
        }

        var expected = BinaryPrimitives.ReadUInt64LittleEndian(slotBytes.AsSpan((int)hashesOffset + (hashIndex * sizeof(ulong))));
        var actual = XxHash64.HashToUInt64(slotBytes.AsSpan(section.Start, sectionLength), unchecked((long)SaveHashSeed));
        if (expected != actual) throw new InvalidDataException("save.checksum_mismatch");
        diagnostics.Add(new ParseDiagnostic("info", "save.checksum_valid", "存档校验通过。"));
    }

    private static uint GetUInt(Dictionary<(uint IDType, uint UnitID), uint> index, uint type, uint unitId) =>
        index.TryGetValue((type, unitId), out var value) ? value : 0;

    private static int GetInt(Dictionary<(uint IDType, uint UnitID), int> index, uint type, uint unitId) =>
        index.TryGetValue((type, unitId), out var value) ? value : 0;

    private static string? FormatOptionalHash(uint value) => value is 0 or EmptyHash ? null : $"0x{value:X8}";

    private static Dictionary<(uint IDType, uint UnitID), uint> CreateUniqueUIntIndex(
        IList<UIntSaveDataUnit> units)
    {
        var index = new Dictionary<(uint, uint), uint>();
        foreach (var unit in units.Where(unit => unit.ValueData is { Count: > 0 }))
        {
            if (!index.TryAdd((unit.IDType, unit.UnitID), unit.ValueData![0]))
            {
                throw new InvalidDataException("save.duplicate_uint_unit");
            }
        }

        return index;
    }

    private static Dictionary<(uint IDType, uint UnitID), int> CreateUniqueIntIndex(
        IList<IntSaveDataUnit> units)
    {
        var index = new Dictionary<(uint, uint), int>();
        foreach (var unit in units.Where(unit => unit.ValueData is { Count: > 0 }))
        {
            if (!index.TryAdd((unit.IDType, unit.UnitID), unit.ValueData![0]))
            {
                throw new InvalidDataException("save.duplicate_int_unit");
            }
        }

        return index;
    }
}
