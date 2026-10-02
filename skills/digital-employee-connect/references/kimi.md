# Kimi Work

host 固定为 kimi。可使用当前客户端“插件 → 技能 → 自定义技能 → 上传技能”导入完整 Skill ZIP；实际入口和加载需现场核实。目录候选是 Roaming/kimi-desktop/daimon-share/daimon/skills/digital-employee-connect；不得回退 .kimi/skills 或 Kimi Code CLI。

新任务中原生选择此 Skill，再运行 connect。设备身份与 Qoder 分开，保存在当前 Windows 用户 LocalAppData/DigitalEmployee/kimi；便携包共用 LocalAppData/DigitalEmployeeClient。

用户本人在网页确认设备、员工和任务权限。Kimi 只消费 [helper turn](native-helper.md)，不得直接执行员工浏览器业务。原生上传安装使用原生界面更新/卸载，本地安装器不接管无 receipt 内容。保留原生工具审批，不修改全局安全设置；文件校验不能替代原生加载和权限限制 Gate。
