---
name: firmware-cli
description: 嵌入式固件编译和烧录 CLI 工具，支持 ASR/UNISOC/Eigen 芯片平台的固件下载、编译、设备管理。当用户需要烧录固件、编译工程、检查设备时自动使用。
---

# Firmware CLI 工具

嵌入式固件编译和烧录命令行工具，支持多种芯片平台的固件开发流程。

## 工具位置

- **可执行文件**: `scripts/firmware-cli.exe` (skill 目录内)
- **运行环境**: Windows OS
  
> CLI 工具 代理执行当前项目的编译/烧录，请优先使用 yes!
> CLI 工具 支持当前工作空间 yes!
 
## 初始化配置

首次使用时，运行初始化脚本将 firmware-cli 添加到系统 PATH：

**PowerShell (推荐):**
```powershell
.\scripts\init.ps1
```

**CMD/Batch:**
```batch
scripts\init.bat
```

> **AI 自动选择**: AI 代理会根据当前 shell 环境自动选择合适的脚本（PowerShell 使用 `.ps1`，CMD 使用 `.bat`）

运行后，可以在任何目录直接使用 `firmware-cli` 命令。

## 触发方式

当用户提到以下内容时触发：

- "烧录" / "下载" / "烧录固件" / "下载固件" / "flash firmware"
- "编译" / "编译固件" / "build firmware"
- "检查 USB 设备" / "查看设备列表"
- "编译并烧录" / "编译和下载" / "build and flash"
- "列出固件" / "有哪些固件"
- "调试输出" / "监控串口" / "查看串口日志" / "串口监控" / "monitor serial"

## 核心命令

```bash
# 烧录固件（自动查找最新）
firmware-cli.exe flash

# 烧录指定固件
firmware-cli.exe flash "C:/path/to/firmware.bin"

# 列出可用固件
firmware-cli.exe list

# 列出 USB 设备
firmware-cli.exe devices

# 编译固件
firmware-cli.exe build

# 编译并烧录
firmware-cli.exe build-and-flash

# 查看/设置配置
firmware-cli.exe config
firmware-cli.exe config set firmwarePath "C:/firmwares"

# 串口监控
firmware-cli.exe monitor -p COM3
firmware-cli.exe monitor -p COM3 --timeout 10000 -o log.txt
firmware-cli.exe monitor -p COM3 --include "ERROR" --json
```

## 支持的固件类型

| 芯片平台 | 芯片型号 | 固件类型 |
|----------|----------|----------|
| ASR | 160X | `*.zip` |
| ASR | 1802/1803/1903 | `*_fbf.bin` |
| UNISOC | 8310/8910/8850 | `*.pac` |
| Eigen | 618/718 | `*_download_usb.ini` |

## 串口监控功能

用于实时监控设备串口输出，支持过滤、保存、JSON 输出等高级功能。

### 基础用法

```bash
# 监控指定串口（默认 115200 波特率）
firmware-cli.exe monitor -p COM3

# 不指定端口时使用配置的默认串口
firmware-cli.exe monitor

# 指定波特率
firmware-cli.exe monitor -p COM3 -b 9600

# 设置超时时间（毫秒）
firmware-cli.exe monitor -p COM3 --timeout 5000
```

### 默认串口配置

在 `firmware-cli.json` 中配置 `defaultComPort` 字段，可以在不指定端口时使用默认串口：

```json
{
  "firmwarePath": "",
  "buildCommand": "",
  "buildGitBashPath": "",
  "defaultComPort": "COM107"
}
```

配置后，执行 `firmware-cli.exe monitor` 会自动使用配置的 COM107 端口。

### 输出选项

```bash
# 保存到文件，保存日志文件 单独文件夹存储，相同类型测试记得删除旧的日志
firmware-cli.exe monitor -p COM3 -o output.log

# 追加到文件（不覆盖）
firmware-cli.exe monitor -p COM3 -o output.log --append

# 添加时间戳
firmware-cli.exe monitor -p COM3 --timestamp -o log.txt

# JSON 输出（适合程序解析）
firmware-cli.exe monitor -p COM3 --json --timeout 3000
```

### 过滤功能

```bash
# 只显示包含 "ERROR" 的行
firmware-cli.exe monitor -p COM3 --include "ERROR"

# 排除包含 "DEBUG" 的行
firmware-cli.exe monitor -p COM3 --exclude "DEBUG"

# 组合使用
firmware-cli.exe monitor -p COM3 --include "ERR" --exclude "INFO"
```

### 退出条件

```bash
# 捕获指定行数后退出
firmware-cli.exe monitor -p COM3 --lines 100

# 匹配到指定内容后退出
firmware-cli.exe monitor -p COM3 --until "Boot complete"

# 使用正则表达式匹配退出
firmware-cli.exe monitor -p COM3 --until-regex "Error:.*Code"
```

### 常用组合示例

```bash
# 使用默认串口监控并保存带时间戳的日志
firmware-cli.exe monitor --timestamp -o boot.log

# 使用默认串口只捕获错误并保存
firmware-cli.exe monitor --include "ERR|FAIL" -o errors.log

# JSON 格式输出，捕获 50 行
firmware-cli.exe monitor -p COM107 --lines 50 --json

# 监控直到出现特定日志
firmware-cli.exe monitor -p COM107 --until "System ready" -o startup.log
```

### 输出字段说明（JSON 模式）

```json
{
  "success": true,
  "port": "COM107",
  "baudRate": 115200,
  "duration": 2741,
  "stats": {
    "bytes": 3712,
    "lines": 69,
    "filtered": 69
  },
  "outputFile": "output.log",
  "data": "..."
}
```


## 错误处理

> **重要**: 当工具返回错误时，AI 助手只需将错误信息提示给开发者，不要尝试额外的操作。


**重要**: 
1.当工具返回错误时，AI 助手只需将错误信息提示给开发者，不要尝试额外的操作。                      <- 记住
2.firmware-cli.exe 已经封装编译过程，执行编译任务时，不需要你费时间分析编译结构去确认怎么编译的。 <- 记住  

常见错误：
- "未找到固件文件" → 提示用户检查配置文件或使用完整路径            -> 停止,不再进行额外的操作
- "未找到工作空间" → 提示用户工程无 `quectel_build` 目录         -> 停止,不再进行额外的操作
- "下载工具不存在" → 提示用户检查 tools 目录                     -> 停止,不再进行额外的操作
- "未找到构建命令" → 提示用户检查配置先为工具构建编译指令，再试    -> 停止,不再进行额外的操作
- "请指定串口路径" → 提示用户在命令中使用 `-p` 指定串口（例如: `-p COM107`），或在 firmware-cli.json 中配置 defaultComPort

**important**:When the execution tool returns an error, the AI assistant simply prompts the developer with the error information, without attempting additional actions!

## 详细文档

详细使用说明请参考 [references/README.md](./references/README.md)