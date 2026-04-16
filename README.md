# Dove - firmware cli tool

> Release a dove, deliver your firmware.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

嵌入式固件编译和烧录CLI工具，支持多种芯片平台的固件开发流程。

## 安装

从 [GitHub Release](https://github.com/desitn/dove/releases) 下载 ZIP 包，解压后运行：

```powershell
.\install.ps1
```

脚本会将 `dove.exe` 添加到 PATH 环境变量。

卸载：
```powershell
.\uninstall.ps1
```

## 快速开始

```bash
# 查看帮助
dove help

# 编译固件
dove build

# 烧录固件（自动检测）
dove flash

# 列出串口
dove port list

# 发送 AT 命令
dove port at -c "ATI"

# 监控串口日志
dove port monitor --timeout 30000 -o log.txt

# TUI 交互模式
dove tui
```

## 支持的固件类型

| 平台 | 芯片型号 | 文件格式 |
|------|----------|----------|
| ASR | 160X | `*.zip` (ABOOT) |
| ASR | 180X/190X | `*_fbf.bin` |
| UNISOC | 8310/8910/8850 | `*.pac` |
| Eigen | 618/718 | `*_download_usb.ini` |
| ESP | - | `*.bin` |

## 配置

在项目根目录创建 `dove.json`：

```json
{
  "firmwarePath": "",
  "buildCommands": [
    { "name": "build", "command": "build.bat", "isActive": true }
  ],
  "comPorts": [
    { "port": "COM3", "tag": "AT" },
    { "port": "COM4", "tag": "DBG" }
  ]
}
```

**端口标签说明**：
- `AT` - AT 命令端口，`port at` 自动使用
- `DBG` - 调试日志端口，`port monitor` 自动使用
- `invalid` - 无效端口，AI 不使用

## Claude Code 集成

本工具提供 AI Skill 集成，可在 `.claude/settings.json` 中配置：

```json
{
  "skills": {
    "additionalDirectories": ["C:/tools/dove/skill"]
  }
}
```

配置后，Claude Code 可通过自然语言执行 dove 命令：
- 查询类命令（列出固件、串口、AT 查询）可直接执行
- 操作类命令（烧录、编译、复位）需先确认风险

详见 `skill/dove-action/SKILL.md` 和 `skill/dove-query/SKILL.md`。

## 目录结构

```
dove/
├── dove.exe           # 主程序
├── tools/             # 平台下载工具
│   ├── adownload.exe  # ASR 160X
│   ├── FBFDownloader.exe # ASR 180X/190X
│   └── config/        # 平台配置
├── skill/             # Claude Code Skill
│   ├── dove-action/   # 高风险操作
│   └── dove-query/    # 低风险查询
├── install.ps1        # 安装脚本
├── uninstall.ps1      # 卸载脚本
└── README.md
```

## 构建

```bash
npm install
npm run build          # 编译 TypeScript
npm run build:exe      # 打包可执行文件
```

## License

MIT License - see LICENSE file for details.

---

**Maintained by**: destin.zhang@quectel.com