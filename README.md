# Firmware CLI Tool

固件编译和烧录CLI工具，支持多种芯片平台。

## 安装

### 方法1: 直接使用（需要Node.js）
```bash
npm install
```

### 方法2: 使用独立exe文件（无需Node.js）
直接使用 `dist/firmware-cli.exe` 文件，无需安装任何依赖。

## 使用方法

### 使用Node.js运行
```bash
node index.js <命令> [参数]
```

### 使用独立exe
```bash
firmware-cli.exe <命令> [参数]
```

## 命令

### 烧录固件
```bash
# 自动查找并烧录固件
firmware-cli.exe flash

# 指定固件路径
firmware-cli.exe flash "C:/path/firmware.bin"
```

### 列出可用固件
```bash
firmware-cli.exe list
```

### 列出USB设备
```bash
firmware-cli.exe devices
```

### 编译固件
```bash
# 自动查找构建命令
firmware-cli.exe build

# 指定构建命令
firmware-cli.exe build "build_OPTfile.bat"
```

### 编译并烧录
```bash
firmware-cli.exe build-and-flash
```

### 配置管理
```bash
# 显示当前配置
firmware-cli.exe config

# 设置固件路径
firmware-cli.exe config set firmwarePath "C:/path/to/firmware"

# 设置构建命令
firmware-cli.exe config set buildCommand "build_OPTfile.bat"

# 设置Git Bash路径（用于运行Shell脚本）
firmware-cli.exe config set buildGitBashPath "C:/Program Files/Git/bin/bash.exe"
```

### 帮助
```bash
firmware-cli.exe help
```

## 配置文件

在项目根目录创建 `firmware-cli.json` 文件，参数指定空使用工具默认值：
```json
{
  "firmwarePath": "",
  "buildCommand": "",
  "buildGitBashPath": ""
}
```

## 支持的固件类型

- **ASR 160X**: `*.zip`
- **ASR 180X/190X**: `*_fbf.bin`
- **UNISOC 8310/8910/8850**: `*.pac`
- **Eigen 618/718**: `*_download_usb.ini`

## 目录结构

```
cli/
├── index.js      # 主入口文件
├── utils.js      # 工具函数模块
├── flash.js      # 固件烧录功能
├── list.js       # 固件列表查询
├── compile.js    # 固件编译功能
├── package.json  # 依赖配置
└── README.md     # 文档

dist/
└── firmware-cli.exe  # 独立可执行文件
```

## AI工具集成

此CLI工具可以直接被AI工具（如CLINE）调用，无需任何特殊配置。

AI工具可以通过自然语言描述来执行各种操作，例如：
- "帮我烧录最新的固件"
- "列出所有可用的固件"
- "编译并烧录固件"
- "显示当前配置"

## 打包说明

如需重新打包exe文件：

```bash
cd cli
pkg index.js -t node18-win-x64 -o ../dist/firmware-cli.exe
```

注意：需要全局安装pkg工具：
```bash
npm install -g pkg
```

## 依赖

- `iconv-lite`: 编码转换
- `adm-zip`: ZIP文件处理

## 许可证

MIT