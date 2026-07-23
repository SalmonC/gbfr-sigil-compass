#!/usr/bin/env sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_root"

DOTNET_ROLL_FORWARD=Major dotnet build GBFRTool.slnx -c Release
DOTNET_ROLL_FORWARD=Major dotnet format GBFRTool.slnx --verify-no-changes --no-restore
DOTNET_ROLL_FORWARD=Major dotnet run --project tests/GBFRTool.ArchitectureTests -c Release --no-build
DOTNET_ROLL_FORWARD=Major dotnet run --project src/GBFRTool.SaveReader.Worker -c Release --no-build -- --self-test
