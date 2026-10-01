---
name: digital-employee-connect
description: 安装、检查、更新或卸载数字员工平台接入 Skill，适用于 Qoder IDE 和 Kimi Work 的 Windows 客户端。当前为分发预览，提供本地安装检测，不执行设备绑定或员工业务任务。
metadata:
  version: 0.1.0-preview.1
---

# 数字员工接入

帮助用户安装和验证接入 Skill，准确报告当前可用能力。当前版本为 0.1.0-preview.1；设备绑定、凭证存储和数字员工执行尚未开放。

## 使用

1. 确认用户当前使用 Qoder IDE 还是 Kimi Work；不要把 QoderWork、Kimi Code CLI 或其他宿主的目录代入。按宿主读取 [Qoder 说明](references/qoder.md) 或 [Kimi 说明](references/kimi.md)。
2. 找到本 Skill 所在目录及其中 scripts/core.mjs。使用已有 Node.js 22+ 或客户端已有且满足版本要求的 Node，不要求用户运行 npm，不自动安装或升级 Node/客户端。
3. 先调用 core.mjs 的 info，核对 SOURCE_VERIFIED、实际版本及完整性。进行安装时先 plan，再按原生权限流程调用 install；检测时用 doctor / verify。执行命令使用实际脚本绝对路径，安全引用路径。
4. 用命令输出解释“文件已安装/校验”“原生 Agent 已加载”“平台已绑定”三个不同状态。FILES_VERIFIED 不证明宿主加载，原生聊天回复不证明绑定。

安装请求只授权安装本 Skill 及其自身安装记录；不授权业务任务、全局安全设置、其他 Skills 或生产写入。不关闭宿主的权限审批。遇到权限拒绝或活动目录不明确，报告具体阻塞，不换成其他宿主目录继续。

## 原生加载检查

让用户新建任务，用客户端的 Skill 选择机制调用本 Skill。若用户要求版本标记，先读当前已安装 SKILL.md，再回复其中 metadata.version，并注明“已读取 Skill；平台未绑定”。能执行 helper 时同时返回 info 的真实摘要；执行失败时保留错误，不输出假定成功。

只有观察到原生选中/调用和新任务的实际结果，才能记录本次加载成功。不要把下载、文件存在或之前聊天里记得的版本算成功。

## 更新和卸载

更新：取得指定新版本的完整发布包，先核对 plan。install --replace 只更新有合法本 Skill receipt、内容未被改动的安装，并保留原版本备份。相同版本不同内容拒绝；未由本安装器管理的安装使用宿主原生界面处理，不强行接管。

卸载：用户明确要求卸载本 Skill 时，调用 uninstall --host HOST --confirm digital-employee-connect。安装器把完整自有目录移动到备份区，不删除备份。原生界面安装的 Skill 使用其删除入口。之后检查目录、列表及新任务加载状态；不要批量清理。

## 绑定或执行业务请求

明确告知“当前分发预览尚未提供平台绑定/数字员工执行”，返回 FEATURE_NOT_AVAILABLE。不要猜测授权 API、延长旧会话、要求用户粘贴 Token、读取网页登录 Cookie，或用内置浏览器/任意 shell 模拟已经接入。

后续绑定版本需要已批准的设备协议、平台发布及宿主真实执行证据。公共 Skill 不包含个人账号、企业信息、密码、设备凭证或生产配置。
