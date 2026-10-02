# 原生 helper 协议

所有命令固定为同一个 core.mjs COMMAND --host qoder|kimi；无需平台 URL、安装根或凭证参数。初次无 Node 时 bootstrap.ps1 使用固定 Node 24.18.0 SHA-256；不使用宿主私有运行时，不安装全局软件。

| 命令 | 输入 | 输出 |
| --- | --- | --- |
| connect | 无 | 打开用户连接页，返回安全状态 |
| status | 无 | 员工、会话、设备状态；nativeActivation 仍 NOT_VERIFIED |
| next | 无 | null 或 {id,prompt,expiresAt}；最长等待 20 秒 |
| respond | stdin JSON：{turnId,response} | {accepted:true} |
| run | stdin JSON：{prompt} | {id,kind:"run",state:"pending"} |
| result | stdin JSON：{jobId} | pending、done 加结果，或 error 加受控错误码 |
| close | 无 | {closing:true}，撤销短会话并关闭本地 Runtime |

respond 的 response 必须有且仅有七个字段：

~~~json
{"kind":"loaded","skillId":"从当前 turn 读取","skillVersion":"从当前 turn 读取","acknowledgment":"从当前 turn 读取","capability":"","paramsJson":"","text":"概述已读取 manifest 的实际工作流程"}
~~~

loaded、request、done 的字段内容以当前 prompt 为准；loaded 的 text 必须是非空的真实工作流程摘要，不能原样使用示例占位文字。request 用 capability 和 paramsJson 提交 Runtime 能力；done 的 text 是任务最终说明。七字段均是字符串，kind 只允许上述三值。JSON 通过 stdin 传递，引用规则按当前原生 shell；不把网页文本拼进可执行命令。不要把设备、控制或 Runtime management secret 加进这些字段。

收到 run job 后持续交替 next/respond，并查询 result，直到 done/error 或关闭。仅重新发送未改变的同一次 next 输出不代表加载成功；每次加载包含独立 nonce。未知 turn ID、重放、过期、跨宿主回执和未经用户许可的 capability/origin 都会拒绝。

状态只证明 helper 协议状态。必须另行确认原生 Skill 加载、真实业务结果和宿主硬限制；模拟 Host 回执不计作这些 Gate 的 PASS。
