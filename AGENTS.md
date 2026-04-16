# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run build:watch    # Watch mode for development
npm run build:exe      # Build standalone executable (dove.exe) using pkg
npm run dev            # Run CLI directly with ts-node
npm run clean          # Remove dist/ directory
npm test               # Run help command (basic sanity check)
```

## Architecture Overview

This is a firmware CLI tool (`dove.exe`) for embedded device development. It compiles and flashes firmware across multiple platforms (ASR 160X/180X/190X, UNISOC 8310/8910/8850, Eigen 618/718, ESP).

### Core Source Files

- **`src/index.ts`** - CLI entry point. Routes commands to handlers. Supports: `build`, `flash`, `port`, `config`, `tui`, `build-and-flash`
- **`src/flash.ts`** - Firmware flashing. Auto-detects firmware type by extension, calls appropriate download tool from `tools/`, handles progress display with status patterns
- **`src/serial.ts`** - Serial port operations. Lists ports, monitors output, sends AT commands, enters download mode via AT port
- **`src/compile.ts`** - Build execution. Runs configured build commands (`.bat`, `.sh`, `.ps1`), supports Git Bash PATH injection
- **`src/utils.ts`** - Config loading (`dove.json`, `tools/config/*.json`), firmware type detection, workspace path discovery
- **`src/types/index.ts`** - Type definitions for configs, firmware info, serial ports, monitor options

### Key Concepts

**Firmware Type Detection**: Files are identified by extension patterns:
- `*.zip` containing `download.json` → ASR ABOOT (adownload.exe)
- `*_fbf.bin` → ASR FBF (FBFDownloader.exe)
- `*.pac` → UNISOC PAC (pacdownload tools)
- `*_download_usb.ini` → Eigen ECF

**Port Tags**: User-defined port roles in `dove.json` for AI automation:
- `AT` - AT command port (auto-used by `port at`)
- `DBG` - Debug log port (auto-used by `port monitor`)
- `invalid` - Unusable port (AI should not use)

**Two-Config System**:
- `dove.json` (project root) - User settings: firmwarePath, buildCommands, comPorts
- `tools/config/*.json` - Platform configs: download tools, serial patterns, progress regex

### AI Skills Integration

Two skill files define AI behavior for this tool:

- **`skill/dove-action/SKILL.md`** - High-risk operations (flash, build, reset) → **Must confirm with user before execution**
- **`skill/dove-query/SKILL.md`** - Low-risk queries (list firmware, ports, AT queries) → **Can execute directly without confirmation**

When modifying commands, respect this separation: destructive actions stay in dove-action scope.

### Download Tool Flow

```
flash command → detect firmware type → load platform config → find download port →
(if not found, send AT command via serial to enter download mode) →
spawn download tool process → parse progress patterns → output progress bar
```

### TUI Module

`src/tui-native/` provides a minimal terminal UI with ANSI rendering for interactive menus. Entry via `dove tui` command.

## Platform Configuration

Each platform has a JSON config in `tools/config/` defining:
- Tool executable path and arguments
- Serial port patterns for AT/download detection
- Progress pattern regex for status detection
- Download duration estimate for progress simulation