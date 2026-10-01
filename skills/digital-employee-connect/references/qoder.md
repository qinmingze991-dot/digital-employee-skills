# Qoder IDE

host 参数固定为 qoder。当前 helper 仅支持 Windows。

Qoder IDE 官方文档给出的用户级目录为 ~/.qoder/skills/digital-employee-connect/，项目级目录为 .qoder/skills/digital-employee-connect/；同名项目级 Skill 优先。本安装器只处理用户级目录，不修改项目或插件注册索引。

官方说明：[IDE Skills](https://docs.qoder.com/extensions/skills)。这是目录协议来源，不保证所有客户端版本的加载方式相同。QoderWork 是另一产品，其 ~/.qoderwork/skills/ 不能代替 IDE 目录。

## Agent 操作

用户可把 GitHub 仓库链接交给 Agent，请求安装 digital-employee-connect。取得指定版本的完整发布包，阅读 Skill 与脚本后，用包内已有 Node helper：

~~~text
node <Skill目录>/scripts/core.mjs plan --host qoder
node <Skill目录>/scripts/core.mjs install --host qoder
node <Skill目录>/scripts/core.mjs verify --host qoder
~~~

上述命令由有权限的 Agent 执行；普通用户无需手动 npm、配置 Runtime 或复制 Token。目录不存在/路径为 junction 或符号链接/权限不允许时，保留错误；不修改权限开关来绕过。

## 加载确认

新建聊天，输入 /，查找 digital-employee-connect，选中后要求报告当前安装版本。记录选择界面和实际结果。若未出现，检查是否存在同名项目级 Skill，以及当前 IDE 的原生 Skills/Plugins 机制。

官方手动目录说明要求重启 IDE 才刷新。只在实际需要时让用户正常重开客户端，不点击升级、不自动重启有未保存内容的窗口。写入成功但仍未加载时，状态保留“文件安装完成，原生加载待验证”。

安装器不操作插件 cache/注册 JSON，不以其他插件安装菜单或 JetBrains 插件说明替代本 Skill 的加载证据。
