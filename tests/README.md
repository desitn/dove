# Firmware CLI 测试

本目录包含 Firmware CLI 的所有测试脚本和测试结果。

## 文件说明

- `test-all.ps1` - PowerShell 测试脚本，用于自动化测试所有命令
- `TEST_SUMMARY.md` - 测试报告文档
- `test-results-*.log` - 测试结果日志文件（带时间戳，已被 .gitignore 忽略）

## 快速开始

### 运行所有测试

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\test-all.ps1
```

### 运行详细模式（显示每个命令的输出）

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\test-all.ps1 -Verbose
```

### 测试特定版本的 exe

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\test-all.ps1 -ExePath ".\firmware-cli-v2.exe"
```

## 测试覆盖

测试脚本包含以下测试用例：

### 功能测试
- ✅ 帮助命令 (`help`, `--help`, `-h`)
- ✅ 固件列表 (`list`)
- ✅ 配置显示 (`config`)
- ✅ USB 设备枚举 (`devices`)
- ✅ 串口列表 (`serial`)

### 错误处理测试
- ✅ 无效命令拒绝
- ✅ 缺少参数验证（monitor 需要端口）
- ✅ 缺少固件文件验证（flash）
- ✅ 缺少工作空间验证（build）

## 测试结果

最新的测试结果保存在 `test-results-*.log` 文件中（JSON 格式），包含：

- 测试名称
- 通过/失败状态
- 退出码
- 命令输出

**注意**: `.log` 文件已被 `.gitignore` 忽略，不会被提交到 Git 仓库。

查看详细测试报告请参阅 `TEST_SUMMARY.md`。

## 测试脚本特性

- **超时处理**: 防止长时间运行的命令（如 monitor）卡住测试
- **结果记录**: 自动保存测试结果到 .log 文件（JSON 格式）
- **彩色输出**: 清晰显示测试状态（通过/失败）
- **详细报告**: 显示失败测试的详细信息
- **路径管理**: 测试结果自动保存到 tests 目录
- **Git 友好**: 使用 .log 后缀，便于 .gitignore 过滤

## 测试环境要求

- Windows 操作系统
- PowerShell
- 已构建的 `firmware-cli.exe`（运行 `npm run build:exe`）

## 持续集成

测试脚本退出码：
- `0` - 所有测试通过（包括预期失败的测试）
- `1` - 有意外失败的测试

可以在 CI/CD 管道中使用此脚本进行自动化测试。