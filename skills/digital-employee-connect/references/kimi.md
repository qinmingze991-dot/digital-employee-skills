# Kimi Work

host 参数固定为 kimi。不要把 Kimi Code CLI 的 ~/.kimi/skills/ 当成 Kimi Work 的活动目录。

## 原生安装优先

在 Windows Kimi Work 中，打开“插件 → 技能 → 自定义技能 → 上传技能”，上传完整 Skill ZIP 或 digital-employee-connect 文件夹。只上传 SKILL.md 会丢失 helper、manifest 和 references；这时不能运行完整性检查或安装管理功能。

安装后检查“已添加”列表，再打开卡片点“使用”，在新任务中报告当前安装版本。UI 出现卡片只证明发现；收到实际原生调用结果才证明本次加载。

官方产品说明：[Kimi Work 插件中心](https://www.kimi.com/help/kimi-work/plugin-center)。具体菜单以当前客户端为准。

## 本地 helper

Windows 已观察到的 Work 活动根：

~~~text
%APPDATA%/kimi-desktop/daimon-share/daimon/skills/
~~~

helper 只在这个既有根确实存在时使用；不创建一个猜测的 Kimi 根，也不修改 Daimon 配置或插件注册。支持命令：

~~~text
node <Skill目录>/scripts/core.mjs doctor --host kimi
node <Skill目录>/scripts/core.mjs plan --host kimi
node <Skill目录>/scripts/core.mjs install --host kimi
node <Skill目录>/scripts/core.mjs verify --host kimi
~~~

直接文件安装是否被当前运行的 Work 发现，仍需原生界面/新任务验证；不能承诺后台热加载。

## 更新与故障

原生上传的安装由原生界面更新/删除。helper 检查文件时会返回 managedByInstaller=false，不凭目录存在接管覆盖。

若已由 helper 安装，可以按 plan 和 install --replace 更新，并保留备份。客户端账号到期、额度不足或生成服务报错时，安装/调用 Gate 未完成；恢复账号后再验证，不因界面泛化提示断言服务故障。

保持默认执行权限。当前预览不启动非交互 YOLO 模式，不要求账号密码，不导出 Cookie，不发起正式设备绑定。
