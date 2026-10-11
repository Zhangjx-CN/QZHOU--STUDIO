# 轻舟 Qingzhou

面向普通用户的本地 AI 工作台：连接模型与云端 Agent，将对话、项目和生成文件集中管理。

**当前版本：0.1.0 Alpha，Windows 源码发行版。** 此包需要安装运行环境，不包含可直接双击安装的 EXE 安装程序。此次源码整理未重新实测上游服务，不承诺所有服务及所有文件格式均可用。

## 项目范围

- 在一个窗口管理模型连接、外部 Agent 和项目对话。
- 通过 OpenAI 兼容接口调用模型，通过 webhook 调用外部工作流。
- 对接火山方舟 Managed Agents Session 事件流，接收回复和上游提供的文件。
- 提供上传 CSV、创建 Session 的入口；Environment 和 Agent 在上游控制台创建。
- 将对话及可接收的产物保存在本地，提供查看、另存等入口。

轻舟的设计范围是“调用外部能力、接回结果、本地保存”。上游 Agent 的规划、执行和工具能力由上游服务提供。具体能力取决于所配置接口、模型和权限。

## Windows 安装与启动

准备 Node.js 22、Python 3.12，并确保 node、npm、python 可在终端运行。在解压后的项目根目录打开 PowerShell，依次执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server\requirements.txt
npm ci
npm --prefix app ci
npm run build:app
npm start
```

安装依赖需要联网。Electron 会启动本地 Python 服务，默认端口 8000。首次启动后，在“模型与连接”或“Agent 库”填写自己的服务配置；默认不附带个人连接、密钥、对话或产物。

之后可在项目目录执行 `npm start`。Python 环境放在项目内的 `.venv`；也可通过 `LIGHTBOAT_PYTHON` 指定 Python 可执行文件的完整路径。

## 数据与费用

- 运行数据写入项目的 `data/`，含本地数据库、Agent 配置、上传文件及工作区。
- **当前 API Key 为本地明文存储。** 不要分享运行后的 data 文件夹或将它提交到 GitHub。
- “本地优先”描述存储位置。远程模型和 Agent 会收到你发送的内容、相关历史及附件。
- 发送任务、上传 CSV、创建 Session 等会实际访问上游，可能产生费用。当前版本没有默认拦截每次调用的预算闸门，费用与配额由上游账户管理。
- 关闭窗口不保证取消上游已开始的任务；取消及计费规则取决于上游。
- 请在“探测通道”之前确认上游权限及政策；该入口只用于连接探测，不提交推理消息。

详细说明见 [隐私与安全](docs/PRIVACY.md)。

## 目录

```text
app/src/           React 界面和前端入口
electron/          桌面窗口、启动与本地文件交互
server/app/api.py  本地 API 入口
server/app/adapters.py  外部服务适配器
server/app/        本地数据、项目及相关支持代码
```

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [需求契约](需求契约.md)。

提交问题时请描述复现步骤及错误信息，并移除密钥、令牌、个人数据和服务私有地址。目前以 Windows 开发运行方式为主，尚未提供签名安装包、跨平台发行保障或经过独立安全审计的承诺。

## 许可证

项目代码采用 [MIT](LICENSE) 许可证。第三方依赖遵循各自许可证，参见 [第三方说明](THIRD_PARTY_NOTICES.md)。
