# 数字员工接入 Skill

将通用接入 Skill 分发到 Qoder IDE 和 Kimi Work。所有用户可安装相同的 Skill；后续账号与企业权限由平台授权决定。

**当前版本：0.1.0-preview.1，分发预览。**

当前可用：本地检测、受控安装、文件完整性检查、带备份更新和卸载。平台设备绑定、自动准备 Browser Runtime、数字员工查询与执行尚未开放。安装完成不表示已绑定平台。

## 用户安装

把以下文字交给你的本地 Agent：

~~~text
请安装这个仓库中的 digital-employee-connect Skill：
https://github.com/qinmingze991-dot/digital-employee-skills

使用指定版本 0.1.0-preview.1 的完整发布包，按当前客户端实际支持的方式安装。
仅安装这个 Skill，保留权限审批，不修改其他 Skill 或项目代码。
安装后检查版本和原生加载状态。
~~~

Agent 可以从 [发布页面](https://github.com/qinmingze991-dot/digital-employee-skills/releases/tag/v0.1.0-preview.1) 获取完整 ZIP。也可取得此版本源码中的 skills/digital-employee-connect 文件夹。正常用户无需手动 npm、填写 Connector 参数或复制 Token。

Kimi Work 可直接使用“插件 → 技能 → 自定义技能 → 上传技能”导入完整 ZIP。Qoder IDE 的目录安装需按当前客户端确认加载；原生安装/加载尚需用户实测，不能保证一句话无额外审批。

只下载 SKILL.md 适合阅读流程；完整使用需要 ZIP 中的脚本、manifest 与 references。

## 安装后验证

新建任务，原生选择 digital-employee-connect，然后说：

~~~text
请使用数字员工接入 Skill，检查当前安装版本和宿主状态。
~~~

Skill 让 Agent 使用已有 Node.js 22+ 或客户端已有的兼容 Node 运行 helper。不自动安装 Node/依赖；没有兼容解释器时，可以原生导入并检查 Skill 加载，但 helper 功能不可用。

| 状态 | 代表什么 |
| --- | --- |
| SOURCE_VERIFIED | 当前包与其 manifest 一致 |
| FILES_INSTALLED / FILES_VERIFIED | Skill 文件已安装或校验 |
| nativeActivation=NOT_VERIFIED | helper 没有证明原生 Agent 加载 |
| deviceBinding=NOT_AVAILABLE | 本版没有设备绑定 |
| FEATURE_NOT_AVAILABLE | 请求的绑定或业务执行尚未开放 |

回复版本、目录存在、CI 通过都不能替代平台绑定或真实宿主执行验收。

## 开发者与 Agent 命令

~~~text
node skills/digital-employee-connect/scripts/core.mjs info
node skills/digital-employee-connect/scripts/core.mjs detect --host qoder
node skills/digital-employee-connect/scripts/core.mjs plan --host qoder
node skills/digital-employee-connect/scripts/core.mjs install --host qoder
node skills/digital-employee-connect/scripts/core.mjs verify --host qoder
node skills/digital-employee-connect/scripts/core.mjs doctor --host qoder
~~~

Kimi Work 将 host 改为 kimi。helper 仅支持 Windows 的明确目录；未知客户端或链接目录拒绝猜测。

更新：从新版本包运行 install --host HOST --replace。需要本安装器的有效 receipt，现有内容必须未被修改；旧版本移动到自有备份目录。

卸载：明确要求卸载后运行 uninstall --host HOST --confirm digital-employee-connect。自有安装被移动到备份，原有/其他 Skills 保持；不自动删除备份。原生界面导入的安装使用原生界面管理。

## 分发与边界

- Skill 目录自包含；两份宿主说明共享同一个核心 helper。
- 不依赖 npm 包或第三方运行时库，不修改全局 PATH、MCP、权限设置或生产平台。
- 源码 manifest 校验文件完整性，不能单独证明发布者身份。核对仓库归属与指定版本；发布 ZIP 附 SHA256SUMS。
- 不存储或请求账号、企业数据、Token、Cookie 或设备凭证；本预览没有平台网络请求。
- 本工具不是恶意同用户进程的安全隔离层，也不能限制宿主自带 shell/浏览器的所有能力。
- 本仓库的分发版本独立于平台版本；本次公开发布不表示平台 v0.1.1 或设备协议已交付。

## 开发检查

~~~text
node tools/validate.mjs
node --test
python tools/build_release.py --out <发布产物目录>
~~~

测试使用独立临时目录，不安装到开发者的真实客户端、不连接生产、不测试数据库。完整性与安全边界测试通过后，仍需各宿主的真实安装、加载、更新、卸载和执行验证。
