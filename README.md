# 数字员工接入 Skill

Windows Qoder IDE 和 Kimi Work 共用一个用户态 helper，从企业账号读取已雇佣员工，经用户确认能力和网站后通过 Browser Runtime 工作。

**v0.1.1-preview.1 是开发预览，尚未发布便携客户端，也未部署设备协议。** 仓库 release-channel.json 的信任根为空，connect 返回 RELEASE_NOT_AVAILABLE。不得据此声称公网初装、生产绑定或真实宿主业务验收通过。已发布的 [v0.1.0-preview.1](https://github.com/qinmingze991-dot/digital-employee-skills/releases/tag/v0.1.0-preview.1) 保持历史分发预览能力。

## 开放发布后的用户流程

将指定完整版本包交给 Qoder IDE 或 Kimi Work，按当前客户端支持的原生方式安装并选择 digital-employee-connect。让 Agent 使用此 Skill 连接平台；用户在网页登录、核对验证码、授权设备、选择员工与任务权限，然后向 Agent 发起任务。用户无需手工 npm、管理员权限、复制 Token 或配置 Connector 参数；仍保留原生宿主工具审批。

设备凭证按 Windows 用户与宿主分开保存，30 天硬到期、可撤销；本地 helper 换取最长 10 分钟短会话。退出连接撤销短会话，设备解绑在平台完成。更新保留旧客户端和安装备份，不自动删除设备凭证、浏览器资料或其他 Skills。

## 开发与管理

~~~text
node skills/digital-employee-connect/scripts/core.mjs info
node skills/digital-employee-connect/scripts/core.mjs plan --host qoder
node skills/digital-employee-connect/scripts/core.mjs install --host qoder
node skills/digital-employee-connect/scripts/core.mjs doctor --host kimi
~~~

无 Node 的 Windows 入口是 scripts/bootstrap.ps1 -HostAgent qoder|kimi -Command connect，它在自己的用户目录准备固定 SHA-256 的 Node 24.18.0。便携客户端使用仓库固定 Ed25519 信任根、签名元数据和全文件 SHA-256 校验；Runtime/Chromium 与宿主运行时隔离，不修改 PATH、全局 npm 或管理员配置。

更新 Skill 先 plan，随后 install --replace，只接管本安装器的有效 receipt；旧版本移动到备份。明确卸载时 uninstall --confirm digital-employee-connect，也只移动自有安装。原生导入使用原生界面管理。已发布旧版五文件 manifest 可受控升级；不覆盖修改过的内容。

[Skill 入口](skills/digital-employee-connect/SKILL.md) 和 [helper 协议](skills/digital-employee-connect/references/native-helper.md) 说明了连接及结构化任务循环。helper 不提供 Agent 代用户批准、读取凭证、任意 shell、绕过权限或自动降级接口。

## 验证与发布边界

~~~text
node tools/validate.mjs
node --test
python tools/build_release.py --out <独立产物目录>
~~~

测试只使用独立临时用户目录、合成数据和内存生成的测试签名，不连接生产或调用模型。源码 manifest 证明完整性，发布者身份由可信仓库和固定签名根建立；不得从下载包本身取一个新公钥即信任它。

DPAPI CurrentUser 不隔离同一 Windows 用户的恶意程序。本 Skill 的指令和 localhost Origin/CSRF 不能替代 Qoder/Kimi 原生 shell/browser 硬限制。真实宿主安装/加载、干净电脑公网初装、权限限制、生产绑定和业务人工验收均需独立 Gate；本次分支和测试不代表这些 Gate 的 PASS。签名根配置、客户端发布以及生产部署由负责人另行批准。
