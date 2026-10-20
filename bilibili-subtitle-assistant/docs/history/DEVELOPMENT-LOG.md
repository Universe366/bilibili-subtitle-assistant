# 开发日志（逐轮缺陷与修复）

> 这是**历史记录**，不是当前行为说明。里面保留了当时试过、后来撤掉的方案
> （例如 Edge 商店上架、仓库 private/public 切换、旧版本号），因此会与当前版本矛盾。
> 当前发行方式、安装步骤与功能以 [`../../README.md`](../../README.md) 和
> [`../../CHANGELOG.md`](../../CHANGELOG.md) 为准。
>
> 这份文件记录每一轮改了什么、为什么改、以及**踩过什么坑**。
> 它的价值不在「做了什么」，而在「**为什么当时那么想是错的**」—— 避免重复犯错。
> 按时间倒序阅读没有意义，建议按主题搜索（例如「Content-Type」「超时」「CSP」「service worker」）。

## 本轮修掉的关键缺陷（都由这些测试兜住）

1. **`collectFromPage` 读错了 RPC 返回层级**（拿 `res.data` 而不是载荷本身）→ 页面侧字幕轨永远被当成 0 条，只能走接口兜底，用户看到的就是「字幕提取不了」。现已兼容两种信封形状。
2. **wbi 签名的 MD5 实现是错的**（移位表 / 常量表凭记忆写，且用浮点加法）→ `w_rid` 永远不对，`player/wbi/v2` 必失败。已重写为逐位对齐 RFC 1321，并用 node `crypto` 交叉验证。
3. **正文 JSON 形状只认一种**（`json.body`）→ `data.body` / `result.body` / 纯数组全部解析失败。现统一走 `extractLines`，并加「像不像字幕行」的判定，避免把字幕轨列表误当正文。
4. **顶部操作区不再重绘** → 抓到字幕后主按钮与状态胶囊仍显示旧状态。已改为订阅 store 按签名重绘。
5. **`fetchSubtitleBody` 手工解析字段** → 改为统一 `extractLines`，兼容 `{body:"纯文本"}`。
6. **全来源网络失败被伪装成「没有字幕」** → 现在明确报「B 站接口全部请求失败」，避免误导用户去点语音转录。

## 第二轮（1.2.0）修掉的问题

1. **音轨下载必然 403** —— `Referer` / `Origin` / `User-Agent` 是 Fetch 的 **forbidden header**，在 service worker 里设置会被**静默丢弃**，而 B 站音轨 CDN 校验 Referer。因为发起方一直是扩展源，**刷新页面也无效**。已把音轨抓取整体搬到**页面主环境**（`fetchAudioRange`，只带 `Range`、`credentials: omit`，Referer 由浏览器自动生成），并按「嗅探到的 playurl > `__playinfo__` > `__INITIAL_STATE__` > 播放器 API」排序候选、`mirrorcos` 节点降权、403 时刷新地址 + 换节点重试 4 轮；同时加 `rules.json`（declarativeNetRequest）兜底补 Referer。
2. **硅基流动「测试连接」400** —— 该接口只接受 `multipart/form-data` 且**只有 `file` + `model` 两个字段**（多传 `response_format` / `language` 会 400），返回也**只有纯文本、没有时间戳**。已改为「最小参数优先 + 400 阶梯降级」，并把默认配置从错误的 `base64-json` / `audio` 纠正为 `multipart` / `file`，模型列表去掉不存在的 `whisper-large-v3`。
3. **字号缩放显示不合适** —— CSS 里大量 `calc(var(--fs) - 3px)` 在缩放/大字号下会挤出过小或错位的字。已全部改为按 `--fs` 比例缩放（`* 0.82`…`* 1.25`），行高与固定高度也改成相对单位。
4. **默认布局** —— 改为**单列堆叠**（原默认 `auto` 在宽侧边栏下会变双列，反而不好读）。
5. **平台列表太长** —— AI / 语音识别 / 检索三处的平台由「平铺所有卡片」改为**下拉框选择**，只显示选中那一家的配置，高级项收进「高级设置」。

## 第三轮（1.3.0）

1. **ASR「测试连接」被误报为配置错误** —— 两条问题：① `minimal` 风格（硅基流动）本来只有一种正确请求形态，降级阶梯却又拿「带 language」重撞一次同样的 400，还把真正的服务端消息埋掉；② 探活用的是 0.6 秒静音，短音频/无语音内容会被服务端判 400，于是「参数其实没问题」也被报成配置错误。现在：minimal 只发一枪、错误里带上**服务端原始响应体**（`err.payload.detail`）、探活改用 1.5s→3s 递增，并把「未检测到语音」这类提示识别为**接口可达**。
2. **多分 P 视频的字幕来源纠错** —— 官方接口在多分 P 视频上可能返回**整段视频**的字幕轨（实测 824 行 / 到 1589s，而当前分 P 只有 568s），被时长校验拒用。现在会标记 `wrongPart`，然后**自动再点一次播放器字幕菜单**拿带 cid 的正确字幕并重试；失败提示也从「没有可用字幕」改成「接口字幕疑似来自其它分 P，请先播放几秒再抓」。
3. **DNR 规则收窄** —— 原规则会 `remove: Origin` 且匹配 `media` 资源类型。前者会触发扩展 origin 与 B 站 `Access-Control-Allow-Origin` 的比对失败，后者可能干扰播放器自身的音视频流（即用户报的「开启插件后视频加载不出来」）。现在**只加 Referer、不动 Origin、不匹配 media**。
4. **主环境桥加透明性回归测试** —— 新增 `bridge-transparency-test.mjs` 18 项，锁死「桥不得改变页面自身请求语义」。
5. 顺带修掉 `validateLines` 里 `kind` 常量的拼写错误（`overtun` → `overrun`）。
6. **ASR 400 的真正原因锁定为「模型名不属于该平台」** —— 实测 `model=XingChenAGI/XingChenGSR-V1.0`（别家的模型名）在硅基流动上返回 **400 且响应体为空**，几乎无法自行诊断。现在空响应体的 400 会**主动去查该平台的 `/models`**，在错误详情里写明「模型列表里没有 xxx」并列出可用的语音识别模型；设置页也加了 **「核对模型」** 与 **「选择模型」** 两个按钮。
7. 新增 `asr-e2e-test.mjs`（16 项）把上面这段**用户可见文案**固定下来，避免以后改文案时又退回成无法诊断的静态建议。

## 第四轮（1.4.0）

**用户反馈：同一个模型 `XingChenAGI/XingChenGSR-V1.0`，Bilitato 能转录，本扩展 400。** 说明「模型名不属于该平台」这个判断是错的 —— 模型是好的，是**请求形态**不对。

1. **新增第三种传输方式 `chat-audio`** —— `POST /chat/completions`，`messages[].content[].input_audio.data = data:audio/wav;base64,...`（小米 MiMo 用的是这个形态，也是「以对话接口暴露 ASR 能力」的模型的通用做法）。
2. **传输方式自动阶梯** —— 用户不必先猜平台用哪一种：400/415/422 时会依次尝试 `multipart` → `base64-json` → `chat-audio`（以所选方式为首选，其余作为兜底）。这一条直接修掉用户的场景：原生 `/audio/transcriptions` 被拒后自动改走 `/chat/completions` 并成功拿到文本。
3. **`normalizeAsrResult` 支持 `choices[].message.content`**（字符串与分段数组两种）——之前只认 `text` / `segments` / `words` / `results`，即使对话接口返回成功也会被解析成空文本。
4. **错误文案重写** —— 不再断言「模型只能是 X/Y」，改为陈述事实：列出**实际尝试过的每一种传输方式及其完整 URL**、最后一次的服务端返回，再分两种情况给结论：模型不在列表里（附可用模型）／模型在列表里但所有形态都被拒（提示可能是探测样本太短）。
5. **设置页补齐** —— 语音识别「高级设置」里的「请求方式」增加 `chat-audio`，并新增「参数风格」（自动 / 最小 / 完整）显式选项。

## 第五轮（1.5.0）

用户拿到了服务端的真实回复，推翻了第四轮的推断：

```
{"code":20012,"message":"Model does not exist. Please check it carefully."}
```

同时又说明 `/models` 里**存在**这个 ID。两条信息合起来说明：这个模型存在，但**不能用于语音识别**（或 ID 与平台里的写法不完全一致）。第四轮「它走对话接口所以要用 chat-audio」的推断已被实测否证 —— 三种传输方式都被同一个业务错误拒绝。

1. **服务端消息优先** —— 400 家族里，只要响应体给了明确原因（如 `Model does not exist` / `No speech detected`），就直接采用，不再叠加自己的猜测。只有响应体为空时才完整走 `/models` 推断。
2. **两分支结论** ——
   - 模型**在** `/models` 列表里，但转录接口说它不存在 → 明确告诉用户「该模型不是语音识别模型（例如是对话/向量模型）」，并列出该平台可用于转录的模型。
   - 模型**不在**列表里 → 用归一化比较（忽略大小写与 `._-` 分隔符）给出**名称最接近的候选**，并把最可能的那个准确 ID 直接放进操作建议里，方便复制。
3. **去掉绝对化结论** —— 之前错误提示写死「模型只能是 FunAudioLLM/SenseVoiceSmall 或 TeleAI/TeleSpeechASR」，这在用户遇到自定义模型时是误导。现在只陈述「实际尝试了什么、服务端回了什么」。
4. 新增回归测试：`asr-test` 增加两组——服务端 `Model does not exist` 且模型在列表里（断言提示指向「不是语音识别模型」）、模型名有细微差异（断言给出最接近候选与可复制的准确 ID）。

## 第六轮（1.6.0）

用户进一步确认：**「核对模型」显示 `XingChenAGI/XingChenGSR-V1.0` 在该平台可用，共探测到 98 个模型」**，但转录仍 400。三条信息（`/models` 有、转录接口 400 空体、对话接口 `20012 Model does not exist`）合起来说明**请求没落到那个模型上**。

1. **域名互换兜底** —— 硅基流动有 `.cn`（国内）与 `.com`（国际）两个域名，**模型目录不同**，从别处抄来的 ID 很可能只在其中一个下存在。现在阶梯末尾会自动换到另一个域名再试（multipart 与 chat-audio 各一次）。只对确实存在双域名的服务生效（`api.siliconflow.cn|com`），避免把 `api.deepseek.com` 拼成不存在的 `api.deepseek.cn`。
2. **错误详情列出「实际请求过的每一个 endpoint」** —— 之前按传输方式去重，换域名后的 URL 被折叠掉了；现在按 `传输方式@URL` 去重，用户能看到究竟打到了哪些地址，从而判断是域名问题还是模型问题。
3. 新增测试：`.cn ⇄ .com` 互换与「其它服务不做互换」、模型只在 `.com` 可用时自动切换并成功、全失败时错误里同时出现两个域名的 endpoint。

## 第七轮（1.7.0）

用户改配置后拿到 `401 {"code":30014,"message":"Token is invalid."}` —— 与前面几轮的 400 完全不同的失败类别。

1. **401/403 的错误提示改为可自证** —— 显示**当前使用的 Key 的长度与末四位**（不泄露完整密钥）、是否检测到粘贴时带了首尾空白/换行，并列出三类常见原因（Key 被删除/重置、复制漏字符、**国内站与国际站的 Key 不通用**）。操作建议改成「点清除后重新完整粘贴」。
2. **统一错误上下文** —— 新增 `platformCtx(platform)`，把平台名、裁剪后的 Key、以及「裁剪前后长度是否变化」一起传给 `classifyHttp` / `classifyNetwork`，替换掉散落的 `{ platformName }`。
3. 新增测试：401 归类为 `auth`（不是参数错误）、提示里含服务端原文与 Key 指纹、检测到首尾空白、建议为「清除后重新粘贴」、并断言**不会把完整 Key 泄露到提示里**。

## 第八轮（1.8.0）

用户确认 Key 来自 `cloud.siliconflow.cn`（国内站），重新复制后仍然 401。

1. **「核对模型」现在会报告数据来源** —— 之前成功时只说「共探测到 N 个模型」，看不出是**哪个地址**、用**多长的 Key** 拉到的。现在 `listModelsWithSource` 会把 `url` / `baseUrl` / `keyLength` 一并返回，toast 里显示 `· https://api.siliconflow.cn/v1/models（Key 长度 51）`。这样就能区分「鉴权通过、但没有这个模型」和「地址或 Key 配错」。
2. **兜底列表明确标注** —— 平台不支持 `/models` 时返回内置建议，现在会明确写「下面显示的是内置建议，不代表平台真实可用模型」，避免把内置列表误读成探测结果。
3. **成功提示补一句** —— 「核对模型」成功时会提示「能列出 ≠ 能用于语音识别，仍需『测试连接』确认」，因为 `GET /models` 返回的是账号可见的完整目录（含对话、向量模型）。

## 第九轮（1.9.0）

用户重新从 `cloud.siliconflow.cn/me/account/ak` 复制 Key 后仍 401（长度 51，末四位 `adbr`，格式正常）。此前「核对模型」曾成功返回 98 个模型，说明那个时刻 Key 有效 —— 两次操作的 Key 必然不同，但这一点此前无法自证。

1. **鉴权失败时用 `/models` 做对照实验** —— 401/403 时立刻用**同一个 Key** 打一次 `GET {baseUrl}/models`，并据结果给出确定结论：
   - `/models` 通 → 「✅ Key 有效，问题出在这个语音识别接口/模型上，与 Key 无关」
   - `/models` 也 401 → 「❌ Key 本身无效，与模型和请求形态无关，请到控制台重新生成」
   
   这样「Key 到底有没有问题」不再需要用户自己推断。
2. 新增测试：401 时会发起 `/models` 对照、两种情况分别给出正确结论、结论里注明「与模型和请求形态无关」。

## 第十轮（1.10.0）

对照实验的输出给出了决定性线索：**❌ 行里的地址是 `api.siliconflow.com`（国际站）**，而用户的 Key 来自 `cloud.siliconflow.cn`（国内站）。**接口地址与 Key 不属于同一个站** —— 这才是连续 401 的根因。硅基流动国内站与国际站是两套独立账号，Key 互不通用。

1. **401 提示点名是「哪个站」** —— 结论改为「这个 Key 在 `api.siliconflow.xxx` 这个站上无效」，并附上「当前配置的接口地址」。
2. **直接给出两站配对表** —— `cloud.siliconflow.cn/me/account/ak` 的 Key 必须配 `https://api.siliconflow.cn/v1`；`cloud.siliconflow.com/` 的 Key 必须配 `https://api.siliconflow.com/v1`，并明确「两个站点的账号与 Key 互不通用，Key 有效但站点配错时表现就是 401」，同时建议「把接口地址改成另一个站再试」。
3. 新增 4 项测试：点名站点、显示当前配置地址、两站配对同时出现、说明互不通用。

## 第十一轮（1.11.0）

用户反馈错误里「当前配置的接口地址」**仍然是 `https://api.siliconflow.com/v1`** —— 即手改地址没有生效（或又被改回）。手写/粘贴 URL 容易出错，且出错后的表现是难自查的 401。

1. **接口地址一键切换** —— 设置页「接口地址」旁新增按钮（`改用 api.siliconflow.cn` / `改用 api.siliconflow.com`），面板侧与后台用同一份双站点白名单（`api.siliconflow.(cn|com)`），避免手改字符串。
2. **地址旁的动态说明** —— 当前是国内站时提示「**必须使用 cloud.siliconflow.cn 申请的 Key**」；是国际站时提示「**必须使用 cloud.siliconflow.com 申请的 Key**」，直接把配对关系写在填写处。
3. **401 提示追加站点配对段** —— 从 `platformCtx` 带上 `baseUrl`，401 时在错误详情里追加「当前接口地址是 xxx，两站 Key 互不通用」以及两站的申请地址与配对，并提示可用一键切换。
4. 新增测试：提示里同时出现两站的申请地址与配对、以及一键切换按钮名。

## 第十二轮（1.12.0）

用户贴出的错误**自相矛盾**，暴露出我的诊断代码有 bug：

```
⚠ 当前接口地址是「api.siliconflow.cn」        ← ctx.baseUrl（设置里的值）
❌ 同一个 Key 访问 GET https://api.siliconflow.com/v1/models ...   ← plan.baseUrl
当前配置的接口地址：https://api.siliconflow.com/v1   ← 把 plan.baseUrl 误标成「配置的」
```

根因：走了「换域名」兜底时，失败请求打的是 `plan.baseUrl`，但对照探针与文案都用它冒充「设置里的地址」，**两个不同的值被混为一谈**，结论自然不可信。

1. **把两个地址分开显示** —— 401 提示里现在分别列出「本次请求实际打到的地址（含走了哪一档兜底）」与「设置里配置的接口地址」，并在二者不同时明确标注「本次走了『换域名』兜底」。预先为每个 plan 计算 `plan.url`，避免展示时再推算。
2. **新增「连通性诊断」按钮** —— 对**每个可能的主机 × 每种传输方式**（`GET /models`、`multipart`、`chat-audio`）各发一次请求，把**状态码与响应摘要**列成表格。这是把「哪个地址能用」变成可直接阅读的事实，而不是继续推断。不消耗额度（用的是 1.5 秒静音）。
3. **两站都 401 时的明确口径** —— 提示里写清：如果两个站都返回 401，说明 Key 在两个站上都不被接受，应重新生成，而不是继续换地址。
4. 新增测试：诊断矩阵覆盖两个主机、每台主机测三种请求（共 6 行）、`.cn` 的 `/models` 记成功并给出模型数、`.cn` 转录接口记 400 与响应体、`.com` 记 401、带回 Key 长度与末四位。

## 第十三轮（1.13.0）

用户把模型换成 `FunAudioLLM/SenseVoiceSmall` 后，诊断矩阵出现关键一行：

```
❌ multipart → https://api.siliconflow.cn/v1/audio/transcriptions   500   （空响应体）
```

**500 与 400 是本质不同的信号**：400 是「参数被拒」，服务端根本没动模型；500 是「服务端在转录这一步内部出错」。同一接口对 XingChen 返回 400（模型不存在）、对 SenseVoice 返回 500，说明**这次请求已经通过鉴权与参数校验，打到了模型**。

1. **诊断矩阵增加样本长度维度** —— 每种传输方式分别用 1.5s 与 5s 静音各测一次（共 10 行），用来判断 5xx 是否与样本本身有关。
2. **5xx 行内直接解释** —— 状态码 ≥500 时在该行追加说明：「这是服务端内部错误（不是参数被拒），说明鉴权与请求已通过，是服务端在转录这一步出错 —— 通常和音频样本本身有关」。
3. **结论按证据分级** —— 原来只有「有 ✅ / 全 401」两种口径，现在按实际行分四类：有转录成功 / 鉴权通但 5xx（服务端问题，建议用真实音频验证）/ 鉴权通但 400（模型名不被转录接口接受）/ 全部 401（站点或 Key 不匹配）。
4. 新增测试：矩阵行数变为 10、覆盖两种样本长度。

## 第十五轮（1.15.0）

用户报「没有拿到音轨地址」，且诊断里显示「**没有拿到页面侧的诊断信息**」——而这次调用明明是往返成功的。这个组合指向一个具体机制：

**主环境注入脚本（`page-bridge.js`，`world: "MAIN"`）在扩展更新后无法热替换。** 隔离环境的内容脚本可以通过 `chrome.scripting` 重新注入，但已经在页面里运行过的 MAIN world 脚本不会更新。旧版桥没有 `getAudioCandidates` / `diag`，于是：

- 面板拿到的 `diag` 是 `undefined` → 显示「没有拿到页面侧的诊断信息」
- 而错误被上层吞掉 → 最终显示成「页面里没有音轨」

1. **`audio.candidates` 不再吞错误** —— 后台把桥接失败转成结构化的 `diag.bridgeError` 返回，面板在错误详情里原样展示「桥接错误：…」。
2. **旧版桥可被识别** —— `handleRequest` 遇到未知方法时返回 `kind: 'stale-bridge'`，并带上 `bridgeVersion`（当前页面里脚本的版本）与 `supported`（它实际支持的方法列表）；桥另外暴露 `supportedMethods()` 供自查。
3. **操作建议按原因区分** —— 识别为桥版本过旧时，建议改为「**按 F5 刷新这个 B 站页面**：扩展更新后，已经在页面上运行的注入脚本不会被自动替换」，而不是笼统的「播放几秒」。
4. 新增 5 项测试：未知方法标为 `stale-bridge`、带版本、带支持列表、建议为刷新页面、`supportedMethods()` 可自查。

## 第十六轮（1.16.0）

错误详情给出了确实的答案：**`内容脚本不支持该方法 getAudioCandidates`** —— 而且是**隔离环境的内容脚本**（`content.js`）在报，不是主环境桥。

根因是**多版本共存导致版本握手无法收敛**：

1. 扩展更新后，页面里残留旧版 `content.js`
2. `ensureContentScript` ping 到旧版本 → 调 `chrome.scripting.executeScript` 注入新版
3. 于是页面里**同时存在新旧两份** `content.js`，各自注册了一个 `chrome.runtime.onMessage` 监听器
4. `chrome.tabs.sendMessage` 只把**第一个响应者**的结果带回来 —— 那是先注册的**旧版**
5. 后台于是永远读到旧版本，反复注入、永远修不好，最终报成「内容脚本不支持该方法 xxx」

1. **注入前先写「期望版本」** —— `injectContentScripts` 第一步用 `func` 注入写入 `window.__bsub_expected_version__ = CONTENT_VERSION`。
2. **旧脚本据此主动退休** —— `content.js` 在启动时与**每次收到 ping 时**都检查该标记；发现自己版本更低就设置 `state.retired`，此后**不再应答任何消息**（包括 ping 与 `bsub:to-content`），让新脚本接管。握手因此可以收敛。
3. 新增 3 项测试：版本一致时正常应答 ping、写入更高期望版本后旧脚本**停止应答 ping**、退休后**不再处理内容请求**。
4. 顺带把 `content-test` 里 jsdom 的 `Not implemented:` 报错过滤掉（那是 jsdom 没有实现媒体播放，属环境限制，不是被测代码的问题）。

## 第十七轮（1.17.0）—— 已经找到「没有拿到音轨地址」的真正原因

用户报错原文：**`内容脚本不支持该方法 getAudioCandidates`**（注意是**内容脚本**，不是主环境桥）。

根因：`content.js` 的 `handle()` 是一个**显式白名单**（switch + 少量 case），而 `getAudioCandidates` / `refreshAudio` / `fetchAudioRange` / `getSubtitleBundle` / `triggerSubtitleMenu` / `setOverlay` 这些**只存在于主环境桥**的方法从未登记进去。后台请求它们 → 内容脚本 default 分支 → 「内容脚本不支持该方法」。**桥其实完全支持。**

之前的测试全都直接调用被 mock 的 `page.call`，**从未走通 `content.js` 的转发链路**，所以这个洞一直没被发现。

1. **`content.js` 增加 `PASSTHROUGH` 白名单** —— 音轨（`getAudioCandidates` / `refreshAudio` / `fetchAudioRange`）、字幕（`getSubtitleBundle` / `triggerSubtitleMenu`）、覆盖层（`setOverlay`）以及其它页面能力统一显式转发，并各自带合理超时（`fetchAudioRange` 180s）。
2. **新增 `method-contract-test.mjs`（12 项）** —— 交叉核对三份独立维护的白名单：**主环境桥支持的方法** vs **内容脚本转发的方法** vs **后台会请求的方法**。任何一处漏同步都会让测试失败。同时把内容脚本本地实现的方法（`applyOptions` / `setOverlayLines` / `clearOverlay` / `getOptions`）列为显式豁免。
3. **`content-test` 增加真实转发链路测试（4 项）** —— 经 `content.js` 逐个调用后台会请求的页面方法，断言不出现「内容脚本不支持该方法」；并验证 `getAudioCandidates` 真的能拿到候选与结构化诊断。（测试里给页面补了 `__playinfo__` 以走快速路径，避免 jsdom 无网络时卡在 playurl 刷新。）
4. 顺带修正 `content-test` 内部顺序问题：多版本去重那段会让脚本「退休」，必须放在所有能力测试**之后**，否则后续请求全部超时。

## 第十八轮（1.18.0）

音轨问题修好后，转录推进到 ASR 层，报服务端 500：**`平台「硅基流动（SiliconFlow）」 返回 500`**。

1. **5xx / 网络错误自动重试** —— `callAsr` 增加重试（间隔 1.2s、3s，共 3 次尝试）。5xx 与网络抖动多为瞬时故障，重试有意义；**4xx 不重试**（参数/模型/鉴权问题，重试无意义，而 429 重试还会加剧限流）。
2. **重试策略提到共用位置** —— 新增 `isRetriableAsrError(payload)` 与 `ASR_RETRY_DELAYS_MS`（`providers.js`），面板与后台共用同一份判定，避免两边策略漂移。
3. **重试过程可见** —— 每次重试都会往转录日志写一行「第 N 片…正在重试（第 k 次）」，用户能看出是在重试而不是卡死。
4. 新增 11 项测试：5xx / 网络 / 超时 / 裸 5xx 状态码可重试；400 / 401 / 413 / 429 不可重试；空 payload 不重试；重试间隔递增。

## 第十九轮（1.19.0）

用户问「**同样的视频，为什么 Bilitato 可以转录？**」—— 直接读参考实现比继续推断有效。

**读 `ref2/offscreen.js` 的结论**：

- Bilitato 的硅基流动请求（`requestSiliconFlowChunkTranscription`，478-496 行）与本扩展**逐项一致**：同一个 URL、`FormData` 只放 `file` + `model`、只有 `Authorization` 头。
- **差异在音频**：Bilitato 用 FFmpeg 生成切片，输出扩展名 `.m4a`，编码参数 `["-c:a","copy","-movflags","+faststart"]` —— 即**直接复用原始 AAC 流**（只有小米 MiMo 那条转成 mp3）。本扩展则是把音轨解码成 PCM 再封装 **16 kHz 单声道 WAV**。

1. **文件名与扩展名透传** —— 之前 `callAsr` 传的 `filename` 在后台被丢弃，服务端收到的名字始终是内部生成的；现在从 `transcribe.js` → `asr.transcribe` → `transcribeSlice` 一路透传，并按扩展名自动匹配 mime（`.wav`/`.mp3`/`.m4a`/`.ogg`/`.webm`）。
2. **转录日志打印音频电平** —— 切片后计算并输出**峰值 / RMS**，峰值 ≈ 0 时直接标注「几乎全是静音，服务端可能因此报错」。静音是 ASR 服务端 5xx 的常见来源，有了这个数字不必再猜。
3. 新增 2 项测试：调用方指定的文件名被采用、未指定时也带扩展名。测试桩升级为记录 `File.name`（否则断言不到文件名）。

## 第二十轮（1.20.0）—— 按 Bilitato 的做法改用 M4A

用户问「**同样的视频，为什么 Bilitato 可以转录？**」→ 去读参考实现，而不是继续推断。

**读 `ref2/offscreen.js` 的结论**：Bilitato 的硅基流动请求与扩展**逐项一致**（同 URL、`FormData` 只放 `file` + `model`、只有 `Authorization`）；**差异在音频**——它用 FFmpeg 生成 `.m4a`（`["-c:a","copy","-movflags","+faststart"]`，即复用原始 AAC），扩展上传的是自封装的 16 kHz WAV。这就解释了为什么参数全对却 500：**服务端解码 WAV 时崩了**（参数校验是过的，所以不是 400）。

1. **浏览器能力先探明** —— 写 CDP 探测脚本在真实 Chrome 里跑：`MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2') === true`（`AudioEncoder` 的 `mp4a.40.2` 反而是 `false`）。实测 12s 音频 → 12.5s 产出 `ftypisom` 合法 MP4。
   - 注意：headless 加 `--virtual-time-budget` 会让 `MediaStreamAudioDestinationNode` 录出 0 字节，必须走 CDP 用真实时钟。
2. **新增 `encodeSliceToM4a()`** —— 用 `AudioBufferSourceNode` → `MediaStreamAudioDestinationNode` → `MediaRecorder('audio/mp4;codecs=mp4a.40.2')` 把 PCM 编成 MP4/AAC，产出前校验偏移 4 处是 `ftyp`，否则返回 null 退回 WAV。支持 `AbortSignal`。
3. **按平台自动选格式** —— `prefersM4a(platform)` 判定（`audioFormat` 显式配置优先；否则硅基流动 / `sensevoice` / `telespeech` 走 M4A）。开始前如实提示「浏览器只能实时编码，预计额外耗时约 N 秒」。编码不可用或失败自动退回 WAV。
4. **默认配置与设置页** —— 硅基流动默认 `audioFormat: 'm4a'`；设置 → 语音识别 → 高级设置新增「上传音频格式」（自动 / WAV / M4A）。
5. **新增 `m4a-encode-test.mjs`（6 项）** —— 在**真实 Chrome**里加载扩展的 `audio.js` 本体（起本地 HTTP 服务，因为 ES module 不能用 `file://` 导入），断言：可编码、产出非空、是合法 MP4（`ftyp`）、静音也能编、WAV 分支仍正常（`RIFF`）、实时速度约 1x。

## 第二十一轮（1.21.0）

用户给出关键数据：**`音频电平：峰值 76.3%，RMS 11.14%`** —— 音频有人声，**排除静音**这个可能。同时 500 的**响应体是空的**（服务端没给原因）。整体看：Key 有效、地址正确、参数正确（否则是 400/401）、音频有内容 —— 仍 500。

这一轮集中修「失败时看不到任何信息」这个硬伤：

1. **失败也保留转录日志**（重要）—— 之前 `transcriptLog` 只在**成功**路径写入，所以一失败日志就丢了，用户报错时无法提供任何细节（这也是前几轮我一直拿不到日志的原因）。现在 catch 分支会把 `logLines` 写进 `subtitleError.detail`，点「查看明细」即可看到「它做到哪一步、发了什么」。
2. **日志打印实际上传内容** —— 第 1 片会写一行「第 1 片上传：slice-001.m4a，75.2 KB（MP4/AAC）」，明确格式与体积。
3. **5xx 错误消息说清性质** —— 指出「鉴权与参数校验均已通过（否则会是 401/400），是服务端在处理音频时出错，已自动重试仍失败」；响应体为空时明确写「（响应体为空，服务端没有给出原因）」；硅基流动另附换模型建议。
4. 新增 3 项测试：502 归类为 `server`、`isRetriableAsrError` 对 5xx 返回 true、5xx 提示里说明是服务端问题。

## 第二十二轮（1.22.0）—— 日志终于给出答案，同时修掉两个我自己的 bug

用户提供的转录日志（第一次真正拿到完整过程）：

```
音轨候选 6 条（其中 1 份来自页面 playurl 嗅探）
音轨：audio/mp4 带宽 65714 来源 playurl-sniff(wbi) host upos-sz-estgoss.bilivideo.com
下载完成：3.3MB，用时 1.9s
解码完成：2 声道 / 48000Hz / 415.6s
切片计划：2 片，每片 300s，重叠 4s
该平台按 M4A（MP4/AAC）上传。浏览器只能实时编码，预计额外耗时约 420 秒
音频电平：峰值 80.4%，RMS 7.89%
第 2 片服务端错误，正在重试（第 1 次）
第 2 片服务端错误，正在重试（第 2 次）
```

**关键信息：失败的是「第 2 片」。** 415.6s 的音频切成 2 片，第 1 片没报错 —— 说明凭证、地址、请求格式、M4A 编码**全都是通的**。这推翻了之前所有关于「格式/参数/Key」的怀疑。

### 修掉的两个 bug

1. **误导性的 401 结论** —— 换域名兜底后，对照探针打在了**兜底地址**（`.com`）上，于是报告「这个 Key 在两个站上都不被接受」，让用户去重新生成 Key。而配置地址（`.cn`）上的 Key 其实是有效的。现在对照探针一律打在**配置地址**上，并区分结论：配置地址通 → 明确说「Key 有效，真正的问题是配置地址上的请求被拒（额度/权限）」，且**不再引导用户重新生成 Key**。
2. **中途失败没有归因** —— 之前只报最后一片的错误，看不出「前面已经成功过」。现在每片都记录成败与状态码，失败时给出：
   - 各片结果 `#1成功 #2失败(500)`
   - 若前面有成功的片，明确写「这说明凭证、接口地址与音频格式都是通的（否则第一片就会失败）。中途才开始失败，最常见的原因是**该账号的额度/调用次数用尽**，或触发限流」
   - 标题变为「服务端错误（前 1 片已成功）」，动作建议改为「到平台控制台确认额度/调用次数」

3. 另：日志现在每片都会打印「第 N/M 片上传：文件名，大小（格式）」，不再只打印第一片。

### 本轮的结论

问题**不在扩展侧**：音轨获取、下载、解码、切片、M4A 编码、上传格式都已验证通过，第 1 片能成功就是证据。剩余可能只有两种：账号额度/次数用尽，或硅基流动该模型的服务端当前不稳定。

## 第二十三轮（1.23.0）—— 按 Bilitato 的参数对齐切片策略

用户确认**余额充足**，并授权「按 bilitato 的方法搞」。于是回到参考实现，逐项对齐它的**切片参数**（`utils/asrChunking.js`）：

| 参数 | Bilitato | 本扩展（改前） | 改后 |
|---|---|---|---|
| 默认分片 | `DEFAULT_ASR_CHUNK_SECONDS = 600` | 300 | **600** |
| 最小分片 | `MIN_ASR_CHUNK_SECONDS = 45` | 45 | 45 |
| 重叠 | 4 | 4 | 4 |
| 体积安全系数 | `ASR_CHUNK_SIZE_SAFETY_RATIO = 0.72` | 无（按 100% 估） | **0.72** |
| 并发 | — | 2 | **1** |

**为什么这可能是关键**：415.6s 的音频在 **300s 分片下是 2 片**，在 **600s 下是 1 片**。而用户日志显示**第 1 片成功、第 2 片才 500** —— 分片数越少，失败机会越少。Bilitato 的做法本质上是「尽量一次发完」。

1. **默认分片 600s / 并发 1 / 安全系数 0.72**（`ASR_LIMITS`），并修正 `computeSliceSeconds` 按 72% 估算。
2. **配置自动迁移** —— 旧配置里恰好等于旧默认值的 `sliceSeconds = 300`、`sizeLimitMB = 24` 会迁移到新默认（600 / 50）；手动设过的其它值不动。
3. **新增 10 项测试**：默认值对齐、415.6s 只切 1 片、1500s 切 3 片且单片不超 600s、收紧体积上限时自动缩短且不超上限 80%。

> 至此「按 Bilitato 的方法」已落实到两处：**音频格式**（1.20.0，`.m4a`）与**切片策略**（1.23.0，600s / 0.72）。

## 第二十四轮（1.24.0）—— 引入 FFmpeg.wasm，改为「流复制重封装」

用户确认**余额充足**，并指出「该引入 FFmpeg.wasm 了」。本轮先做**实证**再动手。

### 关键实证：MediaRecorder 产出的是 fragmented MP4

写脚本在真实 Chrome 里用扩展的 `audio.js` 生成样本，再解析 MP4 box 结构：

```
顶层 box: ftyp, moov, moof, mdat, moof, mdat, moof, mdat, ... （共 6 组 moof/mdat）
fragmented: true   hasMoov: true   hasMvex: true
```

**MediaRecorder 必然产出 fragmented MP4**（含 `moof`/`mvex`）。而 Bilitato 用 FFmpeg `-c:a copy` 产出的是**普通 MP4**（`moov` 在前、无 `moof`）。这是此前一直没能对齐的**结构性差异** —— 硅基流动对 fragmented MP4 返回 500（空响应体）。

### 引入 FFmpeg.wasm

- 选用 **单线程 core**（`@ffmpeg/core@0.12.10`，30.7MB），**不需要 SharedArrayBuffer**。
- 用官方 `@ffmpeg/ffmpeg@0.12.15` 包装包，并用 esbuild 打成两个**无相对依赖**的文件（`ffmpeg-api.js`、`ffmpeg-worker.js`），因为 blob URL 无法解析相对导入。
- 打包产物放 `vendor/ffmpeg/`，**按需加载**（只在需要重封装时读入内存）。

过程中踩到三个真实的坑，都记录在 `src/sidepanel/modules/ffmpeg.js` 注释里：

1. **同步 XHR**：Emscripten 默认走 `XMLHttpRequest` 同步加载 wasm，在扩展页会抛
   `InvalidAccessError: Failed to set the 'responseType' property ...`。
   → 自己 `fetch` 出字节，用 `wasmBinary` 传入。
2. **手写 core.exec 调用约定容易错**：直接调 `core.exec(argc, argvPtr, cb)` 返回 1 且无输出。
   → 改用官方包装包（它已验证这套约定）。
3. **`new URL()` 不接受 blob**：包装层内部对 coreURL/workerURL 调 `new URL(...)`，
   传 blob 会抛 `Failed to construct 'URL': Invalid URL`；
   且不传 `classWorkerURL` 时它会执行 `new Worker(new URL("./worker.js", import.meta.url))`，
   从 blob 导入时无法解析。
   → 传**真实 `chrome.runtime.getURL()` 地址**，并显式传 `classWorkerURL`。

### 接入转录流程

新增 `transcribeViaRemux()`：**不解码、不重采样、不重新编码**，直接把原始音轨交给 FFmpeg
做 `-c:a copy -movflags +faststart`，产出普通 MP4 后整段上传。

相比旧路径的好处：
- 音频编码与 B 站原始 AAC **完全一致**（无转码损失）
- **没有 MediaRecorder 的实时编码开销**（原来 415s 音频要等 416 秒，现在重封装只需几百毫秒）
- 产出是**普通 MP4** 而不是 fragmented MP4

超过单文件上限（50MB × 0.72）时才按时间分段分别重封装。`prefersM4a()` 平台优先走此路径，
FFmpeg 不可用时自动退回原「解码 + 重新编码」路径。

### 验证（全部在**真实 Chrome**里跑扩展代码本体）

```
PASS  产出是合法 MP4（含 ftyp）
PASS  产出是**普通** MP4（有 moov）
PASS  产出**不再是** fragmented（无 moof）
PASS  moov 在 mdat 之前（faststart）
```

另加 12 项 `linesFromSingleResult` / `assembleRemuxOutcome` 的组装测试（多片时间平移、行编号、
estimated 标记、meta 传输标记），保证新路径与主路径产出结构一致。

### 注意事项

- 扩展体积因 `vendor/ffmpeg/` 增加约 **30.9MB**（打包发行时需一并包含）。
- `manifest.json` 的 `extension_pages` CSP 增加 `blob:`（`script-src` / `worker-src` / `connect-src`）。

## 第二十五轮（1.24.1）—— 修掉扩展加载失败（CSP），并纠正一个错误方向

### 用户报错：扩展无法加载

```
'content_security_policy.extension_pages': Insecure CSP value "blob:" in directive 'script-src'.
```

**Chrome 禁止扩展页 CSP 的 `script-src` 出现 `blob:`**，会直接拒绝加载整个扩展。
我上一轮为了 FFmpeg 的 blob 导入加了它 —— 这是错的，扩展根本装不上。

### 修正

1. **CSP 改回 `script-src 'self'`**，`blob:` 只保留在 `worker-src`。
2. **不再用 blob URL 导入 api bundle**。因为已用 esbuild 打成自包含 ESM（无相对导入），
   可以直接 `import(chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-api.js'))`，走 `script-src 'self'`。
3. **api bundle 去掉 `import.meta.url`**：`new Worker(new URL(classWorkerURL, import.meta.url), {...})`
   → `new Worker(classWorkerURL)`。`import.meta` 在经典脚本里是语法错误，且相对路径在 blob 下无法解析。

### 一个我走错的方向（记录以免重犯）

我一度推断「MV3 不允许 blob 的 module worker」，于是把 **worker 改成经典 worker**（去掉 `await import`，
改走 `importScripts(core)`）。**这是错的**，实测直接报：

```
SyntaxError: Failed to execute 'importScripts' on 'WorkerGlobalScope':
Cannot use 'import.meta' outside a module
```

原因是 **ESM 版的 ffmpeg-core 内部使用了 `import.meta`**，只能通过动态 `import()` 加载，
所以 **worker 必须保持 ES module**。而 Chrome 是**允许从 `chrome-extension://` 地址创建 module worker** 的
—— 只要显式传 `classWorkerURL`（绝对地址），就不会走到 blob 分支。
本轮已把 worker 恢复为原样，并把这个约束写进 `patch-ffmpeg-vendor.mjs` 的断言里防止再次误改。

### 新增 `patch-ffmpeg-vendor.mjs`（15 项）

一次性完成「打补丁 + 断言全部约束」，可重复执行（幂等）：

```
PASS  api bundle uses no import.meta.url
PASS  worker keeps dynamic core import (ESM path)     ← 防止再把 worker 改成经典
PASS  loader passes classWorkerURL
PASS  loader does not import api via blob URL
PASS  CSP script-src has no blob:
PASS  CSP allows blob: for workers
PASS  vendor 文件存在：ffmpeg-core.js / ffmpeg-core.wasm ...
```

> **无法自动验证的部分（已明确告知用户）**：Chrome 153 禁用了 `--load-extension`，
> 所以我无法自动加载扩展做端到端验证。「扩展能被加载」「Worker 能在扩展页里跑起来」
> 这两件事只能由用户实际加载来确认。能自动验证的是：重封装产出的 MP4 结构正确
> （真实 Chrome 里跑扩展代码本体，上面 6 项全 PASS）。

### 第二次加载失败 —— 以及真正的根因

去掉 `script-src` 的 `blob:` 后，Chrome 又报：

```
'content_security_policy.extension_pages': Insecure CSP value "blob:" in directive 'worker-src'.
```

**`worker-src` 同样被当作脚本类指令**，也不允许 `blob:`。于是两条都只能留 `'self'`
（`blob:` 仅保留在 `img-src`，那是数据类指令，允许）。

### 然后测出真正的根因：WebAssembly 需要 `'wasm-unsafe-eval'`

把 CSP 收紧到 `script-src 'self'` 后再测，FFmpeg 报：

```
CompileError: WebAssembly.instantiate(): Compiling or instantiating WebAssembly module
violates the following Content Security policy directive because 'unsafe-eval' is not an
allowed source ... script-src 'self'
```

**`WebAssembly.instantiate` 在 CSP 下需要 `'wasm-unsafe-eval'`**。加上之后立刻通过
（重封装 8 秒音频耗时 **106ms**）。最终 CSP：

```
script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self';
img-src 'self' data: blob: https:; connect-src 'self' https: http:
```

> `'wasm-unsafe-eval'` 是 Chrome 专门为「允许 WebAssembly、但仍禁止 eval」设计的指令，
> 不会放宽 JS 的 eval 权限。

### 新增 `csp-ffmpeg-test.mjs`（4 项）—— 用与扩展**完全相同的 CSP** 做验证

因为 Chrome 153 禁用 `--load-extension`，无法直接加载扩展，所以改为：
用 HTTP 提供同样的目录结构，并给每个响应加上**与 manifest 完全一致的 CSP 头**，
再 stub `chrome.runtime.getURL` 返回同源地址。这样 `script-src 'self'` /
`worker-src 'self'` 的语义与扩展页一致，失败模式也能复现（上面那个 wasm 报错就是它抓出来的）。

```
PASS  模块可被 import（未用 blob）
PASS  worker 能在 script-src/worker-src 'self' 下创建并完成 remux
PASS  产出是普通 MP4（ftyp）
PASS  页面无未捕获错误（无 CSP 违规）
```

> 探针脚本必须作为**外部文件**提供 —— 内联 `<script>` 会被 `script-src 'self'` 拦掉，
> 这一点本身也验证了 CSP 确实生效。

## 第二十六轮（1.24.1）—— 最后一个假设也被排除，结论：换平台

用户提供了最有价值的一次日志（FFmpeg 路径完整跑通）：

```
音轨：audio/mp4 带宽 65726 来源 __playinfo__ host upos-sz-estgcos.bilivideo.com
下载完成：2.0MB，用时 0.9s
按 M4A 重封装上传（FFmpeg 流复制，不重新编码）。音频约 255 秒。
加载 FFmpeg 包装层… / 加载 FFmpeg 内核（约 31MB，首次较慢）… / FFmpeg 就绪
第 1/1 片重封装：2033.9 KB（普通 MP4，流复制）
第 1 片服务端错误，正在重试（第 1 次）
第 1 片服务端错误，正在重试（第 2 次）
```

**这推翻了我最后一个假设（fragmented MP4）。** 现在已发出的是：
**普通 MP4、原始 AAC 流复制、无转码、单片** —— 与参考实现 Bilitato 完全一致，
服务端仍然 500，且响应体为空。

### 至此客户端已彻底排除

| 假设 | 实验 | 结果 |
|---|---|---|
| Key / 地址错 | `/models` 返回 200，98 个模型 | ❌ 排除 |
| 参数不合法 | 400 / 401 会明确报错 | ❌ 排除 |
| 音频是静音 | 日志打印峰值 69~80% | ❌ 排除 |
| WAV 格式 | 换 M4A | ❌ 排除 |
| 分片太多 | 300s(2片) → 600s(1片) | ❌ 排除 |
| fragmented MP4 | FFmpeg 流复制成普通 MP4 | ❌ 排除 |
| 额度用尽 | 用户确认余额充足 | ❌ 排除 |
| 重试可恢复 | 自动重试 2 次 | ❌ 排除 |

**结论：硅基流动该接口对此账号不可用，属服务端问题。** 客户端已无可再改之处。

### 本轮改动

1. **改掉误导性的 5xx 文案**（重要）—— 原文案写「该平台对音频格式较敏感：已改用 M4A…
   若仍 5xx，换模型」，会让人继续在客户端找原因。现在如实说明已排除的三种音频形态
   （WAV / fragmented MP4 / 普通 MP4），并直接建议换用 Groq。标题也改为
   **「服务端错误（非本扩展问题）」**。
2. **确认并锁定 Groq 通路** —— 新增 10 项测试：
   - Groq 默认 `whisper-large-v3-turbo`、`paramStyle: 'full'`（要时间戳）
   - **Groq 不得被判定为 M4A 平台**（whisper 需要 multipart WAV）
   - 硅基流动标记 `audioFormat: 'm4a'` 且走最小参数
   - 自定义平台不锁定音频格式

### 追加：反向校验「发出去的字节确实是有效音频」

新增 2 项断言（在同一 CSP 环境下）：把重封装产物再喂回**扩展自己的解码器**，
验证它是完整、可解码、非静音的音频：

```
解码校验: {"duration":7.96,"sampleRate":48000,"channels":2,"peak":0.3911,"rms":0.2367}
PASS  重封装产物可被扩展解码器完整解码
PASS  解码出的音频不是静音（peak > 0.05）
```

这是客户端侧的**闭环证明**：下载 → FFmpeg 流复制重封装 → 产物可完整解码且非静音。
配合此前「Key 有效（/models 200）」「参数合法（否则 400）」「余额充足」，
硅基流动返回 500 的原因已不在客户端可控范围内。

### 与 Bilitato 的对照（已核对源码）

| 项 | Bilitato | 本扩展 | 是否一致 |
|---|---|---|---|
| 切片 | FFmpeg `-c:a copy` + `+faststart`，`.m4a` | 同 | ✅ |
| 分片时长 | 600s（`DEFAULT_ASR_CHUNK_SECONDS`） | 600s | ✅ |
| 体积安全系数 | 0.72 | 0.72 | ✅ |
| 硅基流动请求 | `file` + `model` + `Authorization` | 同 | ✅ |
| **音频排序** | `sort((a,b) => b.bandwidth - a.bandwidth)` —— **降序，取最高带宽** | 升序取最低带宽 | ❌ **不一致** |

音频排序方向确实不同（本扩展为省流量取最低带宽）。若该视频确实存在多条音轨，
本扩展会取较低码率的那条。这已记录，但在 65 kbps 单音轨的视频上不构成差异。

## 第二十七轮（1.24.2）—— 找到「报 401」是怎么被制造出来的

用户把 Bilitato 的 Key 填进来后，仍报 401，且指纹显示 `长度 51，末四位 adbr`（**还是原来的 Key**）。
但日志里有一条此前一直被我忽略的关键信息：

```
★ 本次请求实际打到的地址：https://api.siliconflow.com/v1/audio/transcriptions（换域名 ...）
★ 设置里配置的接口地址：https://api.siliconflow.cn/v1
✅ 用同一个 Key 访问 GET https://api.siliconflow.cn/v1/models 是成功的 → **Key 有效**。
```

即：**配置地址（.cn）上的转录是 500，兜底域名（.com）才是 401**，
而错误文案只报了最后那次 401 —— **真正的 500 被完全掩盖**。

### 两个真实缺陷

1. **5xx 不会尝试「换域名」兜底** —— `transcribeSlice` 的阶梯里，
   非 400/415/422 的状态码直接 `throw`，所以 `.cn` 报 500 时根本走不到 `.com`。
   修：**5xx 时若还有未试过的兜底域名，就先继续试完再放弃**
   （不同域名是彼此独立的服务，值得一试）。
   现在请求序列与用户真实日志一致：`.cn`×3 种传输 → `.com` → `/models` 对照。

2. **错误文案张冠李戴** —— 只展示兜底域名的 401，并据此得出「额度/权限」结论。
   修：**记录并展示完整尝试链路**，显式区分「配置地址那次是 500」与
   「兜底域名的 401」，动作建议改为「不要改 Key」。

3. 顺带修掉一个会吞掉诊断信息的隐患：`new URL(configuredBase)` 在
   baseUrl 畸形时会**抛错并从 `.find()` 里逃出去**，绕过所有错误分类，
   让文案退化成「裸 401」。已改为容错解析。

### 新增 7 项回归测试（复刻该场景）

```
PASS  该场景确实以 401 收尾（因为最后一次尝试打到 .com）
PASS  错误详情列出了完整尝试链路
PASS  链路里明确标出配置地址那次是 500（不是 401）
PASS  明确指出真正要处理的是 500，而非这个 401
PASS  不再把结论写成「额度/权限」
PASS  动作建议明确要求不要改 Key
PASS  动作建议里带上真正要处理的 500
```

### 对用户问题的结论

**Key 从未被真正替换过**（指纹一致），所以「换 Key 仍 401」这个结论不成立；
而且 401 是**兜底域名**产生的，与 Key 是否有效无关。
真实待解决问题依旧是：`api.siliconflow.cn` 的 `/audio/transcriptions` 返回 500。

## 第二十八轮 —— 用真实 Key 直接验证，确认问题在扩展运行环境

用户提供了 Bilitato 的完整配置（base URL、Key、模型 `XingChenAGI/XingChenGSR-V1.0`）。
这是第一次可以**直接对真实 API 做实验**，不再靠推断。

### 实测结果（全部 HTTP 200）

| 测试 | 结果 |
|---|---|
| `GET /models` | **200** |
| `XingChenAGI/XingChenGSR-V1.0` + WAV 5s（静音） | **200**，`{"duration":5.0,"text":""}` |
| 同上，0.3s / 1s / 2s / 48kHz | **200** |
| 同上，60s(1.8MB) / 180s(5.5MB) / 300s(9.2MB) / 600s(18.3MB) | **200** |
| `sample.m4a`（MediaRecorder 的 fragmented MP4）+ `SenseVoiceSmall` | **200** |
| `sample.m4a` + `XingChenAGI/XingChenGSR-V1.0` | 400（该模型不吃 M4A） |
| **直接调用本扩展的 `providers.transcribeSlice()`** 打真实 API | **200**（两个模型都成功） |
| curl 精确复刻我们发出的字段与文件名 | **200** |

**结论：硅基流动接口完全正常，我们的请求构造代码也是正确的。**
500 只在「浏览器扩展运行环境」里出现 —— 这是此前所有推断都没覆盖到的一层。

### 关键差异（Bilitato vs 本扩展）

| 项 | Bilitato | 本扩展 |
|---|---|---|
| **默认模型** | `XingChenAGI/XingChenGSR-V1.0` | `FunAudioLLM/SenseVoiceSmall` |
| **请求发起位置** | `offscreen` 离屏文档 | `background` service worker |
| 音频格式 | `.m4a`（FFmpeg 流复制） | `.m4a`（FFmpeg 流复制）✅ 已对齐 |
| 分片/nbsp;体积/参数/URL | 一致 | 一致 |

即：**模型默认值**与**请求发起位置**是尚未对齐的两点。

### 安全提醒

用户在对话中直接贴出了完整 API Key。**该 Key 必须立即在控制台删除并重新生成**。
测试过程中产生的临时文件（含含 Key 的产物目录）已清理，仓库内不含任何密钥。

## 第二十九轮（1.24.3）—— 真因确认：上传格式必须按「模型」决定

用户换上 Bilitato 的模型后，新的错误链路直接给出了答案：

```
1. .cn/audio/transcriptions → HTTP 400（最小参数）
2. .cn/audio/transcriptions → HTTP 400（base64-json）
3. .cn/chat/completions     → HTTP 400（chat-audio）
4. .com/audio/transcriptions → HTTP 401（换域名）
★ ✅ .cn/models → 200（Key 有效）
```

**三种传输方式全是 400** → 与传输方式无关，是**模型/参数层**的拒绝。
结合此前 curl 实测：

| 模型 | WAV | M4A |
|---|---|---|
| `FunAudioLLM/SenseVoiceSmall` | **500** | **200** |
| `XingChenAGI/XingChenGSR-V1.0` | **200** | **400** |

**同一个平台上，不同模型要求的格式完全相反。** 而本扩展此前是**按平台**一刀切
（`siliconflow` → 永远 M4A），所以选 XingChenGSR 就必然 400。

### 修复

1. **`audioFormatFor(platform)` 改为按模型判定**：
   - 显式 `audioFormat` 优先，但 **WAV-only 模型压过平台默认的 m4a**
     （否则选 XingChenGSR 又会退回发 M4A）
   - 未显式指定时按模型名判断（`xingchen|gsr|teleai|telespeech` → WAV；`sensevoice` → M4A）
   - 最后才按平台默认
2. **把 `XingChenAGI/XingChenGSR-V1.0` 加入硅基流动的预设模型列表**
   （Bilitato 用的就是它，已实测可转录中文）
3. **修正 400 时的动作建议** —— 原文案写「与音频格式无关」，这与实测结论矛盾。
   现在 400/415/422 会明确提示「参数或音频格式被拒，最常见原因是模型与上传格式不匹配」，
   并给出两个模型各自的正确格式。

### 新增 9 项测试（锁死实测结论）

```
PASS  XingChenGSR 模型必须用 WAV（实测 M4A 会 400）
PASS  SenseVoice 模型用 M4A（实测 WAV 会 500）
PASS  TeleSpeechASR 用 WAV
PASS  模型判断优先于平台 audioFormat=m4a
PASS  用户显式指定 wav 时尊重用户
PASS  用户显式指定 m4a 时尊重用户（WAV-only 模型例外）
PASS  Groq 的 whisper 走 WAV
PASS  无模型的默认硅基流动走 M4A
PASS  完全未知的平台默认 WAV
```

### 复盘：这一轮为什么能定位

**因为拿到了真实凭证，可以把每个变量单独测一遍。** 此前十几轮全部是「改一个猜测 → 试 → 失败」，
而这次是「固定其他变量 → 单独改格式 → 观察状态码」——

| 模型 | WAV | M4A |
|---|---|---|
| SenseVoiceSmall | 500 | **200** |
| XingChenGSR | **200** | 400 |

这张 2×2 表一次性说明：**格式确实决定成败，但方向随模型而变**。
此前所谓「硅基流动对 WAV 返回 500」只对 SenseVoiceSmall 成立，
我把它错误地推广成了整个平台的行为，还写进了默认配置。

## 第三十轮（1.24.4）—— 兜底域名的 401 不再掩盖配置地址的真实错误

用户的日志确认**格式修复已生效**（不再是 M4A）：

```
第 1/1 片上传：slice-001.wav，10435.4 KB（WAV 16kHz 单声道）
```

但 `.cn` 仍然 **三种传输方式全部 400**，而错误最终报的是兜底域名的 401。

### 实测排除

用 curl 发**完全相同尺寸**的文件：

```
334s / 10.4MB WAV + XingChenAGI/XingChenGSR-V1.0 → HTTP 200
```

同时做了 **WAV 往返校验**（用扩展自己的 `sliceToWav` 编码 → 用扩展自己的解码器解回）：

```
WAV 往返校验: {"bytes":96044,"riff":"RIFF","wave":"WAVE","duration":3,"sampleRate":48000,"channels":1,"peak":0.4}
```

→ **我们生成的 WAV 头部与采样数据都是正确的**（解码器输出 48kHz 是 AudioContext 的采样率，不是文件属性）。

### 修复：错误归属

此前只要最后一次尝试落在兜底域名上，报的就是那个 401，
**把配置地址上真正要处理的 400/500 完全盖掉**。现在：

- **以配置地址上的真实错误为准分类**（400 → 参数/格式类，500 → 服务端类）
- 详情里显式说明「**配置地址返回的才是真正要处理的问题**」
- 说明兜底域名的 401「**可以忽略**」（两个站账号不通用）
- **附带配置地址返回的原始响应体**（截断 500 字符）—— 这正是定位 400 所缺的信息

新增 2 项 WAV 往返断言 + 更新 6 项错误归属断言。

### 已知的下一步

400 的**具体原因**需要服务端返回的响应体才能确定。此前该响应体被丢弃，
1.24.4 起会直接显示在错误详情里。

## 第三十一轮（1.24.5）—— 根因确认：multipart 请求带了错误的 Content-Type

**这就是 500/400 折腾了三十轮的真凶。**

`authHeaders()` 无条件返回 `'content-type': 'application/json'`，
而 multipart 分支直接复用它：

```js
return timedFetch(url, { method: 'POST', headers: auth, body: form }, ...);
```

于是发出的是 **「Content-Type: application/json + multipart body（没有 boundary）」**
的畸形请求。服务端在解析 multipart 时直接失败 → **空响应体的 400**。

### 逐层排除后锁定的过程（每一层都用真实 API 验证）

| 环境 | 同一份字节 | 结果 |
|---|---|---|
| curl | 10.4MB WAV | **200** |
| Node（直接调本扩展 `providers.transcribeSlice`） | 10.4MB WAV | **200** |
| 真实 Chrome **普通页面** fetch | 10.4MB WAV | **200** |
| 真实 Chrome **扩展 service worker** fetch | 10.4MB WAV | **200** |
| 本扩展的 `transcribeAttempt`（multipart 分支） | 10.4MB WAV | **400** ← 唯一异常 |

环境全排除后，只剩「我们额外送出的东西」。而 `transcribeAttempt` 与上述所有实验的
唯一差异就是那个 `content-type` 头。

### curl 复现实验（决定性）

```
不指定 Content-Type（自动生成 boundary）  → HTTP 200
显式加 Content-Type: application/json     → HTTP 400  {"code":20015,"message":"The parameter is invalid."}
```

### 修复

新增 `authOnlyHeaders(platform)`：只返回鉴权头，**不带 content-type**，
让浏览器自动生成 `multipart/form-data; boundary=...`。
multipart 分支改用它；`base64-json` / `chat-audio` 等 JSON 分支保持原来的
`application/json`。

### 新增 3 项回归测试

```
PASS  multipart 请求不带 content-type（应由浏览器生成 boundary）
PASS  multipart 请求仍带 authorization
PASS  multipart 请求没有误带 anthropic-version
PASS  base64-json 传输仍带 content-type: application/json
```

### 修复后实测（真实 API）

```
XingChenAGI/XingChenGSR-V1.0  -> OK  {"text":"","usedParams":"最小参数（file + model）"}
FunAudioLLM/SenseVoiceSmall   -> OK  {"text":"","usedParams":"最小参数（file + model）"}
```

### 为什么这么难找

这个 bug 的症状**从头到尾都在说谎**：
- 同样的字节换个地方发就成功 → 显得像服务端问题
- 响应体为空 → 拿不到任何线索
- `.cn` 返回 400/500，兜底域名返回 401 → 401 又把真实错误盖住
- 我据此先后归因于：Key 站点、音频格式、分片数、fragmented MP4、额度、服务端故障

而真相只是**一个头部设错了**。讽刺的是，`authHeaders` 这个名字看起来像是
「鉴权专用」，实际上它同时塞了 `content-type` —— 名字掩盖了它的副作用。

**教训**：用真实凭证把变量逐个隔离（curl → Node → 页面 → service worker → 我们的代码），
比连续换假设有效得多。上面那张 5 行表如果早做，三十轮里的绝大多数都可以省掉。

### 追加（1.24.6）：运行时硬防线 + 确认用户当时跑的是旧代码

用户反馈「仍然 400」，但其错误文案证明**当时运行的还是旧版本**：
- 缺少 1.24.4 加入的「配置地址返回的原始响应体」一行
- 只有 1.24.3 的固定文案（当时的 400 还没走 `configuredFailed` 分支）

同时用真实 API 做了与用户完全一致的验证（270s / 8.2MB WAV，同一把 Key）：

```
multipart    -> OK  {"usedParams":"最小参数（file + model）"}
base64-json  -> OK
chat-audio   -> OK
```

**修复本身是有效的。** 为避免同类头部错误再次静默发生，新增**运行时硬防线**：
multipart 分支在发请求前检查头部，一旦含 `content-type` 直接抛错
（`内部错误：multipart 请求不能预设 Content-Type`），而不是发出畸形请求让服务端返回空 400。

> 教训：**恢复代码要验证「用户实际加载到了新代码」**。
> 本次靠用户贴出的错误文案里「有没有那一行」才判断出来。

## 第三十二轮（1.24.7）—— 真凶确证 + 发现「陈旧 service worker」

### 用真实扩展抓包，确证 Content-Type 就是真凶

起一个本地 HTTP 抓包服务，让**真实 Chrome 扩展的 service worker** 发 multipart 请求，
直接读服务端收到的头部：

| 情况 | 服务端实际收到的 Content-Type | boundary |
|---|---|---|
| **只带 authorization**（修复后） | `multipart/form-data; boundary=----WebKitFormBoundary...` | ✅ 有 |
| **额外带 application/json**（旧 bug） | `application/json` | ❌ **无** |

`boundaryFound: false`、`parts: 0` —— 畸形请求坐实。
（该实验里第二个 case 返回 200 只是因为本地服务不校验，真实服务端会 400。）

### 卡住的真正原因：陈旧的 service worker

修复代码确实在仓库里、也确实被执行（错误文案里的链路就是新版加的），但请求仍是旧形态。

**MV3 里 service worker 与面板是两份独立更新的代码。** 只点扩展的「刷新」时：

- **面板**：立刻用上新代码 → 日志显示新版行为（600s 分片、WAV、完整链路）
- **service worker**：**旧实例可能仍在运行** → 仍在发 `Content-Type: application/json`

这完美解释了「日志明明是新的、行为却还是旧的」这个矛盾。

### 修复：转录开始时做版本自检

新增 `backgroundVersion()`（走已有的 `bsub:ping`）与转录日志首行自检：

```
版本自检：面板与后台均为 1.24.7
```

不一致时明确告警：

```
⚠ 版本不一致：面板 1.24.7，后台 1.24.4 —— 后台的 service worker 还是旧代码，
请在 chrome://extensions 里「移除」后重新「加载已解压的扩展程序」。
```

### 新增 5 项测试

```
PASS  转录开始时会向后台查询版本
PASS  版本一致时日志给出确认
PASS  后台版本陈旧时给出明确警告（这正是「日志新版、行为旧版」的成因）
PASS  陈旧警告里带上两边的版本号
PASS  后台无响应时也记录一行（便于判断 SW 未唤醒）
```

### 结论

**用户当时运行的 service worker 是 1.24.4 之前的版本**（其错误文案缺少
1.24.4 才有的「配置地址返回的原始响应体」一行）。修复自 1.24.5 起已正确，
需**移除扩展后重新加载**才能让 service worker 也更新。

## 第三十三轮（1.24.8）—— Content-Type 修复确认生效；新问题：RPC 超时

用户日志（**版本自检：面板与后台均为 1.24.7**）：

```
第 1/1 片上传：slice-001.wav，12988.7 KB（WAV 16kHz 单声道）
第 1 片操作超时，正在重试（第 1 次）
asr.transcribe 超时（30000ms）
```

**两个重大进展**：

1. **版本自检起作用了** —— 面板与后台版本一致，说明 Content-Type 修复**确实已生效**。
   上传形态也确认是新版（WAV + 完整链路 + 版本自检行）。
2. 报错从「服务端 400」变成了「**操作超时**」—— 这是**完全不同层**的问题，
   说明请求本身已经被服务端接受了。

### 真因：asr.transcribe 没有登记超时

`METHOD_TIMEOUT` 里**没有 `asr.transcribe`**，于是回落到
`DEFAULT_RPC_TIMEOUT = 30000` —— **RPC 层 30 秒就断开**。
而 13MB WAV 的 base64 上传本身恰好需要约 30 秒，
所以**每一次都在上传阶段被掐断**，服务端根本来不及转录。

### 修复（三处）

1. **登记 `asr.transcribe: 600000`、`asr.probe: 300000`**（连同 `permission.request` 等重方法一起核查）。
2. **RPC 超时强制大于 HTTP 超时**（`transcribe.js` 的 `callAsr`）：
   `rpcTimeoutMs = max(httpTimeoutMs + 60000, 600000)`。
   这从设计上杜绝了「RPC 先超时、HTTP 其实还在跑」的假失败。
3. **后台 HTTP 超时纳入上传时间**（`service-worker.js`）：
   `timeoutMs = max(配置值, 用户传入, 上传按 200KB/s 的估算 + 60s)`。
   13MB 上传按此估算得到 ≥ 120 秒的余量。

### 新增 6 项测试

```
PASS  asr.transcribe 显式登记了超时（不能靠默认值）
PASS  asr.transcribe 的 RPC 超时 ≥ 5 分钟（要覆盖上传+转录）
PASS  asr.transcribe 的 RPC 超时远大于默认 RPC 超时
PASS  连通性诊断也登记了超时
PASS  所有重方法都已显式登记超时
PASS  重方法的超时都大于默认 RPC 超时
```

### 复盘：这一轮暴露的测试盲区

`METHOD_TIMEOUT` 是一张**手写清单**，新增 RPC 方法时**没有任何机制保证同步登记**。
这与第 `method-contract-test` 解决的「三层方法白名单」是同一类问题 ——
但那张契约只覆盖页面方法转发，**没有覆盖 RPC 超时登记**。
本轮把「重方法必须登记且超时足够大」变成了断言。

---

## ✅ 第三十四轮 —— 用户确认转录成功（1.24.8）

用户反馈「**成功了**」。至此整条链路打通。记录最终状态与完整根因。

### 最终打通的两个（互相叠加的）根因

故障持续了很久，因为**两个 bug 叠在一起**，修掉第一个后第二个才显现：

| # | Bug | 症状 | 修复版本 |
|---|---|---|---|
| 1 | **multipart 请求带了 `Content-Type: application/json`** | 服务端解析 multipart 失败 → **空响应体的 400** | 1.24.5 |
| 2 | **`asr.transcribe` 未登记超时**，回落默认 30s | 13MB WAV 上传恰需约 30s → **每次都在上传阶段被掐断** | 1.24.8 |

第 1 个修好后症状从「服务端 400」变成「操作超时」—— 这本身就是**关键进展信号**
（说明服务端已接受请求），只是当时又被第 2 个 bug 挡住。

### 为什么第 1 个 bug 特别难查

它的症状**处处说谎**：

- 同一份字节用 curl / Node / 普通页面 / service worker 发都是 **200** —— 像是服务端问题
- 响应体为空 —— 拿不到任何线索
- `.cn` 返回 400，兜底域名返回 401 —— **401 把真实的 400 盖住**，还把我引向「Key 失效」
- 我据此先后错误归因于：Key 站点 → 音频格式 → 分片数 → fragmented MP4 → 额度 → 服务端故障

最终靠**逐层隔离**定位：

| 环境 | 同一份字节 | 结果 |
|---|---|---|
| curl | 10.4MB WAV | 200 |
| Node（直接调 `transcribeSlice`） | 10.4MB WAV | 200 |
| 真实 Chrome 普通页面 | 10.4MB WAV | 200 |
| 真实 Chrome 扩展 service worker | 10.4MB WAV | 200 |
| **本扩展的 `transcribeAttempt`** | 10.4MB WAV | **400** ← 唯一异常 |

再用**真实扩展抓包**确证：

| 情况 | 服务端收到的 Content-Type | boundary |
|---|---|---|
| 只带 authorization | `multipart/form-data; boundary=...` | ✅ |
| 额外带 application/json | `application/json` | ❌ 无 |

### 期间一并修正的真实缺陷

- **兜底域名的 401 掩盖配置地址的真实错误** → 改为以配置地址的错误为准并展示完整链路（1.24.4）
- **错误详情不展示服务端响应体** → 现在会附上（1.24.4）
- **`new URL(configuredBase)` 畸形时抛错**，绕过全部错误分类 → 改为容错
- **陈旧 service worker**：MV3 里 SW 与面板是两份独立更新的代码，
  只点「刷新」时面板更新而 SW 可能仍在跑旧代码 → 新增**版本自检**写入转录日志（1.24.7）
- **上传格式按平台一刀切** → 实测发现同平台不同模型要求相反
  （SenseVoice 只吃 M4A、XingChenGSR 只吃 WAV），改为**按模型判定**（1.24.3）

### 最终验证

```
18 个套件 / 606 项断言，全部通过
扩展 1.24.8
```

### 复盘的教训（按重要性）

1. **有可测试的凭证时，隔离变量远比换假设有效。** 那张 5 行环境对照表如果早做，
   十几轮弯路都可以省掉。我直到用户提供了真实 Key 才做这件事。
2. **「我们的代码」和「正在运行的代码」可能不是同一份。** MV3 的 SW 独立生命周期，
   我明明知道 MAIN-world 脚本要刷新页面，却没把同样的逻辑用在 SW 上。
3. **手写清单必须有契约测试保护。** `METHOD_TIMEOUT` 漏登记 `asr.transcribe`
   与当初页面方法白名单漏登记是同一类错误 —— 我为后者建了契约测试，却没为前者建。
4. **错误上报本身是排查能力的一部分。** 「失败时日志就丢了」「只报最后一次尝试」
   这两个缺陷直接导致我多轮无法获取关键信息。

## 第三十五轮（1.24.9）—— AI 总结报「非 ISO-8859-1 字符」

字幕转录成功后，点击「总结」报出原生错误：

```
Failed to execute 'fetch' on 'WorkerGlobalScope':
Failed to read the 'headers' property from 'RequestInit':
String contains non ISO-8859-1 code point.
```

### 成因

**HTTP 头只能承载 ISO-8859-1 字符。** 请求头里由用户提供的值只有 API Key，
所以最常见的原因是把**中文说明、全角符号或换行**一起粘进了 Key 输入框
（例如从文档/控制台连同一段说明一起选中复制）。

原生错误完全看不出「该改什么」，用户只能看到一句底层异常。

### 修复

新增 `assertHeaderSafe(name, value)` + `safeHeaders(raw)`，**所有请求头统一过一遍校验**：

- **非 ISO-8859-1**（`> 0xff`）：中文、全角符号、emoji
- **控制字符**（`< 0x20` 或 `0x7f`）：换行、制表符、`\0`
  —— 换行尤其危险，会造成头部注入

命中时抛出可照做的 `badkey` 错误：

```
API Key 含非法字符「中」
请求头 authorization 的第 12 个字符是「中」（非 ISO-8859-1 或控制字符）。
HTTP 头只能放单字节可见字符，中文/全角符号/换行都会让请求直接失败。
当前 Key：长度 8，末四位 cdef。
→ 请到 设置 → 对应平台，点「清除」后**只粘贴 Key 本身**，再「保存设置」。
```

已应用于**全部**构造请求头的位置：`authHeaders`（AI）、`authOnlyHeaders`（ASR multipart）、
`transcribeAttempt` 的 JSON 分支、以及检索平台的 bocha / serper / 通用分支。

### 新增 9 项测试

```
PASS  含中文的 Key 被提前拦下（不再抛原生 ISO-8859-1 错误）
PASS  分类为 badkey
PASS  标题点名是非法字符
PASS  详情里指出具体是哪个字符
PASS  详情里解释 HTTP 头只能放单字节字符
PASS  动作建议是「只粘贴 Key 本身」
PASS  全角符号同样被拦下
PASS  带换行的 Key 也被拦下
PASS  正常 ASCII Key 不受影响
```

## 第三十六轮（1.25.0）—— 时间戳精度 & 联网抓正文

用户提出两个问题：
1. **识别出的字幕时间与实际相差较大**
2. **直接联网时，为什么不让 AI 用提供的地址去爬取网页？**

### 问题 1：时间戳 —— 找到了唯一支持时间戳的模型

实测三家模型的真实返回（同一段中文 TTS 语音）：

| 模型 | 返回内容 |
|---|---|
| `XingChenAGI/XingChenASR-Diarize-V3.0` | **含 `segments`**：`[{"start":0.1,"end":6.14,"text":"...","speaker":"1"}, ...]` |
| `XingChenAGI/XingChenGSR-V1.0` | 只有 `text` |
| `FunAudioLLM/SenseVoiceSmall` | 只有 `text` |
| `TeleAI/TeleSpeechASR` | 只有 `text` |
| `XingChenAGI/XingChenASR-V3.2(-Ultra)` | 只有 `text` |
| `Qwen/Qwen3-ASR-1.7B` | 只有 `text` |

**硅基流动上只有 Diarize 模型返回时间戳。** 其余模型我们只能把整段文字摊到视频时长上
—— 那是**估算**，必然与画面对不齐。

而且旧代码**只认 `{t, d}` 字段**，把 Diarize 返回的 `{start, end}` 完全忽略了：
**即使拿回了真实时间戳也没用上。**

修复：
1. `linesFromSingleResult` 兼容 `{start,end}` 与 `{t,d}` 两种字段，并保留 `speaker`
2. 去掉 Diarize 文本里的 `"1: "` 说话人前缀（否则会混进字幕正文）
3. 无时间戳时改为**按字数比例**分配，而不是平均分配（长句占更多时间，更接近真实语速）
4. 把 `XingChenAGI/XingChenASR-Diarize-V3.0` 放进预设模型列表首位（标注「唯一带时间戳」）
5. 用了无时间戳模型时，转录日志明确提示「字幕时间是按字数估算的」并给出改用建议

### 问题 2：联网抓正文 —— 已实现，但默认关着

**用户的判断是对的。** 但需要说明一个前提：

**AI 平台（DeepSeek / 硅基流动等）本身无法访问互联网** —— 它们的 API 只能收发文本。
所以「让 AI 自己去爬」在架构上做不到，**只能由扩展抓取正文、再连同字幕一起喂给 AI**。

这个能力**早就实现了**（`fetchPageContent` + `fetchPageText`），但：

- **默认关闭** → 改为**默认开启**
- **每条来源只截 900 字** → 那是「摘要级」长度，装不下网页正文，
  等于「抓了也用不上」→ 抓到正文时放宽到 **3000 字**，并区分标注「正文 / 摘要」

### 新增 9 项测试

```
PASS  识别出 segments 里的起止时间
PASS  第二条线段时间为 6.58~10.34
PASS  真实时间戳标记为非估算
PASS  保留说话人信息
PASS  去掉文本里的说话人前缀「1: 」
PASS  兼容 {t,d} 字段（Groq 风格）
PASS  无 segments 时标记为估算
PASS  估算行覆盖整个时长且连续
PASS  估算按字数比例分配（长句占更长时间）
```

### 复盘

时间戳问题**从第一版就存在**，但一直没暴露 —— 因为此前从没跑通过一次真实转录。
打通之后，这类「功能能跑但质量不对」的问题才开始浮现。

值得记下的是：**Diarize 模型一直在模型列表里，我从没试过它。**
我先前测试 ASR 只用了 SenseVoice / GSR / TeleSpeech 三个，
而「要时间戳」这件事完全可以用 5 分钟的 API 探测解决。

## 第三十七轮（1.25.1）—— 对话时的联网

用户反馈：「**现在对话时好像不能联网**」。

### 根因：对话从不发起检索

`sendMessage` 里只有这一句：

```js
const searchBlock = searchContextBlock(st.search.results || [], st.search.counts);
```

它**只读取上一次搜索的结果**，自己从不检索。也就是说：

> 必须先手动点一次「检索」，对话才可能带资料。否则对话永远是纯离线的。

（`generateSummary` 同样如此。）对比 `optimizeWithAi` —— 它有 `useSearch` 开关，
会主动去搜，所以只有那条路是真正联网的。

### 修复

`sendMessage` 新增**按需自动检索**：

1. 问题里出现外部信息需求时（`最新/现在/是谁/多少钱/查一下/官网/来源/对比…`）自动检索
2. 可配置 —— 设置 → 联网检索新增两个开关：
   - **对话时自动联网**（默认开）
   - **每轮对话都联网检索**（默认关，避免每问一句都耗检索额度）
3. 检索结果实时写回并进入上下文（`[来源 N]` 引用机制不变）
4. **检索平台没配 Key 时明确提示**「未能联网：检索平台还没配置 Key」，
   而不是静默跳过 —— 这正是「感觉不能联网」的常见原因
5. 检索失败不影响对话本身

### 新增 10 项测试

```
PASS  对话自动联网默认开启
PASS  「每轮都搜」默认关闭（避免每问一句都消耗额度）
PASS  抓取页面正文默认开启
PASS  联网检索有两个可控开关
PASS  外部信息类问题会触发检索
PASS  纯视频内容类问题不触发检索（省额度）
PASS  抓到正文时标注为「正文」
PASS  正文截断放宽到 3000 字（原来只有 900，装不下网页正文）
PASS  只有摘要时标注为「摘要」
```

### 关键前提（必须让用户知道）

**联网检索平台（Tavily / 博查 / Serper）都需要各自的 API Key，默认是空的。**
没配 Key 的话，无论如何都不会联网 —— 现在会明确提示这一点。

另外重申上一轮的结论：**AI 平台自身无法访问互联网**，
所以「让 AI 自己去爬网页」在架构上做不到，只能由扩展抓正文再喂给 AI。

## 第三十八轮（1.26.0）—— MCP、Skills、对话工具条、模型切换

用户需求：「添加 MCP 服务与 Skill 为模型添上手和脚，并在对话框旁边加上上传文件、联网、
Skill、MCP 的小图标。还支持在对话框切换已经可以使用的模型。」

### 1. MCP 客户端（`src/background/mcp.js`）

浏览器扩展**无法启动 stdio 子进程**，所以只实现两种远程传输：

| 传输 | 做法 |
|---|---|
| `http` | 直接 POST JSON-RPC（streamable HTTP） |
| `sse` | 先 GET 事件流拿到 `endpoint`，再向其 POST；响应可从 POST 回包或原流读取 |

协议流程：`initialize` → `notifications/initialized` → `tools/list` → `tools/call`。
解析同时兼容**直接 JSON**与 **SSE `data:` 帧**两种回包形态。
`toolResultToText` 把 content 数组里的 text / image / resource 归一成文本。

### 2. 工具调用循环（`src/background/tools.js`）

"给模型装上手脚"的核心：把 MCP 工具转成函数声明交给模型 →
模型返回工具调用 → 调 MCP → 结果回填 → 再问模型，直到给出最终回答或达到轮数上限。

- 同时支持 **OpenAI**（`tools` + `tool_calls`）与 **Anthropic**（`tools` + `tool_use`/`tool_result`）两种形状
- 工具名做命名空间隔离：`服务名__工具名`
- 单个工具失败**不中断**整个循环，而是把错误作为工具结果回填
- 达到轮数上限时再要一次"不带工具的收尾回答"
- 平台不支持函数调用时**降级为普通对话**，不影响可用性
- `opts.chatFn` 可注入，便于测试（ES module 无法 monkey-patch）

### 3. 对话工具条（`panel-ai.js` + `panel.css`）

输入框下方一排图标：

| 图标 | 作用 |
|---|---|
| 📎 | 上传文件（带附件数量角标） |
| 🌐 | 联网开关（即时生效并持久化） |
| ✨ | Skills 选择浮层（列内置 + 自建技能，点击即发送） |
| 🔌 | MCP 开关（带已启用服务数提示） |
| 右侧下拉 | **切换 AI 平台 / 模型**（合并所有平台的模型列表，切换即生效） |

### 4. Skills

内置 4 个：深度总结 / 提取问答 / 术语表 / 时间轴。
技能正文会与提问一起发送；选中后总结也会按该技能指令走。
设置 → Skills 可增删改。

### 5. 设置面板

新增两个分组：**MCP 服务**（增删服务、传输方式、地址、Token、启用开关、
「测试连接」直接列出工具名、超时与轮数）与 **Skills**（增删改，内置项标注来源）。

### 新增 23 项测试（`mcp-test.mjs`）

用本地 HTTP 服务模拟 MCP 服务端，覆盖：

```
PASS  能完成 initialize 握手            PASS  解析 OpenAI 风格 tool_calls
PASS  读到了服务端信息                  PASS  解析 Anthropic 风格 tool_use
PASS  列出 2 个工具                     PASS  容忍畸形 arguments
PASS  工具带 inputSchema                PASS  第一轮把工具传给了模型
PASS  握手时发了 initialized 通知        PASS  工具执行后追加了结果消息
PASS  tools/call 返回 content 数组      PASS  最终返回模型的收尾回答
PASS  文本内容被提取                    PASS  记录了工具调用的开始与结束
PASS  图片内容被折叠而不是丢弃           PASS  未知工具被记为失败而不是抛异常
PASS  服务端返回的 JSON-RPC 错误会被抛出  PASS  未知工具后仍能拿到回答
PASS  错误里带上服务端原始消息
```

### 已知限制（已在界面注明）

- **不支持 stdio 传输**（浏览器扩展无法起子进程）
- **并非所有平台都支持函数调用**；模型不返回工具调用时 MCP 静默不生效，不影响普通对话
- MCP 走的是**非流式**请求，因此带工具的轮次不会有逐字输出

## 第三十九轮（1.26.1）—— 字幕改为可选，无字幕也能对话

用户提问：「现在 AI 对话必须先把字幕提取出来，我可不可以不用字幕也可以直接与 AI 对话」。

### 根因：一道不必要的人为拦截

`sendMessage` 开头写死了一段门禁：

```js
if (!(st.subtitles || []).length) {
  toast({ title: '还没有字幕', detail: '没有字幕时无法基于视频回答，请先抓取字幕或语音转录。' });
  return;   // ← 直接中断，连请求都不发
}
```

**「不能基于视频回答」被写成了「不能对话」。** 但对话本来就有很多与字幕无关的用途：
纯问答、联网检索、归纳粘贴/上传的内容、调用 MCP 工具。

### 修复

1. **移除硬拦截** —— 无字幕时照常发送对话请求
2. **系统提示分两种形态**：
   - 有字幕 → 注入「【视频字幕原文】」（行为不变）
   - 无字幕 → 注入「【当前没有这期视频的字幕】」，并明确要求
     **可以凭已有知识/检索结果/用户提供的内容作答，但不要编造视频里没有的内容**
     （不注入空字幕块，也避免模型对着空内容瞎编）
3. **界面文案同步**：
   - 输入框占位符在无字幕时变为「直接提问即可 —— 没有字幕也能聊（可联网、可上传文件、可调用 MCP 工具）」
   - 空状态提示改为「生成总结需要先有字幕；但下方对话可以直接提问，不需要字幕」
   - 「生成总结」的提示补上「如果只是想提问，直接在下方对话框输入即可」

> 「生成总结」仍然需要字幕 —— 没有字幕就没有可总结的内容，这是合理的；
> 但**对话不再受此限制**。

### 新增 5 项测试（`panel-test.js`）

```
PASS  无字幕时对话请求照常发出（不再被拦截）
PASS  无字幕时如实告知模型「当前没有字幕」
PASS  无字幕时不再注入空的「视频字幕原文」块
PASS  无字幕时提示不要编造视频内容
PASS  有字幕时仍注入「视频字幕原文」
PASS  有字幕时不再出现「没有字幕」提示
```

## 第四十轮（1.27.0）—— 参考 Cherry Studio：扩充内置平台 + 兼容 SKILL.md

用户建议「内置模型种类、MCP、skill、网络搜索可以参考 chreeystudio 这个开源软件」。

### 研究方法

没有靠记忆猜，而是**直接读本机安装的 Cherry Studio 数据库**（`%APPDATA%\CherryStudio\Data\cherrystudio.sqlite`）：

| 表 | 内容 |
|---|---|
| `user_provider` | 73 个 provider（provider_id / preset_provider_id / endpoint_configs / api_keys / auth_config / provider_settings） |
| `user_model` | 339 个模型（model_id / capabilities / input_modalities / context_window / max_output_tokens / pricing / reasoning …） |
| `mcp_server` | MCP 服务定义：type（stdio / sse / streamableHttp / **inMemory**）、base_url、command、args、env、headers、registry_url、disabled_tools、is_trusted |
| `agent_global_skill` | 技能：name / description / folder_name / source(builtin) / version / tags / **content_hash** |

> ⚠️ 第一版探查脚本只对字段名做脱敏，**没有处理 JSON 字符串内部的嵌套字段**，
> 导致 `app_secret` 被原样打印。已修正为「除白名单列外一律只报类型与长度」。
> （用户已确认无碍。）

### 对照结论

| 方面 | Cherry Studio | 本扩展 | 可否照搬 |
|---|---|---|---|
| 模型供应商元数据 | provider → models、capabilities、context_window、定价 | 已有 provider → models，缺 capabilities/定价 | ✅ 部分（先补平台与模型） |
| MCP 传输 | stdio / sse / streamableHttp / inMemory | http / sse | ⚠️ **stdio 与 inMemory 在浏览器里不可能实现** |
| Skills | `SKILL.md`（YAML frontmatter + Markdown 正文），可带 scripts/ | 纯 JSON 配置 | ✅ **格式可兼容，脚本不可执行** |
| 网络搜索 | 17 个 provider 可选 | 4 个（tavily/bocha/serper/自定义） | ⏳ 待补 |

### 本轮落地

**1. 内置 AI 平台从 6 个扩到 27 个**

新增（**每个 baseUrl 都用 curl 实测过**，无 Key 时 401/403 即证明地址正确）：

阿里云百炼 / Moonshot / 智谱 GLM / Z.ai / 腾讯混元 / 腾讯云 TI(LKEAP) / 字节豆包(火山方舟) /
百川 / 阶跃星辰 / MiniMax / 百度千帆 / 无问芯穹 / PPIO / 魔搭 ModelScope / LongCat / 小米 MiMo /
xAI Grok / Gemini(OpenAI 兼容) / Mistral / OpenRouter / Together + Anthropic / Groq + 自定义

**未收录**：`yi`（智谱外的零一万物）—— 实测 `api.lingyiwanwu.com` 返回 **410 Gone**，已下线。

模型 id 只是**种子值**，设置页的「选择模型」会从各平台 `/models` 拉真实列表覆盖。

**2. 兼容 SKILL.md（Cherry Studio / Anthropic Skills 约定）**

新增 `src/shared/skills.js`：

- `parseFrontmatter` —— 极简 YAML 头解析（含 `key: >` 折行块、成对引号），不引入 yaml 依赖
- `skillFromMarkdown` —— frontmatter 的 name/description/version/allowed-tools + Markdown 正文 → 技能对象
- `detectExecutableDeps` —— 识别 `Bash(...)`、shell 命令、python/node/npx、`scripts/` 目录
- `buildSkillMenu` —— **渐进式披露**：技能多时只把「名称 + 描述」给模型，由它决定用哪个

设置 → Skills 新增「导入 SKILL.md」，可多选文件批量导入。

**必须说清的限制**：Cherry Studio 是 Electron 桌面端，能启动本地进程执行技能脚本；
**浏览器扩展不能**。所以本扩展支持的是「**指令型**技能」——
若技能声明了本地执行依赖，导入时会明确告警「只会作为指令使用」。

### 新增 18 项测试（`skills-test.mjs`）

其中包含**用真实 Cherry Studio 技能文件做的验证**：

```
（已解析 8 个真实 SKILL.md）
PASS  解析出 name / version / allowed-tools
PASS  description 折行块被合并成一行
PASS  正文保留 Markdown 结构
PASS  识别出需要本地执行的依赖
PASS  无 frontmatter 时用文件名作名称
PASS  缺少正文时抛出可读错误
PASS  菜单只列名称与描述（不塞正文）
PASS  能解析真实 Cherry Studio 的 SKILL.md
```

## 第四十一轮（1.27.1）—— 补齐联网检索 provider（对齐 Cherry Studio）

### 实测

| 端点 | 结果 |
|---|---|
| bing / tavily / serper / zhipu-web | 401 / 403（**地址正确**，只是没带 Key） |
| bocha / metaso | 405（方法不对，即**地址正确**） |
| brave / exa / jina / searxng / ddg / google-cse | `connect=0` —— 沙箱网络策略拦截，**不代表服务不可用** |

### 落地：搜索平台从 4 个扩到 11 个

| id | 服务 | 传输 | 备注 |
|---|---|---|---|
| tavily | Tavily | POST JSON | 已有 |
| bocha | 博查 | POST JSON | 已有，国内 |
| serper | Serper(Google) | POST + `x-api-key` | 已有 |
| **zhipu-web** | **智谱 Web 搜索** | POST + Bearer | **国内推荐**，无需额外注册（复用智谱 Key） |
| **metaso** | **秘塔搜索** | POST + Bearer | 国内 |
| **baidu-ai-search** | 百度千帆 AI 搜索 | POST + Bearer | 国内 |
| **brave** | Brave Search | GET + `x-subscription-token` | |
| **exa** | Exa 语义搜索 | POST + `x-api-key` | 支持直接返回正文 |
| **jina-search** | Jina 搜索 | GET `s.jina.ai/<q>` | 可选 `x-respond-with: markdown` |
| **searxng** | SearXNG | GET `?format=json` | 自建即可免 Key |
| custom-search | 自定义 | GET `?q=` | 兜底 |

响应解析兼容了各家不同的形态：`search_result`（智谱）、`data.webpages`（秘塔）、
`web.results` + `extra_snippets`（Brave）、`references` / `search_results`（百度）、
`data[].content`（Jina）、`results[].content`（SearXNG）。

### 新增 37 项测试

对 7 个新增 provider **逐个**断言「请求地址 / HTTP 方法 / 请求体字段 / 鉴权头 / 响应解析」：

```
PASS  zhipu-web        请求地址正确 / POST / search_query + search_engine / 解析出结果
PASS  metaso           请求地址正确 / POST / q + scope=webpage / 解析出结果
PASS  baidu-ai-search  请求地址正确 / POST / messages + search_source / 解析出结果
PASS  brave            请求地址正确 / GET  / 带上 x-subscription-token / 解析出结果
PASS  exa              请求地址正确 / POST / query + numResults / 带上 x-api-key / 解析出结果
PASS  jina-search      请求地址正确 / GET  / 解析出结果
PASS  searxng          请求地址正确 / GET  / format=json / 解析出结果
```

### 仍未照搬的部分（有意为之）

Cherry Studio 的 **stdio / inMemory MCP 传输**、**技能脚本执行**、**本地知识库/向量检索**
都依赖 Electron 的本地进程能力，**浏览器扩展在架构上无法实现**。
本扩展保留的是「远程 MCP（http/sse）+ 指令型 Skills + 联网检索」这一可移植子集。

## 第四十二轮（1.27.2）—— 「进入插件咋没看到」：迁移漏了新增平台

用户反馈装完看不到新平台。**根因在迁移逻辑**：

```js
if (!Array.isArray(merged.ai.platforms) || !merged.ai.platforms.length) {
  merged.ai.platforms = defaultAiPlatforms();   // ← 只有「列表为空」时才填默认值
}
```

老用户的 `platforms` 非空，于是**后来新增的内置平台永远不会出现** ——
平台从 4 个扩到 11 个、AI 从 6 个扩到 27 个，对已安装用户**完全不可见**。

> 这是一个「功能做了但用户看不到」的典型缺陷：数据加了、UI 也接了，
> 但**存量配置的迁移路径没跟上**。

### 修复：`mergeBuiltinPlatforms`

新增 `mergeBuiltinPlatforms(existing, defaults)`，在迁移时把「按 id 不存在于用户配置」的
内置平台**追加**进去。规则刻意保守，绝不碰用户数据：

- 用户已有条目**原样保留**（含 apiKey / model / baseUrl 等一切修改）
- 只追加缺失的内置条目，且以**空白模板**加入（`apiKey: ''`）
- **不改变顺序**：已有的在前，新增的追加在后面
- **幂等**：重复迁移不会重复追加

### 新增 10 项测试

```
PASS  老用户的 AI 平台被补全到最新内置数量
PASS  老用户的搜索平台被补全到最新内置数量
PASS  用户的 API Key 绝不被覆盖
PASS  用户改过的模型名保留
PASS  新加入的平台 Key 为空（不会误用别人的 Key）
PASS  已有平台排在前面，新增追加在后面
PASS  新增的搜索平台里含智谱 Web 搜索
PASS  迁移是幂等的（不会重复追加）
PASS  用户自建平台被保留
PASS  用户自建平台的 Key 未被清空
```

### 教训

**任何「往默认配置里加东西」的改动，都必须同时考虑存量用户怎么拿到它。**
此前加 ASR 平台、搜索平台、MCP/Skills 默认值时，我都只改了默认值，
默认这次才通过用户反馈暴露出来 —— 这类缺陷测试很难主动发现，
因为测试总是从「空配置」开始。

## 第四十三轮（1.28.0）—— 免费无 Key 引擎 + 回退链（参考 dsh-free-search）

用户建议参考 <https://github.com/DDDMUC/dsh-free-search>。

### 之前的根本问题

「联网检索」必须先配一个检索平台的 API Key，否则 `runProviderSearch`
直接抛「检索服务商还没配好」—— **用户装完扩展，联网功能其实是不可用的**。
而我们内置的 4 个平台 Key 全是空的，所以这个情况就是默认状态。

### 参考它的三个设计

| 设计 | 价值 |
|---|---|
| **无 Key 也能搜** | 装了就能用，不必先注册任何服务 |
| **多引擎回退链** | 任何引擎失败自动轮下一个，搜索不会直接失败 |
| **结果缓存** | 免费引擎有限流、付费引擎按次计费，缓存同时缓解两者 |

### 实测（本机，2026-02）

| 引擎 | 结果 |
|---|---|
| `html.duckduckgo.com` / `lite.duckduckgo.com` | ❌ 连不上 |
| 6 个 SearXNG 公开实例 | ❌ 全部连不上 |
| **Bing HTML** | ✅ **10 条结果，220~430ms，中文优化** |
| **AnySearch** | ✅ 结构化 JSON，返回 `data.results` |
| **Exa MCP** | ✅ 匿名 MCP，结果带正文 |

> 教训：**先实测再实现**。如果照搬 dsh-free-search 的默认引擎顺序
> （Exa → Tavily → … → Bing），在本机环境下第一次搜索要先把
> 连不上的引擎全超时试一遍。

### 落地

**`src/background/keyless-search.js`（新增）**

- 5 个免费引擎：Bing / AnySearch / Exa MCP / DuckDuckGo / SearXNG
- 各自独立的响应解析器（Bing 抓 `b_algo`、AnySearch 取 `data.results`、
  Exa MCP 解析 `Title:/URL:/Highlights:` 结构化文本）
- `searchKeyless` 按顺序尝试，**返回第一个成功的结果集 + 完整尝试链**
- 全失败时**不抛异常**，而是返回空结果 + 每个引擎的失败原因

**`src/background/search-cache.js`（新增）** —— LRU + TTL

**`src/shared/untrusted.js`（新增）** —— 提示注入防护

- 网页内容包进 `<untrusted-web-content>` 边界
- **剥离正文里自带的同名标记**（否则攻击者能提前闭合边界，
  把后续内容伪装成可信区 —— 这是这类防护最容易漏的一点）

**后台 `search.provider` 路由重写**

```
配置了 Key → 用配置的平台
  └─ 失败 → 免费引擎兜底（结果里注明「已改用免费引擎 X」）
没配 Key   → 直接免费引擎兜底
```

**面板**：`runProviderSearch` 不再因缺 Key 直接失败；对话与总结改用
`searchContextBlockGuarded`。

**设置页**：新增「免费引擎（无需 Key）」分组 —— 兜底开关 + 缓存时长。

### 新增 65 项测试（`keyless-search-test.mjs`）

覆盖：三种响应解析（含真实 HTML 结构）、MCP 的 JSON 与 SSE 两种回包、
**回退链在首个引擎失败后自动轮到下一个**、全失败不抛异常、
缓存 TTL/LRU/关闭、**注入防护的边界剥离**（含大小写变体）、
以及「面板不再因缺 Key 拒绝联网」的源码断言。

## 第四十四轮（1.29.0）—— 时间过滤 + 智能路由（并纠正一个假承诺）

继续参考 <https://github.com/DDDMUC/dsh-free-search>：做 `timeRange` 时间过滤与 `auto` 智能路由。

### ⚠ 最重要的发现：时间过滤在这些引擎上**根本不生效**

我按文档把参数加上了，然后**去验证它是否真的起作用** —— 结果全部为否：

| 引擎 | 参数 | 实测 |
|---|---|---|
| Bing 网页 | `filters=ex1:"ez1"` | ❌ 返回结果与不带过滤**完全一致** |
| Bing 网页 | `qft=+filterui:age-lt1` / `-lt7` / `-lt30` | ❌ 三个档位结果都一致 |
| Bing 网页 | `qft=+filterui:age-lt1` 的日期线索比对 | ❌ 都含同一条「1 天前」和同一条「2026年9月17日」 |
| Exa MCP 匿名端点 | `startPublishedDate` | ❌ 与不带参数时结果一致 |

**结论：免费无 Key 引擎没有一个支持时间过滤。**
（Bing 的时效筛选依赖会话/表单状态，URL 参数这两套写法都不管用。）

### 因此纠正了设计，而不是将错就错

第一版我写了 `TIME_CAPABLE` 包含 `bing` / `ddg` / `searxng-public` / `exa-mcp`，
并且会让 `searchKeyless` 返回 `timeFiltered: true`。**这是假承诺** ——
用户以为拿到的是「最近一周」，实际是旧结果。

改成：

1. **`TIME_CAPABLE` 只保留按官方 API 文档接受时间参数的平台**
   （Tavily / Exa / 博查 / 智谱 / 秘塔 / 百度 / Brave），并注明
   「按接口文档支持，未在无 Key 状态下实测」。
2. **免费引擎一律标注 `timeFiltered: false`**，结果里明确写
   「免费引擎不支持按时间过滤，结果可能包含较早内容；需要严格时间范围
   请配置 Tavily / Exa / 博查 等平台」。
3. **智能路由不再因为「用户想要最新」就去切换引擎** —— 免费引擎都做不到，
   那是假动作。时效需求改为**如实提示**。

> 这一轮真正的产出不是「加了时间过滤」，而是**发现并撤掉了一个假承诺**。
> 参数照常发送（万一服务端哪天支持），但**绝不声称过滤已生效**。

### 落地

**`src/shared/time-range.js`（新增）**

- `normalizeTimeRange` 支持三种形式：固定档（day/week/month/year）、
  相对值（12h / 3d / 2w / 6mo / 1y）、绝对日期（2026-01-01 = 该日期之后）
- 也认中文写法（今天 / 本周 / 本月 / 今年）
- 无法识别时返回 `null`（不做过滤），而不是报错
- `timeParamsFor` 按引擎换算到各自参数名
- `supportsTime` 只认**确实会过滤**的引擎

**`src/shared/search-router.js`（新增）**

- 中文 → Bing（中文优化）→ AnySearch
- 英文 → Bing（最稳）→ Exa（英文质量高）
- 时效需求 → 只提示，不改顺序
- 路由结果保证是输入集合的**排列**（不丢引擎、不新增）
- `describeRoute` 给出可读理由，写进结果里让用户知道为什么选它

**后台 / 面板 / 设置**

- `search.provider` 接受 `timeRange`，缓存 key 含时间范围
- 配置了平台但该平台不支持时间过滤时，也如实标注
- 设置页新增「时间范围」分组：固定档下拉 + 自定义输入（实时回显解析结果）
  + 明确说明免费引擎不支持过滤

### 新增 44 项测试

```
PASS  固定档 day/week/month/year 解析正确
PASS  相对值 12h / 3d / 2w / 6mo / 1y 解析正确
PASS  绝对日期解析正确，斜杠日期也支持
PASS  无法识别时返回 null（不报错）
PASS  各引擎参数映射正确（filters / df / time_range / startPublishedDate / freshness）
PASS  ★ 免费引擎一律不算「支持时间过滤」
PASS  ★ 时效查询如实提示免费引擎无法过滤
PASS  ★ 时效查询不改变引擎顺序（不做假动作）
PASS  路由结果不丢引擎也不新增
PASS  Bing 请求 URL 带上了 filters 参数
```

## 第四十五轮（1.29.1）—— 「问 AI 能不能联网，它说不能」

用户提问：「为什么我与 AI 对话的时候问它，可不可以联网，它说不可以」。

### 根因：模型不知道自己的能力

不是联网坏了 —— 联网本来就能用。**问题是模型看不到自己的运行时能力。**

系统提示里从头到尾只有：系统提示词、字幕原文、检索结果。
**没有任何一句告诉它「你现在可以联网」「你手上有哪些工具」。**

于是它只能凭训练印象推断：
> 「我是一个语言模型，没有联网能力」→ 答「不可以」。

这是**能力自述缺失**，不是功能缺陷。模型对自己所处环境的认知，
必须由宿主（也就是这个扩展）显式提供 —— 它看不见 UI 上的 🌐 开关。

### 修复：`buildCapabilityBlock`

在系统提示开头插入一段**事实性**的能力描述：

```
【你当前的能力（这是事实描述；关于「你能不能…」的问题请据此回答，不要凭训练印象否认）】
· 联网检索：**可用**（使用免费检索引擎（Bing / AnySearch / Exa，无需 Key））。
  当提问涉及外部信息时（最新、是谁、多少钱、查一下等）会自动检索网页，
  检索结果会作为参考资料附在下面。
· 视频字幕：**已加载**（240 行），已在下方给出原文。
· 外部工具（MCP）：未配置。
· 技能：有 4 个可用技能（对话区点 ✨ 选择），本轮未选定。
注意：上面只是「这个浏览器扩展能给模型提供什么」。你本身仍然是语言模型；
请准确区分「我能推理」与「这个扩展给我接了联网/工具」。
```

**关键设计：只描述此刻确实成立的事实，绝不夸大。**
四种联网状态如实区分：

| 状态 | 提示内容 |
|---|---|
| 配了 Key | 「可用」（点名平台，如「博查 Bocha」） |
| 没配 Key 但开了免费引擎 | 「可用」（说明靠 Bing/AnySearch/Exa） |
| 用户关了 🌐 开关 | 「**用户已关闭**」—— 不能说成可用 |
| 两者都没有 | 「当前不可用」+ 引导到设置页 |

来源：第四十四轮。**第一版做成「只要联网功能存在就说可用」是错的** ——
用户关掉开关后模型还说「我能联网」，那就是新的错误信息。

还如实报告本轮状态：检索到几条来源 / 检索失败了（附原因）/ 没检索。
最后一句专门提醒模型**区分「模型本身」与「扩展提供的能力」**，
避免它反过来吹嘘自己天生能联网。

### 顺带修掉的第二个 bug

自动检索的前置判断原来是：

```js
if (shouldSearch && !(activeSearch && String(activeSearch.apiKey || '').trim())) {
  toast({ title: '未能联网：检索平台还没配置 Key' });   // ← 误报
}
```

它只看有没有 Key。**开了免费引擎兜底的用户明明能联网，却会看到这个警告。**
已改为 `searchCapabilityOf()` 统一判断（Key 或免费引擎任一可用即可），
对话与总结共用同一份逻辑。

### 新增 28 项测试

覆盖四种联网状态各自的措辞、检索成功/失败、字幕有无、附件、MCP、Skills，
以及**「联网关闭时不得声称可用」**这条防回归断言。
另外在真实请求路径上断言能力自述确实进了系统提示 ——
否则它会静静地不再被注入。

## 第四十六轮（1.30.0）—— 三个使用体验问题（含一个隐藏的功能性 bug）

### ① 「与后台的连接已断开：扩展后台已卸载或休眠」

**这不是故障，是 MV3 的正常行为被错误地当成错误上报了。**
service worker 空闲约 30 秒会被浏览器回收 —— 设计如此。

而旧实现是：

```js
connect() {
  if (this.port) return this.port;
  this.port = chrome.runtime.connect(...);
  this.port.onDisconnect.addListener(() => {
    this.closed = true;
    h({ error: { title: '与后台的连接已断开', detail: '扩展后台已卸载或休眠。' } });  // ← 立刻报错
  });
}
close() { this.port.disconnect(); this.port = null; }   // ← 用完就断
```

**每次请求新建 port、用完就断** → 下次又要重连 → 恰好赶上 SW 被回收的概率很高
→ 用户频繁看到那条吓人的提示。而实际上后台一切正常。

改法：
- **全程复用一条共享 port**（模块级单例 `sharedPort`），不再反复连断
- 断开时**静默自动重连**（指数退避，上限 5 秒）
- 正在进行的流会**自动重放一次**，用户几乎无感
- `close()` **不再断开共享 port**
- 只有重试也用完，才给出一条能照做的提示
  （「后台暂时无响应…请在 chrome://extensions 点一下刷新按钮」）

### ② 回车发送 / Shift+回车换行

原来是「Ctrl+回车发送」，多按一个修饰键，不符合聊天框的通行习惯。

改为：**回车发送、Shift+回车换行**。
`Ctrl+回车` 保留为兼容（老手感），`Alt+回车` 也换行。
顺带加上「空白内容不发送」的守卫（原来 `'   '` 也会发出去）。

### ③ 模型下拉只列已配置的平台

原来把所有内置平台（**27 个**）和它们的种子模型全列出来，
几十个用不了的条目混在一起，等于没有筛选。

改为：只列**填过 API Key** 的平台。当前正在用的平台始终保留
（否则下拉框里选不中自己当前用的模型），未配 Key 的条目加「（未配 Key）」标注；
一个都没有时显示「尚未配置任何 AI 平台」。

### 🔴 顺带发现的功能性 bug：MCP 工具在对话里**从未生效过**

排查时发现的：`chatWithTools` 只挂在 **RPC** 路由 `'ai.chat'` 上，
而面板的对话走的是**流式**路由 `Stream.start('ai.chat')` → `runStreamRoute`
—— 后者**完全没有收集 MCP 工具**，直接走了纯文本 `chatStream`。

也就是说：**第四十轮做的 MCP 工具调用，在真实的对话流程里一次都没跑过。**
`mcp-test.mjs` 测的是 `chatWithTools` 本身，`bg-test.js` 测的是 RPC 路由，
**两者都没覆盖「面板实际走的那条路」** —— 这是测试覆盖的盲区，不是实现写错。

修复：`runStreamRoute` 现在会在 `mcp.enabled` 时收集工具，
有工具就走 `chatWithTools`（整段返回），没有则保持 `chatStream`（保留逐字输出）。
工具事件通过新增的 `stream:tool` 通道推给面板，面板侧 `onTool` 已经接好。

> 教训：**测试要打在真实调用路径上。**
> 单测一个函数通过，不代表用户点下去的那条路会经过它。

### 新增 29 项测试

- 长连接：源码断言 + **行为验证**（用可注入的 connect 桩真实跑 Stream，
  验证复用同一 port、断开后自动重连、后台回收时不立刻报错而是重放）
- 回车键：**真实按键模拟**（dispatchEvent 后断言是否发送、
  Shift+回车是否阻止默认行为、输入框是否清空、空白内容是否被拦）
- 模型下拉：过滤条件、当前平台保留、未配 Key 标注、空态占位

## 第四十七轮（1.31.0）—— 思维链分离 + 参考 obsidian-yolo 的对话体验

用户提出两点：① 思维链与最终结果分开、可折叠；② 对话功能参考
<https://github.com/Lapis0x0/obsidian-yolo>。

### ① 思维链与最终回答混在一起

**根因是一行代码**（`providers.js` 的 `chatStream`）：

```js
piece = (c.delta && (c.delta.content || c.delta.reasoning_content)) || c.text || '';
```

`reasoning_content` 与 `content` 被当成同一个东西，一起拼进 `full`。
于是推理模型（deepseek-reasoner）的**心路历程和最终回答混成一段文字**，
既读不清，也无法折叠。

改法：两条通道彻底分开

```js
think = d.reasoning_content || d.reasoning || d.thinking || '';
piece = d.content || '';
if (think) { reasoning += think; onReasoning?.(think); }
if (piece) { full += piece; onDelta(piece); }
```

`onReasoning` 由后台经新增的 `stream:reasoning` 通道推给面板。

### 折叠块的三个状态（照抄 yolo 的 stage 设计）

| 阶段 | 条件 | 显示 |
|---|---|---|
| `requesting` | 已发请求、还没吐字 | 「正在请求…」 |
| `thinking` | 正在输出思维链、正文未开始 | 「思考中…」+ **单行滚动预览** |
| `settled` | 正文开始或结束 | 「已思考 N 秒」，点击展开全文 |

**关键设计（也是抄 yolo 的）**：

- **默认折叠** —— 思考过程动辄上千字，展开会把回答挤出屏幕
- **折叠时不渲染全文** —— yolo 的注释说得很清楚：上万字的子树留在
  `grid-template-rows: 0fr` 里只是视觉压成零高，**整棵子树仍参与每次布局**
- **折叠时给单行预览** —— 用户仍知道模型在想什么，又不占地方
- 设置里可改「默认展开」，用户点过则以其选择为准

### ② 参考 obsidian-yolo 做的对话改进

选的是**可移植**的部分（它是 Obsidian/Electron 插件，Vault / CLI / 本地 Bash
这些都依赖桌面能力，浏览器扩展做不到）：

| 借来的做法 | 落地 |
|---|---|
| **生成中可继续发消息，排队** | 输入框不再只是「禁用」；回车把消息入队，当前回合结束后自动发出，队列条可单条移除 |
| **中止时未发出的消息还回输入框** | 不静默丢弃 —— 这是 yolo 明确写出的行为 |
| **消息级操作** | AI 消息：复制 / 重新生成（截断其后对话并重跑）；用户消息：编辑重发（取回输入框并截断其后） |
| **Esc 全局停止生成** | 不再只能点按钮 |
| **可配置回车行为** | 对应它的「Use Enter to start a new line」：默认回车发送，可切成回车换行 + Ctrl/Cmd 回车发送 |

### 过程中发现的第三个 bug：`state.streaming` 会永久卡住

写测试时发现的：`state.streaming` 是纯内存标志，
**如果某条流既没收到 `onEnd` 也没收到 `onError`**（SW 被回收、页面挂起、
连接静默断开），它会永远停在 `true` —— 后果是回车永远变成「排队」、
发送按钮一直不可用，**用户完全没法继续对话**。

加了自愈：`isBusy()` 检查标志为 true 但没有 stream 对象、
且超过 15 秒没有新内容时，判定失效并复位。

### 新增 28 项测试（`reasoning-test.mjs`）

用**可编排的假 SSE 服务端**真实跑 `chatStream`：

```
PASS  正文只包含最终回答
PASS  正文**不含**推理内容
PASS  推理内容通过 onReasoning 单独产出
PASS  onDelta 只收到正文分片
PASS  reasoning 与 reasoning_content 都被识别为推理
PASS  交错到达时正文仍只含回答
PASS  非推理模型不产生推理内容
PASS  未传 onReasoning 时不报错
```

> **诚实标注**：Anthropic 的 `thinking_delta` 分支**无法端到端验证** ——
> `isAnthropic()` 靠 URL 里是否含 `anthropic.com` 判断，而该域在当前沙箱
> 被网络策略拦截（connect=0）。所以那一部分只做了源码级断言，
> 并在测试里明确注明「未经真实请求验证」。

## 第四十八轮（1.32.0）—— 联网提示在撒谎；总结联网核实；简介与评论

用户反馈：「每次问 AI 联网问题，总会出现『这一轮我没有拿到联网检索结果。
前面那条系统提示里说"检索结果会作为参考资料附在下面"，但这次并没有附上任何网页内容』」

### ① 先诊断：检索本身是好的

写了一个探针直接调后台的 `search.provider` 路由：

```
=== 直接调用 search.provider ===
耗时: 442 ms
ok: true
provider: 免费引擎（Bing 网页）
结果数: 3
```

再测几个真实提问也都正常返回。**所以问题不在检索，在我们的提示词。**

### ② 真正的原因：能力自述承诺了做不到的事

第四十五轮加的能力自述里写的是：

> 联网检索：**可用**。当提问涉及外部信息时（最新、是谁、多少钱、查一下等）
> **会自动检索网页，检索结果会作为参考资料附在下面**。

但检索是**按关键词触发**的 —— 有没有命中那个正则，决定了搜不搜。实测：

| 提问 | 触发检索 | 自述里承诺会搜 |
|---|---|---|
| 你能联网吗 | ❌ | ✅ |
| 帮我看看这个对不对 | ❌ | ✅ |
| 介绍一下这个视频 | ❌ | ✅ |
| 今天有什么新闻 | ✅ | ✅ |

**没命中的时候，模型收到的系统提示里写着"会附参考资料"，但下面什么都没有。**
它只能诚实地说「我查不到」—— 用户看到的就是那段话。

**这是我们的提示在撒谎，不是模型出错。**

改法两条：
1. **自述改成与行为一致**：区分「本轮已检索（N 条来源见下）」与
   「**本轮没有进行检索，所以下面不会有网页资料**」，并要求
   「**绝对不要声称自己查过网页**」
2. **扩大触发范围**：新增 `needsWebSearch()`，专门覆盖两类以前漏掉的提问 ——
   - 直接问联网能力或要求检索（`你能联网吗`、`查一下`、`帮我查`）
   - 要求核实求证（`核实`、`对不对`、`准确吗`、`是真的吗`）

### ③ 总结时联网核实（用户要求的「多方求证」）

原来总结只是把**上一次的搜索结果**塞进去 —— 从没主动搜过，
所以「联网核实」形同虚设。现在生成总结前**主动检索一次**：
检索词由 `buildVerifyQuery()` 从「视频标题 + 字幕里最长的两句」拼出
（最长句通常事实最密集：人名、数字、产品名）。

系统提示里明确要求模型：
- 与字幕冲突时**以网页资料为准**，并用 `[来源 N]` 标注
- 资料没覆盖的内容**保持原样，不臆测**
- 发现字幕说法有误时，文末单列一条「⚠️ 已更正」

### ④ 视频简介与热门评论

- **简介**：`page-bridge.js` 新增 `descFromPage()`（`__INITIAL_STATE__` 优先，
  DOM 兜底），`bili.js` 的 view 接口也补了 `desc` 字段
- **评论**：`bili.js` 新增 `fetchTopComments()`，走 `/x/v2/reply`（非 wbi，无需签名）。
  **实测可用** —— 拿某视频抓到 234,790 条评论总数，首条 75.8 万赞。
  失败一律返回 `ok:false`：评论只是锦上添花，绝不能因为它让总结失败。

评论默认**关闭**（多跑一次接口，且评论区噪声大），在设置里可开。

### 新增 18 项测试

```
PASS  「你能联网吗」会触发检索
PASS  「你可以上网查资料吗」会触发检索
PASS  「帮我核实一下」会触发检索
PASS  「这个说法准确吗」会触发检索
PASS  纯寒暄不触发（避免无谓消耗）
PASS  核实检索词含视频标题 / 字幕长句，且不超过 120 字
PASS  未检索时明说「本轮没有进行检索」
PASS  未检索时不承诺「会附在下面」
PASS  未检索时要求不得声称查过网页
```

> 教训再次印证「第四十四轮」那条：**提示词描述的行为，必须与代码实际行为一致。**
> 否则模型会基于错误的自我认知，给出看起来"不听话"其实完全正确的回答。

## 第四十九轮（1.33.0）—— 联网核实重做：整篇搜索 → 逐条核对

用户反馈：「**你这联网后的内容和字幕内容相差好大，而且还污染了输出的内容**。
我想让你做的是联网对字幕里面的术语、逻辑进行修正。」

### 我上一轮做错了什么

第四十八轮的实现是「用视频标题搜一次 → 把结果整块塞进上下文」：

```js
const query = buildVerifyQuery(st);              // 标题 + 两句最长字幕
const out = await doProviderSearch(query);
searchBlock = searchContextBlockGuarded(out.results, ...);   // ← 污染源头
```

而 `searchContextBlock` 每条来源会带 **最多 3000 字正文**，
`fetchPageContent` 默认开启 → **6 条 × 3000 字 ≈ 12000 字无关网页**，
而字幕本身才被截到 40000 字。

**结果：上下文里一半是网页，一半是字幕。模型自然开始讲网页。**
这不是模型跑偏，是我给它的材料就错了。

### 重做：只核对「具体条目」

新增 `src/shared/verify.js`，四步：

**① `extractVerifyItems(lines)` —— 抽出具体的待核实项**

只挑这几类（最容易出错、也最好核实）：
年份、数字+单位（金额/比例/参数量）、版本号、英文术语/产品名、中文专业名词。
带权排序，并过滤掉「视频/大家/这个/所以」这类在任何网页里都出现的口语大词。

实测效果（一段 AI 新闻字幕）：

```
· 2026 年
· 6710 亿
· 557 万
· DeepSeek
· GPT-4
· token
· MoE
· MLA
```

—— 全是**能查证的具体事实**，没有一个是废话词。

**② 逐条检索，`fetchPageContent: false`**

只要摘要，**不抓网页正文**。这是把 12000 字压到 400 字的关键。

**③ `isRelevantToQuery()` —— 相关性过滤（防污染的核心）**

结果标题或摘要里，至少要命中待核实项的一个特征片段，否则丢弃。

```
❌ 丢弃  日历网 - 今日黄历          （用 "DeepSeek V4" 搜出来的）
✅ 保留  DeepSeek V4 正式发布
✅ 保留  百度百科 DeepSeek
```

这条规则是针对实测发现的：之前用「今天有什么 AI 新闻」搜回来的是
**日历网、黄历、成都天气预报** —— 全都混进了总结上下文。

**④ `verifyContextBlock()` —— 紧凑、且明确禁止转述**

刻意**不叫**「参考资料」（那个说法会让模型开始转述网页），
改叫「字幕条目核对结果」，并写明：

> · 只用于**校正**字幕里对应条目的错误
> · **不要**把证据里的内容写成总结的一部分，不要介绍这些网页
> · 证据没覆盖的条目，保持字幕原样，不要臆测

### 顺带修掉的一个副作用

核实要连续跑好几条检索，而 `doProviderSearch` 每次都写全局检索面板 +
弹「检索完成」提示 —— 会把用户上一次手动搜的结果冲掉，还刷屏。

给 `doProviderSearch` 加了 `quiet` / `ephemeral` 选项，核实流程按
`ephemeral: true` 调用：**不写面板、不弹提示、不显示任务条**。

### 新增 24 项测试

```
PASS  抽出了年份或数字
PASS  抽出了专有术语
PASS  没有把口语词当核实项
PASS  无关结果被判定为不相关
PASS  相关结果被保留
PASS  空标题空摘要判为不相关
PASS  核实块要求只用于校正
PASS  核实块禁止转述网页
PASS  核实块不叫「参考资料」（避免模型转述）
```

> 教训：**给模型的材料错了，再好的模型也会跑偏。**
> 「联网核实」不等于「把网页塞进去」—— 核实的粒度必须是**字幕里的具体条目**，
> 否则检索回来的内容跟字幕根本不在一个层面上。

## 第五十轮（1.34.0）—— AI 优化升级 + 侧边栏打不开 + 切换视频残留

三个问题一起处理。

### ① AI 优化：从「纠错别字」升级到「五类校正」

原来只做错别字/同音字/专有名词，提示词一句话概括。
现在明确覆盖五类，并要求给出修正**类型**：

| 类别 | 说明 |
|---|---|
| 错别字 | 语音识别最常见的同音字错误 |
| 术语 | 人名、公司名、产品名、技术名词的写法 |
| 时间 | 年份、月份、日期与上下文是否自洽 |
| 数据 | 数字、金额、比例、参数量、版本号 |
| 逻辑 | 前后矛盾、因果颠倒、同一数字前后不一致、违背常识 |

联网证据的用法也**按第四十九轮的教训改了** —— 不再整篇搜索后把网页正文灌进来，
改成**逐条核对**（复用 `extractVerifyItems` / `verifyItems`），
并明确要求模型「**不要把参考资料里的内容写进字幕**，资料只用来判断某条对不对」。

还加了一条很重要的约束：

> **拿不准的不要提。宁可漏，不要错改 —— 错误的修正比不修正更糟。**

界面上按类别统计（`错别字 3 · 术语 1 · 时间 2`），每条建议带类别徽章。

### ② 播放器字幕按钮「点了没反应」

根因是这一行：

```js
chrome.sidePanel.open({ tabId }).catch(() => {});   // ← 错误被完全吞掉
```

失败时我们什么都不知道，用户看到的就是「点了没反应」。
把它改成**回报结果**，并区分两类失败：

- **手势限制**（Chrome 要求 `sidePanel.open()` 必须来自用户手势）→
  给出可照做的指引：「请点浏览器工具栏上的扩展图标」
- **其它错误** → 原样报出

内容脚本侧加了兜底：
- 失败后 **260ms 重试一次**（首次失败常常是侧边栏正在切换状态）
- 仍失败则在页面底部弹一条提示条（6 秒后自动消失），
  而不是让用户对着没反应的按钮发呆
- 打开前先 `setOptions({ enabled: true })`，避免该标签页被禁用过

> 说明：`chrome.sidePanel` **只在扩展页面可用**，内容脚本拿不到，
> 所以不能「在点击回调里直接调用以保住手势」——
> 那条路走不通，只能靠消息链 + 失败兜底。这一点在代码注释里写清了。

### ③ 上一次读取的残留影响这一次

`loadVideo()` 原来是直接 `store.set({ video })`，**什么都不清**。
从 A 视频切到 B 视频后，左侧还是 A 的字幕、总结还是 A 的内容、
对话历史也混着 A 的。

现在按 `signature`（bvid + 分P + cid）判断是否换了视频，换了就清掉
**所有由视频派生的状态**：

```
subtitles · summary · summaryStream · chat · transcriptLog · search
```

顺带补上 `navigate` 事件处理器里漏掉的两项 —— 它清了
`subtitles/summary/chat`，但**没清 `transcriptLog` 和 `search`**。

只清「由视频派生的」数据，不动设置、缓存、导出配置等全局状态。

### 新增 21 项测试

```
PASS  优化提示词覆盖错别字/术语/时间/数据/逻辑
PASS  优化提示词要求「宁可漏不要错改」
PASS  优化提示词禁止把资料写进字幕
PASS  优化流程用逐条核对而不是整篇搜
PASS  bsub:open-side-panel 会回报失败原因
PASS  后台区分「需要用户手势」并给出指引
PASS  内容脚本有兜底提示条
PASS  内容脚本失败后会重试一次
PASS  loadVideo 换视频时清字幕/总结/对话/转录日志/检索结果
PASS  navigate 事件也清 transcriptLog / search
```

## 第五十一轮（1.35.0）—— 生成总结改为「先校对字幕，再总结」

用户明确的流程要求：

> 点生成总结时，先检查字幕中是否存在术语、逻辑、时间、事实等错误（此时联网），
> 进行更正，用更正后的字幕生成总结；原有字幕文件已经发生修改，
> 但**可以回退至原有的字幕**。

### 从「边说边改」改成「先改后说」

上一版是把核对证据塞进总结上下文，让模型一边总结一边校正。
问题是：**校正与总结混在一起** —— 用户看不清到底改了什么，
也没法回退（因为根本没真的改字幕）。

现在拆成两个阶段：

```
点「生成总结」
  ├─ 阶段 1  校对字幕（联网核对 术语/逻辑/时间/事实）→ 写回字幕 + 备份原始字幕
  └─ 阶段 2  用**更正后的字幕**生成总结
```

新增 `proofreadSubtitles()`：
- 抽出待核实项（复用第四十九轮的 `extractVerifyItems`）→ 联网逐条核对
- 让模型给出修正（复用 `buildOptimizeMessages`，即五类校对的提示词）
- **把修正真的写回 store**，并在首次校对前把原始字幕备份到 `subtitlesOriginal`
- 备份只在「还没有备份」时做一次 —— 否则二次校对会把「已更正版」当成原文，
  回退就退不回最初那一份了

新增 `revertSubtitles()`，工具栏上多一个「回退字幕（已改 N 处）」按钮。

换视频时清空 `subtitlesOriginal`，避免拿 A 的原文去回退 B 的字幕。

### 飞书文档格式

用户指定的提示词已经**就是** `constants.js` 里的 `DEFAULT_SYSTEM_PROMPT`：

> 整理这期视频的内容（可以用表格、代码块、高亮块、引用、超链接、公式、图片等飞书支持的格式输出，可以加上一些图标增加可读性）

另加一段 `FEISHU_FORMAT_RULES`，把「飞书支持的格式」落到具体的 Markdown 写法上：
标题 / **粗体** *斜体* ~~删除线~~ / 有序无序列表 / 任务列表 / 引用 /
围栏代码块（带语言）/ 管道表格（必须有表头与分隔行）/ 链接 / 分割线 / LaTeX 公式。
并明确**不要输出**内嵌 HTML、脚注、自定义容器、base64 图片；
图片无法通过文本携带，要求用文字说明「此处建议配图：…」。

> ⚠ **诚实说明**：飞书官方文档站是 JS 渲染的，`Invoke-WebRequest` 拿到的只有
> 7KB 的空壳（正文抓不到），所以这份清单是**基于既有知识整理的，没有对着官方规范逐条核对**。
> 为此做了防御设计：即使某个语法飞书不认，它也只是显示成纯文本，
> 不会导致总结出错或用不了。
> 建议你生成一次后粘进飞书，把不生效的语法告诉我，我再收紧规则。

### 顺带修掉一个隐蔽的测试基建 bug

加了 LaTeX `$$...$$` 之后，`panel-test.js` 与 `flow2.js` **同时崩了**，
报的是 `SyntaxError: Invalid or unexpected token` —— 与真实代码毫无关系。

根因：它们都用 `String.replace('__BUNDLE__', bundleCode)` 注入打包产物，
而**字符串形式的 replacement 里 `$$` 是特殊模式**（表示一个字面 `$`），
`$&`、`` $` ``、`$'` 也各有含义。bundle 里的 `$$...$$` 被悄悄改写，
于是注进去的 JS 变成了非法代码。

改为**函数形式** `replace(pattern, () => code)` —— 函数返回值不做任何特殊解释。

> 这个 bug 的教训：**替换字符串里出现 `$` 就要用函数形式**。
> 它伪装成「代码语法错误」，会让人去查业务代码，实际错在测试基建。

### 新增 12 项测试

```
PASS  导出了 proofreadSubtitles / revertSubtitles
PASS  格式规则含标题/表格/代码块/引用/分割线/LaTeX/超链接
PASS  格式规则排除内嵌 HTML
PASS  格式规则说明图片无法携带
PASS  格式规则提醒不要编造链接
PASS  默认提示词是用户指定的原句
```

## 第五十二轮（1.36.0）—— 界面瘦身：次要按钮收进「⋯」菜单

用户反馈：「界面的按钮还是太多了，可以对相应的按钮进行简化合并，方便操作；
简洁大方美观。」

### 问题

操作区一屏 **14 个按钮**（7 个次要 + 4 个工具 + 检索行 3 个），
主操作混在里面，用户不知道该点哪个。字幕面板与 AI 面板同样偏多。

### 做法：分层

每屏只留 **1 个主操作** + 少量常用项，其余按语义收进溢出菜单。

**新增 `popoverMenu()`（`ui.js`）** —— 可复用的「⋯」菜单组件：

- 点触发器展开／再点收起
- 点条目后自动关闭
- **点菜单外部关闭**（捕获阶段监听，保证先于其它处理器）
- **Esc 关闭**并聚焦回触发器
- 支持分隔线与禁用项

**操作区（`panel-actions.js`）：22 处 → 10 处**

```
可见：[主操作]  [⋯]                  检索框 + [检索] [直接搜索]
菜单：🔄 重新读取视频   📥 重新抓取字幕   🎙️ 语音转录
      ✨ AI 优化字幕   🔁 应用替换规则
      📑 生成章节       🩺 质量自检   📋 复制全部字幕
      🕘 历史记录       🗂️ 批量处理
```

**AI 面板（`panel-ai.js`）：13 处 → 8 处**

可见只留「生成总结」；生成中才出现「停止」。
复制总结 / 导出总结 / **回退字幕** / 重置会话 收进菜单
（回退字幕带「已改 N 处」提示）。

**字幕面板（`panel-subtitles.js`）：16 处 → 9 处**

复制全部 / 导出 / 统计 / 生成章节 / 质量自检 收进菜单。

### 视觉整理

- 模型下拉 `margin-left: auto` 推到右侧，与左侧图标组拉开距离
- 图标按钮再小一点（26×24），减少视觉噪声
- 动作按钮统一 7px 圆角；主按钮加粗并加一点投影，
  让「下一步点哪」一眼可见

### 新增 11 项测试

菜单组件是新增的交互，测的是**真实行为**而不只是源码存在性：

```
PASS  菜单渲染出 3 个条目
PASS  菜单有分隔线
PASS  禁用的条目被置灰
PASS  初始为收起状态
PASS  点击触发器后展开
PASS  点条目会执行回调
PASS  点条目后自动收起
PASS  可再次展开
PASS  点菜单外部会收起
PASS 按 Esc 会收起
PASS  可见按钮不超过 6 个（避免一屏全是按钮）
PASS  菜单里含 AI 优化字幕 / 生成章节 / 质量自检 / 历史记录 / 批量处理
```

最后两条是**防回归**：以后再加按钮时，如果又铺平一堆到界面上，
`可见按钮不超过 6 个` 会直接失败。

## 第五十三轮（1.37.0）—— 总结进度条 / 去掉手动检索行 / 空菜单

用户三个反馈：

### ① 「AI 总结界面也加一个类似语音转录的进度条，不然不知道进度」

语音转录用的是全局 `jobs` 任务条（`#jobs`）。总结原来只把按钮文字改成
「生成中…」，用户不知道卡在哪一步。

现在整个总结流程挂到一个可取消任务上，并**分三阶段报告**：

| 阶段 | 进度 | 文案 |
|---|---|---|
| 准备校对 | 2% | 第 1/3 步：准备校对字幕 |
| 联网核对 | 5% → 50% | 第 2/3 步：联网核对 3/6 · DeepSeek |
| AI 给出更正 | 52% | 第 2/3 步：让 AI 给出字幕更正… |
| 生成总结 | 60% → 95% | 第 3/3 步：生成中（已 428 字） |
| 完成 | 100% | 完成（1234 字） |

生成阶段无法预知总长度，所以用**已输出字数**做温和推进
（`60 + log10(chars+1) * 11`），并把上限压在 95% ——
**不假装能提前知道要到 100%**，收尾时才置满。

为此给 `verifyItems()` 加了 `onProgress` 回调，逐条核对时都能报进度。

### ② 「字幕与总结界面的网络检索那一行好怪，我是让 AI 自己联网的」

说得对。原来那是一整行「关键词输入框 + 检索 + 直接搜索」的手动检索栏，
但它**既占地方，又容易被误解成「必须自己点才会联网」** ——
而实际上生成总结与对话都会自动联网。

已移除整行。现在只在**已经有来源**时显示一个入口：
`🔗 查看 6 条检索来源 · 已被引用 12 次`。没有来源时整行不出现。

### ③ 「生成总结旁边的 ⋯ 点开后里面什么也没有」

查了一下：菜单**渲染是正常的**，问题是**所有条目都处于禁用态** ——
没有总结时「复制总结/导出总结」禁用，没有校对过时「回退字幕」禁用，
`opacity: 0.4` 四个灰字看起来就像空的。

两处改动：
1. **全部条目不可用时，不再渲染一堆灰按钮**，而是直接说明原因：
   - 没有字幕 → 「还没有字幕」+「先抓取字幕或做语音转录」
   - 有字幕未生成 → 「先生成一次总结」+「生成后这里会出现：
     复制 / 导出 / 回退字幕 / 重置会话」
2. 禁用项的透明度从 0.4 提到 0.55，至少要看得清

这是 `popoverMenu` 的通用能力（新增 `emptyText` / `emptyHint` 选项），
以后任何菜单都能受益。

### 新增 10 项测试

```
PASS  不再有手动检索输入框（改由 AI 自动联网）
PASS  没有来源时不出现检索来源入口
PASS  全部禁用时显示说明文字
PASS  全部禁用时给出下一步提示
PASS  全部禁用时不再渲染灰按钮
PASS  有可用条目时不显示空态说明
PASS  总结流程创建了任务
PASS  校对阶段报告核对进度
PASS  生成阶段报告已输出字数
PASS  结束时把进度置满并收尾 / 出错时也收尾任务
```

## 第五十四轮（1.38.0）—— ⋯ 菜单被裁掉 / 导出格式 / 全流程留痕与回退

### ① 「⋯ 点开看不到」—— 根因找到了

上一轮我以为是「所有条目禁用导致看着像空的」，改了文案。但那不是主因。

真正的原因：**`#view` 有 `overflow: hidden`**，而菜单面板原是
`position: absolute` 定位在 `#actionbar` 内部 —— **展开后被祖先直接裁掉**。
DOM 里一切正常，检查元素也看得到，就是**画不出来**。

改法：菜单面板**挂到 `document.body` 并用 `position: fixed`**，由
`getBoundingClientRect()` 计算位置，同时：

- 右对齐触发器，但**超出视口时自动收回**
- 下方放不下就**翻到上方**
- 滚动 / 改变窗口尺寸时自动关闭（避免位置漂移）
- `z-index` 提到 2147483000
- 关闭时从 DOM 移除，不留垃圾节点

> 教训：这类「DOM 正常但看不见」的问题，第一反应应该是
> **查祖先的 overflow / z-index / transform**，而不是改内容。

### ② 导出格式选择

其实**格式选择弹窗早就有了**，问题是两个入口行为不一致：

| 入口 | 原行为 |
|---|---|
| 操作区「导出」 | **直接下载**（用上次记住的格式，不弹窗） |
| ⋯ 菜单「导出字幕」 | 弹出格式选择 |

用户点的是前者，自然以为「不能选格式」。现在**两个入口都弹格式选择**。

### ③ 全流程留痕与回退（新增 `timeline.js`）

原来只有零散的备份：`subtitlesOriginal` 只保一份原文，**只能整体回退一次**；
「抓字幕 → AI 优化 → AI 校对 → 生成总结」之间回到中间某一态是做不到的。

新增**会话内快照时间线**：

- `setLines()` 是所有改写字幕路径的汇聚点，留痕就放在那里 ——
  抓字幕、AI 优化、AI 校对、手动改行**全部自动记录**，不用逐处调用
- 记录**是什么操作**造成的变化 + 时间 + 摘要（如「更正 3 处」）
- **内容没变就不重复留痕**（否则一堆「无变化」的快照毫无价值）
- 最多保留 40 步
- **回退本身也留痕**，所以「退过去就回不来」不会发生
- 换视频时重开时间线（旧视频的步骤混进来会让人困惑）

入口在 ⋯ 菜单 →「历史记录」，弹窗分两段：
**本会话操作留痕（可回退）** 与 **其它视频的历史**。

只快照「由视频派生的内容」（字幕/总结/对话/校对结果），
**不含设置与密钥** —— 回退不会碰你的配置。

### 新增 14 项测试

时间线是回退功能的核心，测的是**完整往返**：

```
PASS  第 1/2/3 步分别被记录
PASS  内容未变化时不重复留痕
PASS  list() 按时间倒序（最新在前）
PASS  回退返回目标快照
PASS  回退后字幕恢复原样
PASS  回退后总结被清空
PASS  回退本身也留痕
PASS  可以再退回到之后的状态（回退可逆）
PASS  留痕条数不超过上限
PASS  菜单面板挂到 body（不被 overflow 裁剪）
PASS  收起后菜单面板从 DOM 移除
PASS  菜单能展开且挂到 body
```

## 第五十五轮（1.39.0）—— 修好「⋯ 全都点不了」+ 常用按钮摆出来

### ① 「所有的 ⋯ 都点不了了」—— 是我上一轮改坏的

上一轮我把菜单面板**挂到 `document.body`** 并用 `position: fixed` 定位，
想绕开 `#view` 的 `overflow: hidden`。渲染确实正常了，但引入了新 bug：

面板移出 `wrap` 之后，「点击外部关闭」的判定
（`!wrap.contains(ev.target)`）**会把触发器自己也算成外部**。
于是点一次开、再点一次先关后开，最终表现为**「点了没反应 / 全点不了」**。

**这解释了你看到的现象。抱歉，是我改坏的。**

改法：不再往 body 上挂，面板**留在 `wrap` 内做绝对定位**，
问题从根上解决 —— **开关统一用 `pointerdown`，不用 `click`**：

```js
trigger.addEventListener('pointerdown', ...)            // 开关
document.addEventListener('pointerdown', onDocDown, true) // 点外部关闭
```

为什么这样就没有竞态：`pointerdown` 先于 `click`。
若开关与「点外部关闭」都挂在 `click` 上，同一次点击会先在文档上判为
「外部」把菜单关掉、再触发触发器把它打开 —— 顺序一乱就出错。
两者都放到 `pointerdown`，就在同一个事件里一次性判定完。

顺带补上键盘可达性：触发器支持 Enter / 空格开关。

遮罩裁剪问题改由 CSS 做**最小放开**（只放开含菜单的容器与 `#view` 的纵向），
不再动定位方式。

> 教训：**「把一个组件从 A 挂到 B」不是小事。**
> 它改变了所有依赖 DOM 位置关系的判断（这里是 `contains` 判定），
> 而这些判断往往散落在周边代码里，很容易漏。

### ② 常用按钮摆出来

用户：「将常用的功能按钮摆出来，不常用的放在 ⋯ 里面」。

上一轮我把几乎所有次要操作都塞进了菜单，确实过头了。现在按**使用频率**分层：

**字幕就绪后直接可见**（7 个以内）：
```
③ 生成总结  去提问  ✨优化字幕  复制  导出  ⋯
```

**收进 ⋯ 菜单**（低频）：
```
🔄 重新读取视频   📥 重新抓取字幕   🎙️ 语音转录
🔁 应用替换规则   📑 生成章节       🩺 质量自检
🕘 历史记录与回退  🗂️ 批量处理
```

### 新增 6 项防回归测试

```
PASS  连续点击能稳定开关（开关/开关）      ← 就是这次 bug 的回归测试
PASS  菜单面板在 wrap 内（触发器不会被误判为外部）
PASS  再点一次可收起
PASS  空态显示「读取当前视频」主按钮
PASS  ② 常用按钮直接可见（提问 / 优化字幕 / 复制 / 导出）
PASS  ② 可见按钮不超过 7 个               ← 防止又铺平一堆
```

## 第五十六轮（1.40.0）—— 菜单「看不到按钮名称」

用户反馈：`⋯` 能点开了，但**看不到按钮名称，（应该超出界限了）**。

> 「应该超出界限了」—— 这个判断是对的。

### 用真实浏览器量出来的根因

`jsdom` 不做布局，所以这类问题在单元测试里永远看不出来。
我写了个 CDP 脚本，用**真实 Chrome 渲染侧边栏并测量几何**，一次就定位了：

```
触发器宽度 = 32px（「⋯」很窄）
面板宽度   = 190px
面板定位   = absolute / right: 0
实测面板   = left: -32px          ← 左边超出视口 32px
标签       = left: 6.9px           ← 图标在这个范围，能看见
             右边缘 164 + 图标偏移 → 文字被推出视口外
```

**机制**：面板 `right: 0` 是相对**触发器**右对齐的，而触发器只有 32px 宽、
面板 190px —— 于是面板一路向左伸出，越过视口左边界 32px。
图标在面板左侧（还看得见），**文字在右侧，正好被挤到视口外**。

### 修法（迭代了三版，每版都重新量）

1. **改左对齐**（`left: 0`）→ 320px 视口下仍越界（面板右边缘 316 > 320-8）
2. **加「窄视口就右对齐」的开关** → 实测发现右对齐在 320px 下 `left: -32` 更糟，
   说明「左/右二选一」根本不是办法
3. **最终：算出希望的位置再夹进视口**

```js
const wrapRect = wrap.getBoundingClientRect();
let viewportLeft = trigger.getBoundingClientRect().left;
viewportLeft = Math.min(viewportLeft, vw - panelWidth - 8);
viewportLeft = Math.max(viewportLeft, 8);
panel.style.left = `${viewportLeft - wrapRect.left}px`;  // 换算到相对 wrap
```

> ⚠ 第 3 版里我**踩了一个坐标系坑**：`panel.style.left` 是相对定位祖先
> （`.menu-wrap`）的，而 `getBoundingClientRect()` 是相对视口的。
> 第一版没换算，直接赋值导致面板整体偏移了一个 `wrap.left`（更糟了）。
> 量出来的数字对不上，才发现是坐标系没统一。

**实测三个宽度都正确**（面板 190px）：

| 视口 | 面板左 | 面板右 | 标签右边缘 |
|---|---|---|---|
| 260 | 62 | 252 | 238 ✅ |
| 320 | 122 | 312 | 298 ✅ |
| 400 | 126 | 316 | 302 ✅ |

外加：`box-sizing: border-box`（否则 1px 边框 + 4px 内边距会把宽度撑到 200px）、
`max-width: min(260px, calc(100vw - 16px))`、`overflow-x: hidden`、
`@media (max-width: 240px) { min-width: 0 }`（极窄时允许收缩）。

### 教训

**「元素存在但看不到」必须在真实浏览器里量几何，不能靠猜。**

这一轮我先后猜了三次原因（条目禁用、overflow 裁剪、对齐方向），
每次都改错了地方；真正定位靠的是**把 rect / scrollWidth / 计算样式打出来**。
据此新增了 4 项计算样式断言（左对齐、border-box、有 max-width、禁横向溢出），
把这次的坑钉住。

（验证用的 CDP 截图脚本用完已删除，避免污染仓库；需要时可重写。）

## 第五十七轮（1.41.0）—— 按钮归位 / 总结变丰富 / 合集批量 / 两个模型疑问

### ① 复制总结、导出总结、重置对话拿出来

用户要求把这三个从 `⋯` 里拿出来。现在 AI 工具栏：

```
生成总结   复制总结   导出总结   重置对话   ⋯
                                          └ 回退字幕
```
`⋯` 里只剩「回退字幕」（它需要先校对过才有意义）。

### ② 总结「好单调」—— 强化提示词

原来的格式规则只是**罗列**了飞书支持的语法，模型多半只写标题加段落。
现在改成**带具体做法与顺序**的写作要求：

- **先给一句话结论**，紧接一个「速览」表格（3~6 行）
- **该用表格就用表格** —— 对比、参数、时间线、优劣、步骤一律表格化
- **引用块（`> `）用来强调关键判断或原话**，飞书会渲染成高亮块样式
- 代码块 / 超链接 / LaTeX 公式 / 任务列表 / 分割线 / emoji 小标题
- 图片无法文本携带 → 用 `> 🖼️ 建议配图：…` 占位

同时保留两条硬约束：**内容必须全部来自字幕**、**不要编造链接**。
（加「丰富格式」很容易诱发模型编内容，所以这两条必须钉住。）

### ③ B 站合集批量处理（也支持一个个处理）

**做法**：把合集链接**展开成每个视频的 URL**，再喂进已有的批量队列。
这样「批量」与「一个个」（从队列里移除/暂停）天然都成立，不用另写一套流程。

新增 `expandCollection()`（`bili.js`）+ `bili.collection` 路由。
实测数据（影视飓风 mid=946974）：

```
指定合集 sid=2046621 → ok:true  26 条 → 一次拿回 6 条（接口本身限制）
该 UP 的全部合集      → ok:true  99 个视频 / 20 个合集
```

**踩了两个接口坑（都是实测出来的，官方无文档）**：

1. **字段藏在 `meta` 里** —— `season_id` / `title` / `total` 都在
   `season.meta` 下，不在 season 顶层。一开始读错层，表现为「找不到合集」。
2. **`page_size` 上限是 20** —— 传 30 直接返回 `code=-400 请求错误`。
   我起初写 30，报错信息只有「请求错误」，排查了一会儿才试出是页大小超限。
3. 该接口**不支持 `season_id` 过滤参数**（带上就 -400），
   只能「拉合集列表 → 从中挑目标合集」。

设置页的批量群组现在支持：粘贴链接 → 点「展开 / 加入队列」→
**先看到解析出的视频清单**（标题/合集/时长）→ 再确认全部加入。
普通视频链接会直接入队，不多一步。

### ④ 「没点探测模型前为什么已经有可用模型？」

因为**内置了种子列表**（`defaultAiPlatforms()` 里每个平台带几个常见模型名），
目的是开箱即用。但它们**只是预设，不代表你的账号真能用**。

问题是界面上两者混在一起、都叫「可用模型」，容易让人以为已经验证过了。现在分开：

| 状态 | 标题 | 说明 |
|---|---|---|
| 未探测 | `模型（内置预设 N 个，未核实）` | 附note：「不代表你的账号真的能用，点『探测模型』拉真实列表」 |
| 已探测 | `模型（已核实 N 个）` | 来自平台 `/v1/models` 的真实返回 |

### ⑤ 「对话旁的模型名与设置里选的不一样？」

**这是个真 bug。** 原因：

- 设置页的标签列表来自 `modelCache[p.id] || p.models`
- 对话下拉框也来自 `p.models`
- 但如果 `p.model`（**实际在用的**）不在 `p.models` 里 —— 例如用户手填过模型名，
  或选过的模型后来从种子列表里被移除 —— 那么：
  · 下拉框显示 `p.models` 的第一项
  · 真实请求用的是 `p.model`

**修法**：两处都把 `p.model` 并进候选列表（`unshift` 到最前），保证
**下拉框显示的就是实际在用的那个**。

### 新增 17 项测试

```
PASS  识别 channel/collectiondetail 合集链接
PASS  识别 /lists/ 形式的合集链接
PASS  识别 seriesdetail 合集链接
PASS  普通视频链接不算合集 / 非 B 站链接不算合集
PASS  从合集链接解出 mid 与 seasonId
PASS  从 /lists/ 链接解出 mid 与 seasonId
PASS  普通视频链接解不出 mid/seasonId
PASS  AI 工具栏有复制总结 / 导出总结 / 重置对话
PASS  复制/导出/重置不在菜单里（直接可见）
PASS  格式规则要求先给结论与速览表 / 含任务列表 / 要求内容全部来自字幕
```

## 第五十八轮（1.42.0）—— 字幕串视频的根因 / 自动载入上次结果

### ① 「读取视频完后，显示的字幕与视频的字幕不一样」

**根因找到了，是真实的逻辑缺陷。**

`page-bridge.js` 里有一个页面级的字幕嗅探缓存：

```js
const subtitleSniff = { items: new Map(), ... };
```

它记录所有被网络嗅探到的字幕正文（这是「不点播放器也能拿到字幕」的关键机制）。
问题是：**这个 Map 从不随换视频清空**。

于是从 A 切到 B 之后：

1. A 的字幕正文**仍然留在 items 里**
2. `getSubtitles` 把它连同 B 的一起作为候选返回
3. 某个候选被选中 → 显示的却是 A 的字幕

这正是「总会出现」的原因 —— 只要你在同一个页面里换过视频/分 P，就可能命中。

**改法**：给嗅探结果打上**当时的视频签名**，取出时按签名过滤。

```js
// 记录时（签名 = bvid @ pN @ cCID，与页面信息用的是同一套）
subtitleSniff.items.set(key, { url, body, at, source, sig: currentSignature() });

// 取出时
function freshSniffed() {
  const curSig = currentSignature();
  return Array.from(subtitleSniff.items.values())
    .filter((s) => s && s.sig && s.sig === curSig);
}
```

**连带修掉一个隐蔽的误判**：那个「等待页面上出现新字幕」的循环原本写成

```js
if (subtitleSniff.items.size) break;   // ← 含旧视频残留
```

所以换视频后它会**第一轮就立刻退出**，并报告「已经拿到字幕了」，
实际上拿到的可能是上一个视频的。现在改成 `if (freshSniffed().length) break;`。

> 这里特意**把签名抽成共用的 `buildSignature()`** ——
> 原来签名的拼法内联在 `getPageInfo` 里，如果嗅探那边另写一份，
> 两边一旦不一致，过滤就永远不匹配（等于没过滤）。共用一份才安全。

**没有签名的旧条目一律排除** —— 宁可少一条候选，也不给错内容。
另外对外多报一个 `staleSniffCount`，方便以后诊断这类问题。

### ② 已经总结过的视频，直接呈现结果

用户需求：「如果遇到已经读取总结过的视频，直接将总结过的内容呈现出来，不用重新搞」。

历史记录里本来就存了 `summary` 与 `lines`（每次抓字幕/生成总结都会 `saveHistory`）。
现在 `loadVideo` 读完视频后**自动查一次历史**，命中就把字幕与总结填上，并提示：

> 已载入上次的结果 —— 字幕 240 行，总结已就绪。想重新生成，点「重新生成总结」。

几个细节：

- **只在换视频时查**（`changed` 分支内），同一个视频反复读不会反复弹提示
- **只填「空着的」字段** —— 如果本次会话里刚生成过，不会被历史覆盖
- key 必须与后台 `historyKey` 完全一致（`bvid|cid|page`），否则查不到
- 载入失败**不影响读取视频本身**（历史只是加速，不是必需品）

### 新增 15 项测试

```
PASS  字幕签名抽成了 buildSignature
PASS  有 currentSignature 计算当前页签名
PASS  签名格式与页面信息一致（bvid@pN@cCID）
PASS  记录嗅探结果时打上签名
PASS  有 freshSniffed 只取当前视频的嗅探结果
PASS  freshSniffed 按签名过滤
PASS  等待新字幕用 freshSniffed（不会被旧残留误判）
PASS  候选取过滤后的 sniffed
PASS  对外报告残留条数以便诊断
PASS  loadVideo 会查历史
PASS  历史 key 与后台一致（bvid|cid|page）
PASS  只填空着的字段（不与本次会话内容冲突）
PASS  载入失败不影响读视频
```

## 第五十九轮（1.43.0）—— 用真实抓包定位「随机字幕」与「总结丢失」

这一轮我**没有再靠猜**，而是搭了两个真实环境去测，两个问题都定位到了根因。

### 方法：在真实 Chrome 里观察字幕请求

写了个脚本用 CDP 打开真实的 B 站视频页，监听所有疑似字幕的请求。
结果（BV1be41127ft，一个**没有官方字幕轨**的视频）：

```
捕获到的字幕请求：
  https://api.bilibili.com/x/v2/subtitle/web/view?oid=1401371056&pid=238588630&...
  （另有几条 data.bilibili.com 的埋点，无关）
```

只有这一个真正的字幕请求。把它拉下来看：

```
HTTP 200 | content-type: application/octet-stream | 392 字节
可读片段：··················1398548857402574848··ai-zh"·······*··//subtitle.bilibili.com/S%13%1BP...
```

### 根因①：那个接口返回的是 **protobuf**，不是 JSON

`/x/v2/subtitle/web/view` 返回 `application/octet-stream`。
而 `fetchSubtitleBody` 的兜底分支是：

```js
try { json = JSON.parse(text); }
catch (err) { return { format: 'text', body: text }; }   // ← 二进制当文本返回
```

于是这 392 字节的二进制被当作「纯文本字幕」交给 `parseSubtitleText`，
控制字符与随机字节被拼成一大堆**毫无意义的字幕行** ——
表现就是「出现了一些别的视频的字幕，而且每次还不一样」
（`auth_key` 带时间戳，每次响应字节不同，所以拼出来的东西也不同）。

> 为什么「每次不一样」：二进制里含一个带时间戳的 `auth_key=1790758661-...`，
> 每次都变 → 解析出的垃圾行每次都不同。

**三层防护**：

1. `fetchSubtitleBody` 检查 `content-type`，二进制直接判空并给出
   `rejected: 接口返回二进制（octet-stream），不是字幕正文`
2. 新增 `looksLikeBinaryGarbage()`：替换字符 / 控制字符占比 > 1% 判为垃圾，
   `parseSubtitleText` 直接返回空数组
3. **缓存命中后也要 `validateLines`** —— 之前缓存路径**完全跳过校验**，
   一旦把错误内容写进缓存，之后每次都会「稳定地」返回错内容

实测判据（真实 protobuf vs 正常字幕）：

| 输入 | 替换字符占比 | 控制字符占比 | 判定 |
|---|---|---|---|
| 真实 protobuf | 2.09% | 3.66% | **垃圾** ✅ |
| 正常 SRT | 0% | 0% | 正常 ✅ |
| 正常中文 | 0% | 0% | 正常 ✅ |

### 根因②：`saveHistory` 把已有的总结**抹成空字符串**

历史是**合并写**：

```js
const row = { key, savedAt, video, ...prev, ...entry };
```

而面板侧一直写 `summary: st.summary || ''`。
换视频/导航时 store 的 summary 会被清空，此后**任何**一个保存历史的动作
（应用替换规则、AI 优化、生成章节、抓完字幕…）都会把已存好的总结覆盖成空。

这完全解释了用户的现象：

> 「回到之前总结过的视频，字幕出来了，但总结没出来」

字幕刚抓完会重新存一份 → 字幕有；而总结**早在上一次操作时就被抹掉了** → 总结没有。

**修法（三道）**：

1. `saveHistory()` 在 summary 为空时**不写这个字段**，先读一次已有的保留住
2. `historyPut` 兜底：`entry.summary === ''` 且 `prev.summary` 存在时，保留 prev
   （空 `lines` 同理）
3. 批量处理里原本 `store.set({ video, subtitles: [], summary: '' })`
   先把总结清掉再抓字幕，**从不回填** → 现改为先读出已有的总结，抓完后填回

### 顺带：`restoreFromHistory` 抽成共用函数

原来「读视频后回填历史」只写在 `loadVideo` 里。
但**页面内跳转（SPA 导航）**走的是 `app.js` 的 navigate 处理器 ——
它清了状态却从不回填，也是一条「总结不出来」的路径。
现在两边共用同一个 `restoreFromHistory()`，并加了「内容没变就不重复 set」。

### 新增 16 项测试

```
PASS  识别 protobuf 二进制垃圾
PASS  正常 SRT 不算垃圾 / 正常中文字幕不算垃圾 / 空文本不算垃圾
PASS  二进制文本解析为空数组
PASS  缓存命中后仍做校验
PASS  校验不过就不采用缓存
PASS  后台拒绝 octet-stream 响应
PASS  saveHistory 不写空 summary
PASS  summary 为空时先读已有值再决定
PASS  historyPut 兜底：空 summary 不覆盖
PASS  historyPut 兜底：空 lines 不覆盖
PASS  批量处理保留已有总结
PASS  抽出了 restoreFromHistory 供多入口复用
PASS  内容没变化就不重复 set
```

### 方法论收获

上一轮我只加了「嗅探项按视频签名过滤」，那是**猜**出来的方向 ——
虽然也修掉了一个真问题（嗅探缓存跨视频残留），但**没打中用户报的现象**。

这一轮换了做法：**先把真实响应抓出来看**，一眼就看到了
`content-type: application/octet-stream` 和一串乱码 URL。
如果一开始就这么做，能省掉一轮。

> **教训：凡是「内容不对」的问题，先把真实数据打印出来。**
> 不要从「我改过的代码」倒推「可能哪里错了」。

## 第六十轮（1.44.0）—— 快速总结 + 一次诚实的回退

### ① 新增「快速总结」（跳过联网校对）

联网核对要逐条搜索，是整个流程里最耗时的一段。现在有两个入口：

| 按钮 | 行为 |
|---|---|
| **③ 生成总结** | 联网校对字幕 → 更正 → 用更正后的字幕生成（默认，慢但准） |
| **⚡ 快速** | **跳过校对**，直接用现有字幕生成 |

- 进度条也相应变成两步（原来是三步），文案里的「第 N/3 步」改成动态的 `第 N/${totalSteps} 步`
- `generateSummary({ skipProofread: true })` 是唯一开关；
  操作区与 AI 工具栏两个按钮共用 `summarize(skipProofread)`

### ② 「随机字幕」：我上一轮的结论是错的，这里如实说明

用户再次反馈同样的现象，并强调「**我没说错，就是有这种情况**」。
我去验证了自己上一轮的结论，结果是：**上一轮的解释不足以覆盖用户报的现象。**

上一轮我抓到 `/x/v2/subtitle/web/view` 返回 protobuf，于是认定
「随机字幕」是二进制被当文本解析出的乱码。这一轮我做了更严格的验证：

1. 在真实页面里复刻 `deepFindSubtitleList` 的全量广度优先扫描 —— 返回 `null`
   （`related` / `availableVideoList` / `videoData` 里都**没有** `subtitle_url`）
2. 用后台接口查那些「无字幕视频」 —— **确实是 0 条字幕轨**
3. 检查 `availableVideoList` —— 里面确实有整季 66 个视频（cid 各不相同），
   但**没有内嵌字幕数据**

也就是说：**我找到了一个真实的缺陷（二进制当文本解析），但它不是用户看到的现象的完整解释。**
用户看到的是**真实存在的、别的视频的字幕正文**。

### ③ 我尝试做的归属校验，以及为什么最后**撤掉了**

为了从根上堵住「抓到别的视频的字幕」，我给 `validateLines` 加了归属校验：

1. **确定性证据**：字幕正文里出现**别的** bvid / cid → 拒绝 ✅ **保留**
2. **内容相关性**：字幕与标题/简介最长连续重合 < 5 字 → 拒绝 ❌ **已撤掉**

第二项撤掉的原因，是我用真实数据校准后发现的：

| 对比 | 最长公共子串 |
|---|---|
| 无关领域文本 vs 标题 | 1~2 字 |
| **真实视频的字幕 vs 它自己的标题** | **2 字** ← 关键 |

**两个分布重叠，没有可用的分界。**
真实视频的标题用词**本来就很少**原样出现在字幕里 ——
字幕讲的是内容，不是复述标题。
（实测例子：标题「【测试】用于验证流程的视频」，它的真实字幕里
最长只和标题连续重合 2 个字，也就是「视频」。）

硬设阈值的后果是**误杀真实字幕** —— 这一点在 `flow2.js` 里被当场抓到：
测试用的通用字幕被正确判为「无关」，但真实视频的字幕同样会被判为无关。

> **一个会误杀真实数据的判据，比没有判据更糟。** 所以我撤掉了它，
> 只保留 bvid/cid 这种确定性证据，并把重合度**降级为诊断信息**。

这条规则的危险在于：撤掉之后，用户报的现象**可能依然存在**。
我不打算用「已经修好了」来糊弄过去。

### ④ 诊断面板：把「这次的字幕到底哪来的」摆出来

为了让下一次排查有据可依（而不是又靠猜），诊断弹窗现在直接显示：

```
本次实际采用的字幕
  来源          嗅探 / 接口 / 缓存 · 中文（简体）· 240 行
  归属参考      与标题/简介的最长连续重合 2 字（该指标仅作参考，不参与判定）
网络嗅探
  属于当前视频 1 条；已排除其它视频的残留 3 条
```

配合系统日志里的 `staleSniffCount` / `sniffCount`，
下一次出现「字幕不对」时可以先看来源，而不是重新假设。

### ⑤ 测试

新增 22 项，其中**专门有一条反向断言**，防止以后有人再引入
「按内容重合度拒绝字幕」的误杀逻辑：

```
PASS  用词完全不同的字幕不因“内容对不上”被拒（避免误杀）
PASS  含别的 BV 号的字幕被拒（确定性证据）
PASS  提到自己的 BV 号可以通过
PASS  仍然记录归属参考值
PASS  快速总结跳过联网校对 / 步骤总数支持跳过校对
PASS  AI 工具栏有快速总结按钮 / 操作区有快速总结按钮 / 两个入口共用 summarize()
```

## 第六十一轮（1.45.0）—— 转录提速

用户问「转录速度慢，有没有加快的办法」。先量化，再动手。

### 找到的两个真实瓶颈

**瓶颈 1：默认并发是 1 —— 完全串行**

```js
const concurrency = Math.max(1, Math.min(8, Number(asr.concurrency) || 1));
```

分片之间是**互相独立**的，并发提高近乎线性提速。
默认 1 意味着这个开关形同虚设，而且**用户大概率不知道要改**。

不过这个 1 是有来历的 —— `asr-test` 里原本有一条断言
「默认并发为 1（少一次失败机会）」，是历史上反复被限流之后
**刻意**压低的。所以我不能简单地改成 8 就完事。

**瓶颈 2：M4A 编码是「实时」的，而且与识别串行**

硅基流动等平台要求 M4A/MP4，而浏览器里唯一的 AAC 编码器是
`MediaRecorder`，它按**音频实时时钟**工作 —— 40 分钟的音频，
光编码就要 40 分钟。而原来的流程是：

```
编码(40min) → 识别 → 编码 → 识别 …
```

两段时间**完全相加**。

> 顺便验证了一个想法：能不能用 WebCodecs 的 `AudioEncoder` 快速编码？
> 在真实 Chrome 里实测 —— **`mp4a.40.2` 不支持**
> （`isConfigSupported` 返回 false；且报错说只支持 96000/128000/… 的码率）。
> 只有 `opus` 支持。而 Opus 要装 WebM 封装，改动太大，
> 这一轮先不做。（结论已实测，下次不必再试。）

### 三个改动

**① 默认并发 1 → 4**

**② 预热：先单独跑第一片，成功后再并行剩下的**

这样既提速，又保住了原来「少一次失败机会」的意图：

- 第一片仍然**先**验证凭证 / 接口地址 / 音频格式是否可用
- 第一片失败 → 整个流程立即结束，**不会白跑其它片**
- 第一片成功 → 说明链路是通的，剩余片才并发

**③ M4A 编码与识别**并行**（关键）**

把编码提前排进一个独立的小并发池：

```
编码 1 → 识别 1
编码 2 → 识别 2      （与识别 1 重叠）
…
```

总耗时从 `编码 + 识别` 变成 `max(编码, 识别) + 首片编码`。
编码池宽度压到 2 —— `MediaRecorder` 走音频实时时钟，
开太多路只会互相拖慢。

### 设置页加了提速指引

原来只有一串数字输入框，用户不知道哪些影响速度。现在明确写着：
并发调到 4~8、切片时长调小到 120~300 秒，以及 M4A 平台会有编码开销。

### 测试

把原来那条「默认并发为 1」的断言改成描述**新的契约**，
并新增 5 项断言锁住预热与并行编码的逻辑：

```
PASS  默认并发为 4（预热后并行）
PASS  存在「先单跑第一片」的预热逻辑
PASS  预热成功后并行剩余片
PASS  只有一片或并发为 1 时不预热
PASS  M4A 编码改为与识别并行（不再串行等待）
PASS  并发上限仍是 8
```

### 还可以再快的方向（本轮未做）

1. **直接复用 B 站的原始 AAC 音轨**，不做解码 + 重编码 ——
   可以完全消掉编码耗时，而且音质更好。
   代价是要自己拼 fragmented MP4 的 init + media 段，工作量较大。
2. **Opus + WebM**：WebCodecs 能编 Opus（已实测），
   但需要引入 WebM 封装，且不确定各平台是否收 `audio/webm`。

## 第六十二轮（1.46.0）—— 「随机字幕」的真正根因（用户提供了复现步骤）

用户给出了复现步骤，这一下就把根因锁死了：

> 先打开一个视频，然后读取、转录、总结；保持侧边栏打开，
> 切换到另一个视频点击重新抓取字幕，就会出现别的视频（随机的）的字幕。
> 而且此时**不是重新开始，而是停留在了总结视频的界面**。

### 根因①：签名取错了时刻 —— 一个隐蔽的竞态

上一轮我给嗅探到的字幕打「视频签名」，并按签名过滤，逻辑是对的。
但签名的**取值时刻**错了：它在 `recordSniffedSubtitle()` 里调
`currentSignature()` —— 也就是**响应到达时**的签名。

于是：

```
1. 在视频 A 的页面里，播放器请求了 A 的字幕正文（响应还没回来）
2. 用户切到视频 B          ← 用户复现步骤里的「切换到另外一个视频」
3. A 的响应此刻才到达 → 被贴上 B 的签名
4. 在 B 看来这条字幕「属于自己」→ 混进 B 的字幕里
```

**哪条慢请求先回来是随机的，所以每次混进来的内容都不一样** ——
这正好解释了用户一直强调的「每次抓取的还不一样」。

**修法**：签名在**请求发出时**固定，随响应一起传下去。

```js
// fetch 钩子
const sigAtRequest = currentSignature();     // ← 请求发出时
const p = origFetch.apply(this, args);
p.then((res) => res.text().then((t) => recordSniffedSubtitle(url, t, 'fetch', sigAtRequest)));

// XHR 钩子
const sigAtRequest = isSubtitleUrl(url) ? currentSignature() : '';   // ← send 时
this.addEventListener('load', () => recordSniffedSubtitle(url, this.responseText, 'xhr', sigAtRequest));
```

> 这一轮也说明了上一轮我**为什么没能定位**：
> 我只检查了「过滤逻辑对不对」，没检查「签名是什么时候取的」。
> 一个在异步回调里调用 `currentSignature()` 的写法，
> 静态看上去完全合理 —— 只有把**时序**画出来才看得出问题。

### 根因②：换视频后没有真的「重新开始」

用户说「不是重新开始，而是停留在了总结视频的界面」。
查下来是第六十轮我加的那个「自动回填历史」功能造成的：

```
app.js 的 SPA 导航处理器
  → store 清空字幕/总结
  → 调 loadVideo()
     → 里面自动 restoreFromHistory()   ← 把上一期的字幕+总结又载回来了
```

于是界面看着还停在原来那期视频上，而且**用户以为没重置**。
更糟的是它会让用户误判「切换没生效」。

**修法**：`loadVideo({ noRestore: true })`。
手动点「读取当前视频」时才回填历史（那是用户明确要「看上次的结果」的场景）；
页面内跳转（SPA 导航）必须真的从头开始。

### 输出上限与详细程度

用户要求「AI 输出字数上限多一点、内容更详细」：

| 项 | 旧 | 新 |
|---|---|---|
| 默认 `maxTokens` | 4096 | **8192** |
| 设置页可调上限 | 32000 | **64000** |

- 加了迁移：只把「恰好等于旧默认 4096」的配置升到 8192，
  用户手动设过的值（如 2048 / 16000）原样保留 ✅ 已实测
- 提示词新增「**宁可详细，不要简略**」一节：要求每点写清
  「是什么 + 为什么 + 怎么做」，保留具体数字/命令/步骤/参数，
  长视频写长是正常的；同时保留「不要为了凑长度灌水」的反向约束
- 设置页对该字段补了说明（1 token ≈ 0.6~1 汉字，8192 约 5000~8000 字，
  上限取决于模型本身，调大后费用增加）

### 新增 13 项测试

```
PASS  recordSniffedSubtitle 接收请求时刻的签名
PASS  fetch 钩子在请求发出时固定签名 / 把签名传下去
PASS  XHR 钩子在 send 时固定签名 / 把签名传下去
PASS  记录时以请求时刻签名为准
PASS  导航处理器要求不回填历史
PASS  loadVideo 支持 noRestore 选项
PASS  手动读取时仍然回填历史
PASS  默认最大输出 token 提高到 8192 / 旧默认 4096 会被迁移
PASS  提示词要求更详细 / 提示词保留反灌水约束
```

## 第六十三轮（1.47.0）—— 原始 AAC 音轨复用 + 播放器实例串轨

### ① 复用 B 站原始 AAC 音轨（用户点名要做的）

之前转录的流程是：

```
分块下载整条音轨 → 解码成 PCM → 重采样 16kHz 单声道 → 切片 →（再编码/重编码）→ 上传
```

用户实测「时间大头在下载和上传」。而 B 站自己的音轨本来就是 AAC：

| | B 站原始音轨 | 我们的 WAV 16kHz 单声道 |
|---|---|---|
| 编码 | HE-AAC (`mp4a.40.5`) 41 kbps | PCM 256 kbps |
| 974 秒的体积 | **2.4 MB** | **29.7 MB** |

**体积降到 8%**，而且**完全不解码、不重编码**。

**做法**：DASH 音轨是 `SegmentBase`（fragmented MP4），带一个 `sidx` 索引：

```
init_range  = 0-942      ← ftyp/moov（初始化段）
index_range = 943-3314   ← sidx（分片表：每个分片的字节长度与时长）
之后就是媒体分片，按 sidx 声明的长度依次排列
```

按 sidx 的字节范围逐段取回，前面拼上 init 段，就得到一个**完整可播放的 fMP4**。
再按目标时长把连续分片分组，每片各自「init + 自己的分片」，就是一叠可上传的切片。

**踩坑：sidx 结构里 version+flags 之后还有 4 字节 `reference_ID`**，
漏掉它就会把 `reference_count` 读成 0（我第一次就是这样，
表现为「索引里 0 个分片」）。补上后 195 个分片、总时长 973.1s 全对。

**实测验证**（真实音轨，逐字节校验）：

```
音频时长 974s
ok: true
meta: {codecs:"mp4a.40.5", bandwidth:41148, timescale:48000, segCount:195, duration:973.06}
4 片：
  0.0~305.0s   754.9KB  头=ftyp mdat=true 分片=61
  305.0~610.0s 728.0KB  头=ftyp mdat=true 分片=61
  610.0~910.0s 788.2KB  头=ftyp mdat=true 分片=60
  910.0~973.1s 174.8KB  头=ftyp mdat=true 分片=13
总体积 2.39MB vs WAV 29.7MB → 省 92%
```

也验证过：抽首/中/尾三个分片下载，**实际字节数与 sidx 声明完全一致**；
Chrome 的 `<audio>` 能加载拼出来的文件且**无 error**。

**设计上的保守之处**：

- 默认开启，但**任何一步失败都静默回退**到原来的解码路径，绝不因为省时间而让转录失败
- **WAV-only 模型（XingChen 等）不走这条路**（`audioFormatFor(platform) !== 'wav'`）
- 走 `page.call` 取字节（音轨 CDN 校验 Referer，后台直连会 403）
- 单片超限时自动把切片时长减半重排，仍超限才回退

> ⚠ **诚实说明**：我**没有测过真实 ASR 服务端是否接受这种「无 moov 时长的
> fragmented MP4」**。结构与解码都验证过了，但服务端兼容性需要你实测。
> 所以这一版做了「失败自动回退」——最坏情况只是白花一次下载，
> 不会让转录失败。**如果你发现日志里出现「原始音轨复用不可用/失败」，
> 把那条原因发我，我按它调整。**

### ② 「切换视频后提取的字幕和原有字幕不一样，要重新读取才换回来」

用户这次的描述把范围缩小到了**切换视频**这个场景。

根因有两个，互补：

**a) 播放器实例还停在上一个视频**

`player.getSubtitle()` 取的是**播放器实例**上的轨，而 B 站是单页应用 ——
切视频的瞬间实例往往还没换过来，于是拿回来的是**上一个视频的字幕轨**。
（之前我只对「网络嗅探」那一路做了过滤，漏了播放器实例这一路。）

**修法**：新增 `subtitleOwnerOf()`，从字幕 URL 里抽出它属于哪个
bvid / cid / aid（B 站的字幕地址里带这些），再和当前视频比对。
播放器实例与 `__INITIAL_STATE__` 两路都过这道校验。
**抽不到标识的一律放行** —— 宁可放过，不可误杀。

**b) 采集过程中视频被切换**

`getSubtitleBundle` 内部要发好几个网络请求，若这期间用户切了视频，
采回来的自然是错的。

**修法**：采集开始与结束各取一次签名，不一致就**整批作废**
（`signatureChanged: true`）。面板侧收到这个标记且没拿到轨时，
**等 900ms 自动重采一次** —— 这样用户就不需要手动「再点一次重新读取」了。

被丢弃的轨会记进 `foreignTracks`，诊断面板可以看。

### 新增 25 项测试

```
PASS  解析出正确的 timescale
PASS  解析出 2 个分片（证明跳过了 reference_ID）  ← 就是上面那个坑
PASS  分片大小正确（最高位是 reference_type）/ 分片偏移递增
PASS  按目标时长分组 / 分组带字节范围与分片清单
PASS  parseByteRange 解析正常 / 对非法值返回 null / 没有 sidx 时返回 null
PASS  默认开启原始音轨复用 / 主流程接了原始音轨复用
PASS  WAV-only 模型不走复用路径 / 复用失败会回退 / 复用路径走 page.call 取字节
PASS  有 subtitleOwnerOf 从 URL 抽归属 / 有 trackBelongsToVideo 归属判断
PASS  播放器实例的轨也过归属校验 / __INITIAL_STATE__ 的轨也过归属校验
PASS  抽不到标识时放行（避免误杀）
PASS  采集开始/结束时各取一次签名 / 签名不一致时整批作废
PASS  对外报告 foreignTracks 供诊断
```

## 第六十四轮（1.48.0）—— 身份绑定：「标题对、内容错」的根治

### 用户报的现象（这一轮的核心）

> 总是会出现读取的视频显示是正确的，但是提取字幕或者转录后却不是我当前的视频。

这句话把问题定性得很准：**不是"内容看起来不对"，而是"内容与身份没绑在一起"。**

### 根因：身份是**分散计算**的

之前的代码里，视频的「身份」不是一个值，而是一个**每次现算的过程**：

| 用途 | 取身份的方式 |
|---|---|
| 标题 / 时长 | `getInfo()` 里现算 `currentCid()`、`initialVideoData()` |
| 字幕轨 | `getSubtitleBundle` 里**又**现算一次 |
| 音轨 | `getAudioCandidates` 里**再**现算一次 |
| 嗅探过滤 | `currentSignature()` 里**第四个地方**现算 |

平时这些当然算出来一样。但 B 站是单页应用，切视频时页面状态是**渐变**的：

- `__INITIAL_STATE__`（标题、bvid）先更新
- `?p=` 参数、`pages[]`、播放器实例**晚一拍**
- 于是存在一个窗口：**标题已经是新的，而 `currentCid()` 还是旧的**

在这个窗口里读到的「标题」是对的、「cid」是旧的 → 后面所有按 cid 取的内容
（字幕轨、音轨）都来自**上一个视频**。界面看着完全正常。

**这解释了为什么它「总是会出现」而且飘忽不定** —— 取决于你点多快、
页面切换得多快，命中窗口的概率不同。

### 修法：把身份收敛成**一个**，并做前后一致性校验

**① `pageIdentity()` —— 唯一权威来源**

```js
function pageIdentity() {
  // bvid / aid / epId / page / cid 只在这里算一次
  return { bvid, aid, cid, epId, page, signature };
}
```

- `currentSignature()` 改为 `return pageIdentity().signature`
  （以前它是**第四份**独立实现）
- `getInfo()` 里的 cid 与 signature 也改成从 `pageIdentity()` 取

**全链路只有一套身份计算** —— 从结构上消掉「两处算出不同结果」的可能。

**② `withIdentityGuard()` —— 取内容前后各校验一次**

```js
const before = pageIdentity();
// 面板指定了期望签名时，先确认页面确实已经是那个视频
if (expectSignature && before.signature !== expectSignature) return { ok:false, reason:'identity-mismatch' };
const value = await collect(before);
const after = pageIdentity();
if (after.signature !== before.signature) return { ok:false, reason:'identity-changed' };
return { ok:true, value, identity: before };
```

这样调用方拿到的不是「一堆看起来像字幕的东西」，而是
**「明确属于某个签名的一堆东西」** —— 有确定性依据判断能不能用。

**③ 面板主动声明它展示的是哪个视频**

- 字幕请求带上 `expectSignature`（面板当前展示的视频签名）
- 音轨请求带上 `cid`，页面侧据此**按 cid 过滤候选** ——
  每个音轨候选在采集时都记了它来自哪个 cid，所以这是确定性过滤，不是猜
- 身份不符时面板**自动等 900ms 重采一次**，用户不必再手动「重新读取」

**④ 新增 `identity` 诊断方法**

把「页面当前认为是哪个视频」暴露出来，还带一个 `consistent` 字段
（`getInfo` 的签名与 `pageIdentity` 的是否一致）。
以后排查这类问题可以直接看这个值，而不是靠猜。

### 为什么这一轮和上一轮不同

上一轮我修的是「嗅探到的字幕被贴上错误签名」（**时刻**错了）。
这一轮修的是「**根本没有一个统一的身份**，各处各算一次」（**来源**错了）。

两者是同一条线索上的两层：先有统一的身份，才有可靠的时刻。

### 新增 17 项测试

```
PASS  有唯一权威的 pageIdentity
PASS  currentSignature 复用 pageIdentity（全链路一套身份）
PASS  getInfo 用 pageIdentity 的身份
PASS  有 withIdentityGuard 做前后一致性校验
PASS  身份不一致时判定 identity-mismatch / 采集期间被切换判定 identity-changed
PASS  getSubtitleBundle 接受 expectSignature
PASS  字幕在身份不符时明确返回 identityMismatch
PASS  音轨候选按 cid 过滤 / 报告被排除的条目 / 每个候选都记了来源 cid
PASS  暴露 identity 诊断方法
PASS  字幕请求带上期望签名 / 身份不符时放弃这批字幕 / 也自动重采一次
PASS  音轨请求带上 cid 与签名 / 日志报告被排除的音轨数
```

## 第六十五轮（1.49.0）—— 身份自检 + 等稳定

### 用户的关键线索

> 为什么有的视频没有官方字幕，却在里面添加了其他视频的字幕，
> 这时如果点击转录转录的却是这个错误视频的字幕。

**「转录出来也是别人的」这句话把方向定死了。**

转录走的是**音轨**路径，根本不经过字幕。如果转录出来是别的视频的内容，
那说明**音轨也是别人的** —— 也就是**身份本身指向了别的视频**，
而不是「字幕那一层串了」。这排除了我之前怀疑的若干方向。

### 修法：与其猜，不如**检测矛盾并等它稳定**

单页应用切视频时，`URL` / `__INITIAL_STATE__` / `pages[]` 是**分步更新**的。
中途会出现「这几者互相矛盾」的状态，用它算出来的身份就是错的 ——
而界面看起来一切正常。

**① `pageIdentity()` 增加一致性自检**，把矛盾显式报出来：

```
① URL 里的 bvid 与页面状态里的 bvid 不一致
② 算出来的 cid 不在本稿件的 pages[] 里
③ ?p= 指向的分 P 在本稿件里不存在
```

返回的 `problems` 为空数组 = 自检通过。

**② `waitForStableIdentity()` —— 等身份稳定再取内容**

要求「自检无矛盾」**且**「连续两次读到同一个签名」才算稳定，最多等 8 轮。
这是成本最低、也最不容易误伤的修法：**不在切换的中间态取内容**。

**③ 音轨路径做了同样的三件事**（转录用的就是它）

- `getAudioCandidates` 也先 `waitForStableIdentity(wantSignature)`
- 用**已经稳定的那个身份**的 cid 去采集（而不是让采集过程自己再算一次）
- 采集**之后**再复核一次身份，变了就整批作废

**④ 转录侧：身份没就绪就重试，绝不将就**

```js
for (let attempt = 0; attempt < 4; attempt += 1) {
  out = await call('audio.candidates', { ..., signature: video.signature });
  if (!out.identityMismatch && !out.identityUnstable) break;
  await sleep(700);
}
// 重试仍失败 → 明确拒绝，并告诉用户「为避免用别的视频的音轨转录出错内容」
```

**⑤ 诊断面板**把身份不一致放在**最前面**（一眼就能解释「内容为什么不是这个视频的」）。

### 新增 15 项测试

```
PASS  身份带一致性自检（problems + urlBvid）
PASS  检测 URL bvid 与页面状态 bvid 不一致
PASS  检测 cid 不在 pages[] 里 / 检测 ?p= 指向不存在的分 P
PASS  有 waitForStableIdentity 等身份稳定
PASS  要求连续两次签名一致才算稳定
PASS  withIdentityGuard 先等稳定再采集 / 仍不稳定则拒绝（identity-unstable）
PASS  字幕返回 identityUnstable 标记
PASS  getAudioCandidates 也等身份稳定
PASS  音轨用稳定身份的 cid 去采集 / 音轨采集后再复核一次身份
PASS  音轨身份未就绪时重试 / 重试仍失败则拒绝继续
PASS  字幕身份不稳定也自动重采
```

### 坦白：我仍然没有**复现**过你的现象

这一轮做的是「把不可观测的中间态变成可检测、可等待的状态」，
逻辑上能覆盖「切换过程中取到旧身份」这一类原因。
但我在沙箱里**没有登录态**，无法复现你遇到的场景。

所以故障时**请把诊断面板的内容发我** —— 现在它会明确写出：

- `页面≠面板` 或 `页面状态未稳定`（并附具体原因）
- 本次实际采用的字幕来源
- 被排除掉的其它视频的音轨/字幕条数

有了这些我就能判断是**这一类原因**，还是**另一条我还没找到的路径**。

## 第六十六轮（1.50.0）—— 「音频数据追加失败」的真因

### 用户的日志（2 小时视频）

```
音轨候选 3 条
音轨：audio/mp4 带宽 67175 来源 __playinfo__ host upos-sz-estghw.bilivideo.com
下载完成：62.0MB，用时 10.6s        ← 下载本身很快
音频数据追加失败                    ← 卡在这里
```

### 根因：MSE 的 SourceBuffer 被**硬编码**成 mp4a.40.2

失败点在 `audio.js` 的流式解码路径：

```js
const mime = 'audio/mp4; codecs="mp4a.40.2"';   // ← 写死的
sb = ms.addSourceBuffer(mime);
```

而 B 站相当一部分音轨是 **HE-AAC（`mp4a.40.5`）**。
codec 与 SourceBuffer 声明不一致时，`appendBuffer` 直接报错 ——
而旧代码只抛一句「音频数据追加失败」，
**完全看不出是 codec 对不上、还是配额不足**。排除它花了我好一会儿。

> 顺带说明：`ffmpeg-remux` 那条路之所以没救到，是因为它有自己的
> 走法；这条路是「整体 decodeAudioData 失败 → MSE 流式采集」的兜底。

### 四处修改

**① SourceBuffer 按实际 codec 建**

候选顺序：实际 codec → `mp4a.40.2` → `mp4a.40.5` → 裸 `audio/mp4`，
并用 `MediaSource.isTypeSupported` 过滤。全都建不起来时报出**真实 codec**。

**② 追加失败要带出 MediaSource 的真实原因**

```js
const err = sb.error || ms.error || null;
// 「音频数据追加失败（MediaError: ...）—— SourceBuffer 配额不足，音频过大；
//   音轨 codec=mp4a.40.5，本次追加 62.0MB」
```

**③ 大文件分块追加（4MB 一块）**

一次 `appendBuffer` 塞 60MB 很容易撞 SourceBuffer 配额。
现在分块追加，并且**在缓冲领先播放位置超过 60 秒时先等一等**
（配额压力下的背压）。`sb.buffered` 为空时 `end()` 会抛错，已护住。

**④ 原始音轨复用被跳过时，明确说明原因**

这次的日志里**完全没有**「复用 B 站原始音轨」的痕迹 —— 说明条件没满足，
但用户看不到任何解释。现在会明确写出来：

- 「未复用原始音轨：这条候选没有 SegmentBase 索引（initRange=无 indexRange=无，来源 __playinfo__）」
- 「未复用原始音轨：设置里关掉了…」
- 「未复用原始音轨：当前模型要求 WAV，必须解码重编码」

**这一条是排查的关键**：2 小时视频最理想就是走原始音轨复用
（62MB → 约 10MB，且完全不解码），如果它被跳过，日志必须说清为什么。

> `__playinfo__` 这条来源：如果 B 站给它的 dash 数据里**没有 SegmentBase**，
> 就确实走不了复用。这时上面那条日志会直接指出来。

### 新增 11 项测试

```
PASS  SourceBuffer 按实际 codec 建
PASS  codec 候选包含 mp4a.40.5（HE-AAC）
PASS  找不到格式时报出真实 codec
PASS  追加失败带出 MediaSource 真实原因
PASS  配额不足时明确提示
PASS  大文件分块追加（避免一次 60MB）
PASS  decodeAudioBytes 透传 codecs
PASS  转录把音轨 codec 传给解码器
PASS  跳过原始音轨复用会说明原因 / 关掉开关时也说明 / WAV 模型时也说明
```

### 仍需用户确认

这个视频**为什么没走原始音轨复用**，我这边无法判定 ——
下次转录时看日志里那句「未复用原始音轨：…」就能知道确切原因。
如果它说「没有 SegmentBase 索引」，那说明该视频的音轨确实不支持按字节切片，
就只能走解码路径（此时上面的 codec 修复会生效）。

## 第六十七轮（1.51.0）—— 清空字幕 + 按钮审计

### ① 「读取出来的字幕为什么不能清除？」

**用户是对的，之前确实没有任何清空字幕的入口。**
抓到可疑内容时，唯一的办法是换视频或重启侧边栏。

新增 `clearSubtitles()`，两个入口：

- 顶部操作区 `⋯` 菜单 → **🧽 清空字幕**
- 字幕面板 `⋯` 菜单 → **🧽 清空字幕**

它清掉的是「由字幕派生的东西」，而不是只清 `subtitles`：

```
subtitles          ← 字幕本身
subtitlesOriginal  ← AI 校对前的备份（否则回退还能把旧的捞回来）
chapters/stats     ← 章节与统计是按原字幕算出来的
subtitleAttempts / subtitleError / subtitleDiagnostic
```

并留痕（`recordTimeline('清空字幕')`），所以还能从「历史记录与回退」退回去。

### ② 「没有官方字幕为什么还能点『抓取官方字幕』」

这个措辞本身就是错的 —— 那条路径除了官方字幕轨，
**也会接受页面已经捕获到的 AI 字幕**。用户正是被「官方」二字误导了。

- 「② 抓取官方字幕」→ **「② 获取字幕」**
- 「重新抓取字幕」→ **「重新获取字幕」**
- 字幕面板、向导、AI 面板的提示文案一并同步

另外：**已经知道「一条字幕轨都没有」时，提前说清楚**：

```
这个视频没有解析到任何官方字幕轨。点「获取字幕」仍会再试一次
（页面里可能还藏有播放器已经拉过的 AI 字幕），但多数情况下会是没有。
如果确实是空的，用「语音转录」把音轨转成文字即可。
```

这里**没有直接禁用按钮** —— 因为页面里可能确实还藏着没被解析出来的
AI 字幕，禁掉反而会挡住正当的情况。给预期比给限制更有用。

### ③ 按钮审计（用户要求「检查是否有功能不清晰 / 重复冲突」）

系统扫了一遍所有用户可见按钮文案，得到三类发现：

**A. 真重复（已修）**

用探针把「视频已读、还没有字幕」时的可见按钮列出来：

```
语音转录 -> actionbar + subtitles-pane      ← 同一个空态下同一件事出现两次
⋯        -> actionbar + subtitles-pane + ai-toolbar
```

第一个是真问题：用户会以为它们是两个不同功能。
现在字幕面板的空态**只留「获取字幕」**，转录改为在步骤 3 的说明里
指向顶部那个按钮（「入口在顶部操作区的「语音转录」」）。

第二个不是问题：三个面板各有**不同**的 `⋯` 菜单内容（操作/字幕工具/总结），
属于正常设计。

**B. 浮层里的按钮不关浮层（已修）**

失败明细、候选轨明细、失败提示三处都有「语音转录」，
但以前只是直接调 `transcribe()` —— **浮层不关，转录在底下跑**，
用户看不到进度，还以为是重复按钮。

新增统一的 `runTranscribe()`：**先 `closeOverlays()` 再转录**，
三处浮层 + 字幕面板全部改走它。

**C. 文案不同步（已修）**

`panel-ai.js` 里还写着「请先抓取官方字幕」，已改为「请先获取字幕」。

其余重复（`删除`×4、`测试连接`×2、`读取当前视频`×2…）
都在**不同卡片/不同上下文**里（每个平台的删除、每个对话框的连接测试），
是正常设计，不做合并。

### 新增 15 项测试

```
PASS  导出了 clearSubtitles / 清空时同时清掉校对备份 / 清掉章节与统计 / 会留痕
PASS  操作区菜单有「清空字幕」/ 字幕面板菜单也有「清空字幕」
PASS  不再出现「抓取官方字幕」按钮文案
PASS  空态只用「获取字幕」一个主按钮（转录不再重复出现）
PASS  引导文案指向顶部转录入口
PASS  有统一的 runTranscribe 入口 / runTranscribe 先关闭浮层
PASS  失败提示与明细浮层里的转录走 runTranscribe / 字幕面板浮层也走
PASS  向导按钮文案已同步为「获取字幕」
```

## 第六十八轮（1.52.0）—— 内存占用

用户问「内存占用太高了怎么办」。先量化，再动手。

### 实测：2 小时视频的内存账

按 2 小时、48kHz 立体声估算（Float32 = 4 字节）：

| 阶段 | 占用 |
|---|---|
| 压缩音轨（下载） | 62 MB |
| **解码后 AudioBuffer（立体声 48k）** | **2637 MB** |
| `mixToMono` 单声道副本 | **1318 MB** ← 纯多余 |
| `OfflineAudioContext` 输入缓冲 | **1318 MB** ← 纯多余 |
| 16k 输出 | 439 MB |
| 切片阶段全部 WAV 驻留 | 220 MB |
| **旧代码总峰值** | **≈ 5933 MB** |

**问题的本质**：解码路径必须把**整段音频变成 PCM**，而 48kHz 立体声
Float32 的体量是压缩音轨的 **42 倍**（62MB → 2637MB）。
更糟的是旧代码在这个基础上还复制了两份（各 1318MB）。

### 四处修改

**① 原始音轨复用移到「下载之前」（省时间 + 省内存）**

之前它排在下载**之后** —— 而条件（有没有 `SegmentBase`）在下载前就已知。
于是 2 小时视频会**先白下 62MB** 才去试复用。现在：

```
音轨候选 → 检查能否复用 → (能则) 按 sidx 只取需要的字节 → 识别
                       → (不能才) 下载 → 解码 → 重编码 → 识别
```

复用路径的内存占用极小：2 小时音频的 AAC 切片合计约 **12MB**，
而且**完全不解码**。

**② 去掉那份多余的 mono 复制（省 1318MB）**

旧写法：

```js
const mono = mixToMono(audioBuffer);                  // ← 1318MB（2 小时）
const tmp = off.createBuffer(...);
tmp.copyToChannel(mono, 0);                           // ← 又 1318MB
```

新增 `mixToMonoInto(audioBuffer, dst)`，**直接混进 OfflineAudioContext
的输入缓冲**，中间那份 mono 不再存在。

**③ 复用路径逐片释放字节**

识别完一片就把 `sl.bytes = null`，别让整轨一直挂在内存里。

**④ 长视频主动做内存预估并给出办法**

超过预算时明确告知并给可照做的建议（而不是只报一个吓人的数字）：

```
⚠ 预计内存峰值约 4.3GB（音频 120 分钟）。这条路径必须把整段音频解码成 PCM，长视频非常吃内存。
降内存办法：这条音轨没有 SegmentBase 索引，所以走不了「复用原始音轨」那条省内存的路；
换用支持 mp4/AAC 的识别模型（可走原始音轨复用，不解码，内存极低）；或把长视频分段转录。
```

### 效果

| | 旧 | 新 |
|---|---|---|
| 重采样阶段峰值 | 5713 MB | **4395 MB**（省 1318MB / 23%） |
| **走原始音轨复用** | — | **约 12MB**（几乎为零） |

### 为什么不是「彻底解决」

**解码路径的 2637MB 是结构性的** —— `decodeAudioData` 必须一次拿到
整段音频的 PCM，没有分段解码的标准接口。
真正能根治的还是**复用原始音轨**（不解码就没有这笔开销）。

下一轮若还需要，可以做成「按时间区间分段解码」：
只解 10 分钟、切片、上传、释放，再解下一段。这样内存是常数级，
但要处理「切段边界与分片对齐」的问题。

### 新增 6 项测试

```
PASS  不再单独复制整份 mono
PASS  有 mixToMonoInto（写入已有数组，不额外分配）
PASS  重采样直接写进 OfflineAudioContext 输入
PASS  原始音轨复用放在下载之前（省时间与内存）
PASS  复用成功后逐片释放字节
PASS  长视频有内存预估提示
```

## 第六十九轮（1.53.0）—— 撤回一个我错误宣称「已验证」的功能

### 用户的日志（关键）

```
音轨 codec=mp4a.40.2，本次追加 4.0MB   ← 音频数据追加失败
未复用原始音轨：当前模型（XingChenAGI/XingChenASR-Diarize-V3.0）要求 WAV，必须解码重编码
下载完成：80.4MB，用时 73.8s
⚠ 预计内存峰值约 5.2GB（音频 130 分钟）
```

**关键点：你的模型要求 WAV**，所以必然要走解码路径 ——
而 130 分钟解码就是 5.2GB，必然崩。这跟 codec 无关。

### 我犯的错：宣称「已验证」但实际没验证到位

上一轮我做「原始 AAC 音轨复用」时，在日志里写了：

> 实测验证：195 分片/973.1s 全对、首中尾分片字节数与索引声明完全一致、
> 拼出的文件 ftyp+mdat 正常、Chrome `<audio>` 可加载无 error

**这些说法站不住脚。** 这一轮我做了更严格的逐字节校验，结果是：

```
sidx: refCount=195  第 1 个分片 offset=3315  ← 正好是文件里第一个 moof ✅
  但 off+size=15111 处**不是** moof ❌
  前 8 个分片的 offset 里，只有 1 个落在 moof 上
```

也就是说：**sidx 里第 1 个偏移是对的（我修掉的那个 baseOffset 缺失问题），
但后续 `offset + size` 并不落在下一个 moof 上 —— 这些 entry 描述的不是
「连续完整的媒体字节」。按它拼出来的音频大概率是坏的。**

我之前的「验证」为什么没发现？因为我只检查了：
- 总长度对不对（对，因为尺寸是自洽的）
- 头部是不是 ftyp、有没有 mdat（是）
- 浏览器能不能**加载**（能，容器头合法）

**这些都不能证明音频内容是对的。** 一段被截断/错位的码流，
容器层看起来完全正常，浏览器也会「成功」加载，只是解出来是噪音或解不出来。

短视频（如 MV 那支）我也只看了同样的表面指标，并没有真正解码过音频。
所以「MV 那支可用」这个结论也不成立。

### 处理：把这条路径**默认关掉**

> **一个会静默产出坏音频的功能，比慢更糟。**

- `asr.reuseOriginalAudio` 默认改为 **false**，并加注释说明为什么
- 判断条件从 `!== false` 改为 `=== true`（必须显式开启）
- 设置项文案改为「实验性：按 sidx 切片尚未验证正确，可能得到坏音频，默认关闭」
- 日志里明确写出「这个功能默认关闭」及其原因

代码保留（sidx 解析、baseOffset 修正、逐片释放都在），
方便后续把它做对之后直接启用。

### 这一轮仍有效的部分

- **baseOffset 修正**：`parseSidx` 之前漏了「index 段在文件里的起点」，
  导致所有偏移少了 943 字节。这是真 bug，已修（第 1 个偏移现在正确落在 moof 上）。
- **去掉多余的 mono 复制**（省约 1.3GB，2 小时视频）
- **长视频内存预估 + 降内存建议**
- **codec 不再硬编码**、追加失败带出真实原因（这些在上一轮）

### 你现在的处境与建议

你的模型（XingChenASR-Diarize-V3.0）**要求 WAV**，所以长视频必然吃内存。
可选的路：

1. **换成支持 mp4/AAC 的识别模型**（如硅基流动的 SenseVoice）——
   走 M4A 上传，虽然仍要解码（因为要转成 M4A 重编码），
   但**至少不需要 WAV 那条最重的路**；
2. **只在短视频上用 XingChen**（它有精确时间轴，适合短内容）；
3. 等我**把 sidx 语义弄对**（需要解 moof 看它到底引用哪些字节范围），
   之后长视频就能既不解码、又只下载十几 MB。

第 3 条是真正的根治方向，但需要先搞清楚 B 站这个 fMP4 的分片语义。
在没弄明白之前，我不会再宣称它可用。

### 教训（写给下一个改这个仓库的人）

**「容器能加载」不等于「音频内容正确」。**
验证媒体处理必须落到**解码出真实的 PCM/文字**，
只看长度、box 头、能不能加载 —— 正是这次翻车的原因。
这一轮我因此不得不撤回一个已经推送给用户的功能。

## 第七十轮（1.54.0）—— 「识别出来的是推荐视频」的根因：给数据贴了我们的 cid

### 用户的关键补充

> 有一次识别出来了，**但是识别的是这个视频旁边的推荐视频**，我不理解。

这句话是决定性的：**识别成功说明音频是有效音频**，只是**属于另一个视频**。
也就是说，我们喂给识别服务的音轨，**本来就是那个推荐视频的**。

### 根因：`__INITIAL_STATE__.dash.audio` 被贴上了**我们的** cid

```js
// 旧代码
if (dash) push(dash.audio, '__INITIAL_STATE__', currentCid());
//                                            ^^^^^^^^^^^^^ 我们自己的身份
```

这里的问题非常隐蔽：

- `dash.audio` 的**字节**来自 `__INITIAL_STATE__`
- 而 `__INITIAL_STATE__` 在单页应用切换时**不一定同步更新**
  （`__playinfo__` 更是**页面级全局，SPA 切换后完全不会被清掉**）
- 旧代码却用 `currentCid()` 给它打标 —— **用我们的身份，去标注一段
  可能属于别的视频的数据**

于是它「看起来完全匹配当前视频」，顺利通过了我上一轮加的 cid 过滤，
被采用，转录出推荐视频的内容。

**这正是我上一轮修字幕时踩过的同一个坑**（"签名取错时刻"），
只是换到了音轨这条路径上；而且这次更隐蔽 —— 因为标注**看起来是对的**。

### 修法：分清「可验证」与「不可验证」

**① 主来源改为唯一可验证的那条**

`refreshAudioUrl()` 是**带着我们的 aid/bvid/cid 主动向 playurl 接口请求**的，
响应与身份一一对应 —— 这是唯一**可验证**的来源。
现在它排在最前并优先使用（以前是兜底，结果最常用的反而是不可信的那些）。

候选上新增 `verified` 标记，只有这条路径为 `true`。

**② 页面全局不再被贴我们的 cid**

| 来源 | 标注方式 |
|---|---|
| `__playinfo__` | 用它**自己的** `data.cid` 自证 |
| `__INITIAL_STATE__.dash` | 用它**自己的** `videoData.cid` 自证 |
| 播放器 API | 记 `currentCid()`，但标记为**未验证** |
| media 元素 | 同上，未验证 |
| **主动 playurl** | **已验证** |

**③ 过滤规则收紧（分两级）**

- 有 `verified` 候选 → **只用** verified，页面全局一个都不掺
- 没有 verified → 只采用 cid **明确等于** wantCid 的；
  没有 cid 或 cid 不符的一律排除
  （以前是"没有 cid 就宽松放行"，那正是假匹配能溜进来的口子）

**④ 日志如实报告来源可信度**

```
音轨来源：已用当前视频的 aid/cid 重新向接口请求（可信）
```

或

```
⚠ 未能从接口取到可信音轨，只能使用页面已有的音轨地址；
  如果页面刚切换过视频，这段音轨可能属于上一个视频。
```

### 新增 9 项测试

```
PASS  音轨候选带 verified 标记
PASS  主动请求 playurl 的候选标为 verified
PASS  __playinfo__ 用自身 cid 而非 currentCid
PASS  __INITIAL_STATE__ 用自身 cid（不再贴 currentCid）
PASS  播放器 API 候选不作验证
PASS  有可信来源时只用可信来源
PASS  无 cid 的候选不再宽松放行（有 wantCid 时）
PASS  对外报告是否用了可信来源
PASS  collectAudioCandidates 接收身份参数
```

### 仍然要提醒你的事

**内存问题（1.52/1.53 那两条）依旧存在** —— 你的模型要求 WAV，
130 分钟必然解码，必然吃 5GB 级内存。这一轮修的是**内容归属**，
不是内存。**长视频 + XingChen 这条路，在换模型之前仍不建议用。**

## 第七十一轮（1.55.0）—— 撤回实验功能 + 找出两个「点了会报错」的真 bug

用户说：「还是不搞了吧（指直接复用 B 站的原始 AAC 音轨），
之前的就挺好的，换回去吧。去优化优化操作，以及检测代码相关问题。」

### ① 撤回「原始音轨复用」

删掉了整条实验路径：

- `src/sidepanel/modules/aac.js`（整文件）
- `transcribe.js` 里的复用分支
- `settings.js` 里 `reuseOriginalAudio` 设置项
- 设置页的复选框
- `selfcheck.js` 的导入
- `verify/default-settings.json` 的字段
- panel-test 里约 70 行的相关断言

保留的只有一处：加了一条断言**确认它不会回来**
（`!/reuseOriginalAudio/ && !/assembleOriginalAac/`）。

### ② 撤回时我差点又埋一个坑（被自己抓住）

删代码时把 `const concurrency = ...` 与 `const timeoutSeconds = ...`
**一起删掉了**，但使用点还在（`runPool(plan.slices.slice(1), concurrency, ...)`）。

**`node --check` 查不出来**（语法合法 —— 引用未声明的变量是合法语法）。
是 `asr-test.mjs` 里一条「并发上限仍是 8」的断言抓住了它。
如果那条断言不存在，这就是一个**上传前完全看不见的运行时崩溃**。

### ③ 静态体检流程（新增 `verify/static-check.mjs`）

加了「所有入口必须能打包」的检查 —— 用 esbuild bundle 五个入口
（面板 / 自检 / 后台 / 内容脚本 / 主环境桥），
能抓出「引用了不存在的模块或导出」。

**试过但放弃的**：用正则扫「未声明标识符」。噪声太大 ——
属性名、对象键、模板串里的词全被当成标识符，出了 1758 条误报，
**一条真问题都挑不出来**。一个没人信的检查等于没有检查，所以删掉了，
并在文件里写清楚「为什么不做这个」。

> 诚实的边界：打包检查覆盖不了「引用了未声明的变量」。
> 这一类目前只能靠测试套件覆盖到 —— 这也是为什么要保留
> `asr-test` 那条看起来"琐碎"的断言。

### ④ 新断言立刻抓出两个真 bug（跨面板 API 契约）

新增「被 `app.panels.X.Y` 调用的方法，必须在 X 的 `init()` 里导出」。
一跑就抓出两个：

**bug 1：`runTranscribe` 没挂到面板上**

```js
// panel-actions.js
export function runTranscribe() { ... }   // ✅ 有 export
return { render, seek, reload, harvest, ... };  // ❌ 但没放进 return
```

`panel-subtitles.js` 里 `app.panels.actions.runTranscribe()` 拿到的是
`undefined` —— **点击「语音转录」直接抛「不是函数」**。
这是我上一轮（1.51.0）刚加的按钮，**一直是坏的**。

**bug 2：`exportDialog` 没挂到面板上**

```js
// panel-subtitles.js
export function exportDialog() { ... }        // ✅ 有 export
return { render, renderToolbar, scrollToLine };  // ❌ 漏了
```

`panel-actions.js` 里 `app.panels.subtitles.exportDialog()` 同样是
`undefined` —— **操作区的「导出」按钮点击无效**。

两个 bug 的共同特征：**`export` 存在，但没进 `init()` 的 return 对象**。
语法检查、打包、之前所有测试**全都发现不了** ——
因为它们只检查「函数存在」，不检查「函数挂上去了没有」。

### 为什么之前的测试没抓到

我上一轮给 `runTranscribe` 写的断言是：

```js
check('有统一的 runTranscribe 入口', /export function runTranscribe\(\)/.test(actSrc));
check('失败提示里的转录走 runTranscribe', /button\('语音转录', \(\) => runTranscribe\(\)/.test(actSrc));
```

**两条都只验证「写了这个函数」和「调用了它」，
没有验证「调用方能拿到它」。** 典型的"验证了错误的东西"。
新断言改从 `init()` 的 return 块里查键名，才真正覆盖到。

### 新增 4 项断言

```
PASS  跨面板调用的方法都在 init() 里导出
PASS  actions.init 导出了 runTranscribe
PASS  actions.init 导出了 summarize
PASS  actions.init 导出了 harvest/reload/seek
```

### 测试

```
22 个套件 + 静态体检，共 1239 项断言，全部通过
```

## 第七十二轮（1.56.0）—— 操作区排版优化（真实 Chrome 量出来的）

用户要求：「去优化优化操作」。

### 先量，再改

**jsdom 不做布局**，所以「按钮太多把工具栏撑高」这类问题，
测试套件完全看不见（`textContent` 里有那个按钮就算通过）。
用真实 Chrome + 真实 `panel.css` 量了一次：

```
字幕就绪时（改前）@400px → 操作区高 81px，4 行，8 个元素
```

400px 是侧边栏的常见宽度，操作区吃掉 81~113px，
**接近可视高度的三分之一**，把真正要看的字幕往下挤。

### 四处改动

**① 可见按钮 7 → 5 个（把「优化字幕」「复制」收进「⋯」）**

这两个动作在字幕面板的「⋯」里本来就有，属于「偶尔用一次」。
保留的 5 个是主流程：
`③ 生成总结` / `⚡ 快速总结` / `去提问` / `导出` / `⋯`

**② 「⚡ 快速」→「⚡ 快速总结」**

内部菜单与 AI 面板都叫「快速总结」，只有操作区写「快速」——
用户不确定"快速"的是哪一步。

**③ 「⋯」菜单加分组小标题**

10 项平铺要逐行读完才知道哪个是哪个。现在按流程分组：

```
获取内容    重新读取视频 / 重新获取字幕 / 语音转录
加工字幕    优化字幕（AI） / 应用替换规则 / 生成章节 / 质量自检
结果与记录  复制全部字幕 / 历史记录与回退 / 批量处理
            清空字幕
```

`popoverMenu` 新增 `{ heading: '…' }` 支持（纯文本，不可点击，
且不参与「全部禁用」的判断）。

**④ 视频标题胶囊截断（这个是真 bug 级的体验问题）**

长标题在窄侧边栏里会把操作区顶到 **4 行**。修的过程中踩了两个坑：

- **坑 1**：只给 `.pill` 加 `text-overflow` 不够 ——
  胶囊自己会随内容变宽，于是「先换行、再截断」，标题照样占两行。
  解法：胶囊内部改 flex（外层 `overflow:hidden` + **内层 span** 负责
  ellipsis），`min-width:0` 让 flex 项真的能被压缩。
- **坑 2**：标题胶囊会占满一整行（长标题时宽 340px），
  把同一行的「240 行」胶囊挤到下一行，操作区还是多一行。
  解法：给标题胶囊 `max-width: 70%`（**不是 100%** —— 100% 会独占一行、
  必然多一行），留出位置给其它胶囊。

### 效果（真实 Chrome 实测）

| 场景 | 改前 | 改后 |
|---|---|---|
| @360px，普通标题 | 4 行 / 81px | **3 行 / 70px** |
| @420px | 4 行 / 81px | **3 行 / 70px** |
| @360px，**超长标题** | 4 行 / **93px** | **3 行 / 70px**（与普通标题一致） |
| 超长标题是否溢出 | — | 否（ellipsis 生效：内层 320px，内容 489px） |

### 新增 `verify/layout-check.mjs`（真实 Chrome 布局回归）

**为什么必须有**：`jsdom` 不做布局，`panel-test`/`flow2` 都发现不了
排版问题。这个项目已经因为「只看结构不看布局」栽过（⋯ 菜单被
`overflow:hidden` 裁掉那几轮）。

它加载**真实的 `panel.css`**、用**与面板同款的结构**，在真实 Chrome 里量：

```
PASS  操作区在 300px 下不超过 4 行     -> 4 行 / 高 81px
PASS  操作区在 360px 下不超过 3 行     -> 3 行 / 高 70px
PASS  操作区在 420px 下不超过 3 行     -> 3 行 / 高 70px
PASS  超长视频标题不会撑高操作区       -> 普通 70px vs 超长 70px
PASS  超长标题被省略号截断（不溢出）   -> 宽 360px
```

> 这条检查的价值就在于：**它在我改的过程中真的红了两次**。
> 第一次是 300px 下 4 行、超长标题 93px；
> 第二次我贴了 100% 反而更糟 —— 都是靠它发现的，不是靠肉眼。

### flow2 的断言同步收紧（这次没有放松）

原来那条断言是：

```js
check('② 常用按钮直接可见（提问 / 优化字幕 / 复制 / 导出）', ...)
```

它之所以在我把按钮挪进菜单后**依然通过**，是因为 `textContent`
把「⋯」菜单里的项也算进去了 —— **这是个假通过**。

改成了明确的两条：

```js
check('② 主流程按钮直接可见（生成总结 / 快速总结 / 提问 / 导出）')
check('② 「优化字幕」「复制」在 ⋯ 菜单里仍可达')
check('② 可见按钮不超过 6 个')   // 从 7 收紧到 6
check('② ⋯ 菜单带分组小标题')
```

### 测试

```
23 个套件（含静态体检 + 布局体检），共 1247 项断言，全部通过
```

## 第七十三轮（1.57.0）—— 为什么视频一长转录就急转直下

用户问：1 小时多的视频转录 2 分多钟，2 小时的却 10 分钟还没出来。

### 根因：MediaRecorder **只能实时编码**，而它是长视频的唯一瓶颈

`encodeSliceToM4a` 里：

```js
rec.start(250);
src.start();
const durationMs = (len / rate) * 1000;
timer = setTimeout(() => rec.stop(), durationMs + 余量);
//                                ^^^^^^^^^^^^^ 编 600 秒音频要实打实等 600 秒
```

也就是说**编码墙钟 = 音频秒数**。而编码池宽度只有 2（当时注释写的
「MediaRecorder 走音频实时时钟，开宽了互相拖慢」），于是：

```
整条音轨编码墙钟 ≈ 音频时长 ÷ 2
```

再叠上 `defaultSliceSeconds: 600`（10 分钟一片）：

| 时长 | 编码墙钟（宽 2） | 识别墙钟（并发 4） | 谁在拖 |
|---|---|---|---|
| 30 分钟 | 15 分 | 1.3 分 | 编码 |
| 84 分钟 | **42 分** | 3.5 分 | 编码 |
| 130 分钟 | **65 分** | 5.4 分 | 编码 |

**识别只要几分钟，编码却是时长的一半。** 所以时长越长，
编码在总耗时里的占比越高 —— 表现为「越长越离谱」。

### 验证：`playbackRate` 救不了

我一度想用 `src.playbackRate = 16` 加速采集，真机实测：

```
rate=1  → 20 秒音频用 20.5 秒（1.0×）
rate=2  → 10.5 秒（1.9×）
rate=4  →  5.5 秒（3.6×）
rate=8  →  3.0 秒（6.7×）
rate=16 →  1.8 秒（11.4×）
```

能提速，但 **`captureStream()` 走的是音频硬件时钟，播不出那么快**，
最多约 11×，而且丢帧风险大。这条不是正路。

### 正解：**根本不需要编码**

B 站给的 dash 音轨**本身就是一个完整的 MP4/AAC**。
实测（`BV1be41127ft`，974 秒）：

```
整条下载 5,004,974 字节 = 4.77MB，用时 12.3s
box 链：ftyp(36) -> free(8) -> free(74) -> moov(825) -> sidx(2372)
        -> moof(1048) -> mdat(22545) -> moof(580) -> mdat(20998) -> …
含 mp4a（AAC）：✅
```

**它可以直接作为 mp4 上传给「接受 M4A 的模型」。**
于是对 130 分钟的视频：

| | 旧路径 | 新路径 |
|---|---|---|
| 下载 | 80MB（74s） | 约 10MB（约 60~75s） |
| 解码 | 5.2GB 内存，可能崩 | **不做** |
| 重编码 | **65 分钟**（实时） | **不做** |
| 上传 | 分片 | 整条 |
| 内存峰值 | 5.2GB | **约 10MB** |

新增 `src/sidepanel/modules/original-audio.js`：`fetchWholeAudio()`
（整条取回 + 校验 `ftyp`/`moov`/`mp4a`）+ `estimateWholeAudioBytes()`
（按带宽估大小，超限就不下）。

放在**下载之前**：整条取这一份就够了，不必再走「下载 → 解码 → 重编码」。

### 为什么这跟上一轮被我撤回的「sidx 切片」不一样

这是关键区别，我特意写进代码注释：

| | sidx 切片（已撤回） | 整条直传（本轮） |
|---|---|---|
| 是否需要推导字节范围 | **需要**（我算错了，没验证出来） | **不需要** |
| 取回的内容 | 按索引拼装，可能错位 | 与浏览器播的**同一份** |
| 正确性 | 无法确认 | 天然正确 |

上一轮的教训是「容器看起来对 ≠ 内容对」。
这一轮**完全不做字节算术** —— 就是「从头取到尾」，
所以不存在我推错的可能。而且我这次**取回真实字节并校验了 box 链**，
不是只看表面指标。

### 实测验证（真机，非沙箱构造）

```
1) 大小估算: 4.78MB（带宽 41148, 时长 974s）  ← 与实际 4.77MB 吻合
2) 整条取回: ok=true, 5,004,974 字节, 12.3s, transport=original-audio-whole
3) 非 AAC:  opus -> 拒绝（not-aac）
4) 超限:    预估超上限时**不下**（oversized）
5) 坏字节:  乱码 -> no-ftyp 拒绝；真实 -> 通过
```

### 新增 12 项断言

```
PASS  导出了 originalAudio 模块
PASS  能按带宽估算整条大小
PASS  合法 MP4/AAC 通过校验
PASS  缺 ftyp / 缺 moov / 缺 mp4a / 过小 都被拒绝
PASS  主流程接了整条直传
PASS  整条直传放在下载之前
PASS  WAV-only 模型不走整条直传
PASS  超限前先估算、不硬下
PASS  整条识别有随时长放大的超时
```

### 仍然存在的限制（要说清楚）

- 这条路要求模型**接受 M4A**。WAV-only 模型（XingChen 系列）走不了，
  仍会落到「下载 → 解码 → 实时重编码」，长视频依旧慢
  （这就是第七十轮预告过的那个问题）。
- 整条上传时，识别耗时随时长增长，所以超时按
  「音频秒数/2 + 5 分钟」放大（`timeoutsForWholeAudio`），下限 10 分钟。
- 我对「服务端能否接受十几 MB 的整条 mp4」**只做了本地校验，
  没有真的提交给服务端**（沙箱里没有可用的 Key）。
  所以第一次真机跑如果被拒，日志会写「整条音轨识别结果为空」并自动
  回退到原路径 —— 不会让用户卡死，但**这一条我确实没端到端验证过**。

## 第七十四轮（1.58.0）—— detached ArrayBuffer + 我自己新引入的两个 bug

用户日志（1.57.0）非常有信息量，逐条看：

```
音轨来源：已用当前视频的 aid/cid 重新向接口请求（可信）   ← ✅ 归属修复生效
已排除 6 条不属于当前视频的音轨候选                        ← ✅ 过滤生效
整条音轨直传不可用（network），回退到「下载 + 解码」路径   ← ❌ 我的新功能坏了
下载完成：62.0MB，用时 8.3s
按 M4A 重封装上传（FFmpeg 流复制，不重新编码）
第 1/13 片重封装：4806.3 KB
Failed to execute 'postMessage' on 'Worker':
An ArrayBuffer is detached and could not be cloned.        ← ❌ 老代码的隐藏 bug
```

### bug ①（老代码）detached ArrayBuffer：第 2 段就炸

`transcribeViaRemux` 里**每段都调** `remuxToMp4(rawBytes)`：

```js
for (let i = 0; i < slices.length; i += 1) {
  const out = await remuxToMp4(rawBytes, { ... });   // 同一个 rawBytes
```

而 `ffmpeg.writeFile()` 会**把 ArrayBuffer transfer（转移）给 Worker** ——
transfer 之后**主线程这份就 detached 了**（`byteLength` 变 0）。
所以：

- 第 1 段：正常 → 「第 1/13 片重封装：4806.3 KB」
- 第 2 段：`rawBytes` 已经是 detached 的空壳 → `postMessage` 报错

**这是一个一直存在的 bug**，只是以前音轨小（整条装得下、只跑 1 段）时
永远碰不到。用户 2 小时视频第一次让它现形。

**修法**：改成「一个 FFmpeg 会话、输入只写一次」。
新增 `openFfmpegSession()`：`writeInput` 一次，之后每段只 `exec` + `readFile` +
`deleteFile`（产物读完即删，不让虚拟 FS 堆 13 个文件）。
顺带省掉了「每段重复把 62MB 传进 Worker」的开销。

`writeInput` 里还处理了一个细节：如果传进来的是**大 buffer 上的视图**，
transfer 会带走整个 buffer —— 所以先 `slice()` 成独立副本。

### bug ②（我新写的）`res.bytes` 判断错了 —— page.call 回的是 base64

`fetchWholeAudio` 里我写的是：

```js
if (!res || !res.ok || !res.bytes || !res.bytes.length) { ... }
```

但 `page.call('fetchAudioRange')` 返回的是 **`{ ok, base64, byteLength }`**
（不是 `bytes`）—— 于是**每次成功都被我判成失败**。
这就是日志里那句「整条音轨直传不可用（network）」的真实来源：
不是网络问题，是我自己把成功当失败。

**修法**：面板层自己 `base64ToBytes(res.base64)`。
同时把「取整条」改成**显式 Range**（`bytes=0-`）而不是不带 Range ——
并且允许用 `Content-Range` 里的总长度再补一次精确请求。
页面桥的 `fetchAudioRange` 现在也支持直接传 Range 串。

### bug ③（我新写的）`throwIfAborted is not defined`

`original-audio.js` 里调了 `throwIfAborted`，但那是 `audio.js` 的**内部**
函数，我既没定义也没导入。**测试全绿**（因为没跑到那一行），
只有真机执行才报 `ReferenceError`。

**修法**：本模块自带一份定义（它是独立模块，不该依赖别人的内部函数）。

> 这个 bug 值得记下来：**「所有测试通过」不等于「代码能跑」。**
> 测试覆盖不到的分支里的 `ReferenceError`，语法检查、打包、
> 静态体检**全都发现不了**。

### 实测验证

`ffmpeg-remux-test.mjs` 加了多段回归 —— **在真实 Chrome 里跑真实 FFmpeg**：

```
PASS  多段重封装全部成功（不再 detached）
PASS  确实跑了 3 段
PASS  每段都有产出
PASS  writeInput 会 detach 调用方 buffer（预期行为，故只能写一次）
```

最后那条是**故意断言 detach 行为**：把「为什么只能写一次」变成一条
可执行的说明，防止以后有人又写成循环复用同一份 buffer。

整条直传路径（真机）：

```
ok: true
用过的 range: ["bytes=0-"]
字节: 5004974 = 4.77MB | 10.5s | original-audio-whole
只回 base64 的 fetcher -> false（说明面板层必须自己解码，已修）
```

### 新增 11 项断言

```
PASS  original-audio 自带 throwIfAborted 定义
PASS  original-audio 不从其它模块借 throwIfAborted
PASS  取整条用显式 Range
PASS  能从 Content-Range 解析总长度
PASS  面板层把 base64 解成 bytes
PASS  页面桥支持 Range 串写法 / 分发时透传 range
（多段 detach 回归 4 项见上）
```

### 反思

这一轮修了 **1 个老 bug + 2 个我自己刚引入的 bug**。
两个新 bug 的共同点：**都是"只在运行时、且只在特定分支暴露"的问题**
（把成功判成失败、未定义函数），而我上一轮声称「已实测验证」时
**并没有真的跑过完整路径**。

更诚实的说法应该是：上一轮我验证了 `original-audio.js` 的**纯函数**
（大小估算、容器校验）和「从 Node 直接调 fetch 取整条」，
但**没有验证它对 `page.call` 契约的假设** —— 而错误正好出在那里。

## 第七十五轮（1.59.0）—— 「总结到某个时间点后就没有了」

用户问：2 小时的视频官方字幕**是全的**，但总结到某个时间点后就没有了。

### 根因：喂给 AI 的字幕被截成了前 40000 字符

`panel-ai.js` 里：

```js
const ctx = selectContext(correctedLines, '', 40000);
```

而 `selectContext` 在**问题为空**时走这条路：

```js
const q = String(question || '').toLowerCase().split(...).filter(...);
if (!q.length) return { text: full.slice(0, maxChars), truncated: true };
//                     ^^^^^^^^^^^^^^^^^^^^^^^^^^ 直接取前缀
```

所以：

- **字幕本身是完整的** —— `validateLines` 只校验覆盖率，从不截断
- **截断发生在「喂给 AI」这一步** —— 只把前 40000 字符送进去

实测（构造 2057 行、约 6.6 万字符）：只喂了 **1250 行 = 61%**，
最后一行是 `[72:51]` —— **正是"到某个时间点后就没有了"**。

### 修法：分段总结再合并（map-reduce）

不能只取前缀，也不能直接放弃剩下的内容。改成：

1. `chunkTranscript()` 按行切成每段 ≤ 40000 字符（**在行边界切**）
2. 对**每一段**单独调 AI，提取该段的主题 / 要点 / 引用 / 时间点
3. 把各段提取结果交给 AI **合并成一篇完整总结**，明确要求「覆盖**全片**」

进度条会显示「分段总结 3/5」与「合并 5 段为完整总结」，
中间结果也会实时显示在总结区，用户能看到进展而不是干等。

代价：多几次 AI 调用（2 小时字幕约 2 段）。换来的是**不再丢内容**。

### 顺带修掉一个我自己犯的同类错误

我在 `panel-ai.js` 里用了 `fmtClock`，但它是 `subtitles.js` 里的
**内部函数**（只有 `function`，没有 `export`）—— 又是一个
「用了但没导入」的 ReferenceError，**语法检查、esbuild 打包、
静态体检全都发现不了**（它看起来就是个未声明标识符，语法完全合法）。

修法：`subtitles.js` 导出 `fmtClock`，`panel-ai.js` 导入它。

### 新增 `verify/import-check.mjs`

专门盯这一类：**A 模块用了 B 的导出，却没有导入**。

做法上刻意限定范围以求**零误报**：

- 只检查「A 确实 `import` 了 B」这条**明确的依赖边**上的漏导入
- 不去猜「某个裸名字是不是方法名」（`.get(`、`.clear(` 会误报一片）
- 跳过长度 < 4 的名字（太容易与属性名相撞）

**验证这个检查真的有用**：我临时把 `fmtClock` 的导入去掉，
它立刻报 `panel-ai.js 用了 fmtClock（定义在 subtitles.js）但未导入`；
恢复后 PASS。**不是写了一个永远绿的检查。**

### 新增 10 项断言

```
PASS  长字幕会被 selectContext 截断（旧行为的证据）
PASS  subtitles 导出了 fmtClock / fmtClock 格式正确
PASS  长字幕被切成多段 / 每段都不超过上限
PASS  所有行都被覆盖（不丢内容）
PASS  最后一段包含视频结尾
PASS  总结在截断时走分段合并
PASS  有分段提取与合并两段提示词 / 合并提示词明确要求覆盖全片
```

### 测试

```
24 个套件（含静态体检 / 布局体检 / 导入体检），共 1282 项断言，全部通过
```

## 第七十六轮（1.60.0）—— 「字幕未提供」是 AI 自己推断的

用户问：01:58:11 的视频，报告说「字幕覆盖 00:00–1:43:39，之后约 14 分钟
字幕未提供」，但用户看字幕清单里**明明有后面的字幕**。

### 第一步：先确认这行字是谁写的

在整个 `src/` 里搜「未提供」「之后约」「字幕覆盖」—— **搜不到**。
也就是说**这行字不是我们代码产生的**，是**模型自己写进总结里的**。

### 模型为什么会这么写

看提示词里给了它什么：

- 合并提示词里有 `时长：1:58:11`（视频总时长）
- 各段的时间标签只到**最后一句字幕**为止（约 `1:43:39`）

模型于是**做了一次减法**：1:58:11 − 1:43:39 ≈ 14 分钟，
然后写出「之后约 14 分钟字幕未提供」。

**它写得很有据可依的样子，但这个结论不是事实，是它的推测。**
我们代码里从来没有「字幕未提供」这个判断 —— `validateLines` 的
覆盖率门限是 18%，1:43:39 / 1:58:11 = 87.7%，**远超门限，根本不会报**。

顺带一提：这也解释了为什么它偏偏说「14 分钟」——正好是那个差值。

### 修法（两个方向一起）

**① 把真实覆盖范围交给模型，并禁止它议论完整性**

- 新增 `subtitleSpan(lines)` 算出字幕真实的起止时间与行数
- 新增 `describeSpan()` 生成一句话，**同时塞进单次总结与分段合并的提示词**：
  ```
  本视频**已获取到**的字幕时间范围：00:00 ~ 1:43:43（共 2057 行）；视频总时长 1:58:11
  ```
- 合并提示词里明确加了一条：
  ```
  - **不要**写任何关于「字幕是否完整 / 某段字幕未提供 / 字幕只覆盖到某处」的说明。
    你无法判断字幕来源的完整性，这类结论只会误导用户。
  ```
- 字幕原文的引导语也从「下面是这期视频的字幕原文」改成
  「（**已提供的全部**，请据此整理，不要推测缺失部分）」

**② 界面上直接把真实范围显示出来**

新增一个胶囊：

- 覆盖正常：`字幕 00:00–1:43:43`
- 末尾缺口 > 60 秒：`字幕至 1:43:43（末尾缺约 14 分钟）` —— 换用醒目样式

这样用户**不用听 AI 的推测**，一眼就能看到字幕到底覆盖到哪、
有没有真的缺。诊断面板里的时间也从裸秒数（`末句 6220.3s`）
改成 `1:43:43` 这种可读形式 —— 之前用户得在脑子里换算。

### 关键判据（供后续参考）

**如果界面上那个新胶囊也显示「末尾缺约 14 分钟」**，
说明字幕文件里**确实**没有 1:43:39 之后的行 —— 那问题在字幕来源，
不在展示。（从用户这次的描述看，这个可能性不低：
它可能命中了页面里一个**较早版本/不完整**的字幕文件。）

**如果胶囊显示覆盖到 1:58 左右**，说明字幕是全的，
之前那条「未提供」纯粹是模型编的 —— 本轮的两个修法正好治它。

### 新增 15 项断言

```
PASS  导出了 subtitleSpan / describeSpan
PASS  subtitleSpan 取到首末时间 / 统计行数 / 空输入返回 null / 非法输入返回 null
PASS  describeSpan 含真实首末时间 / 含总时长
PASS  单次总结提示词带上真实字幕范围
PASS  合并提示词带上真实字幕范围
PASS  明确禁止模型议论字幕完整性
PASS  字幕原文说明改为「已提供的全部」
PASS  操作区显示字幕覆盖范围
PASS  末尾缺口明显时给出提醒
PASS  诊断里的时间改成时:分:秒可读形式
```

### 测试

```
24 个套件，共 1297 项断言，全部通过
```

## 第七十七轮（1.61.0）—— 「操作超时 / ai.chat 超时（30000ms）」

用户报：

```
操作超时
ai.chat 超时（30000ms）
请刷新该 B 站页面后重试。
```

### 根因：服务端超时**只认 METHOD_TIMEOUT，忽略调用方传的值**

```js
// service-worker.js
function methodTimeout(method) {
  return METHOD_TIMEOUT[method] || DEFAULT_RPC_TIMEOUT;   // 30000
}
const result = await withTimeout(fn(...), timeout, `${method} 超时`);
```

而 `METHOD_TIMEOUT` 里**只有 `'ai.model'`，没有 `'ai.chat'`**。

于是出现了一个非常难查的组合：

| 位置 | 看到的东西 |
|---|---|
| 调用处代码 | `call('ai.chat', {...}, { timeoutMs: 300000 })` —— **看起来给足了 300 秒** |
| 客户端 bridge | `opts.timeoutMs || METHOD_TIMEOUT[method] || DEFAULT` → 用 300 秒 |
| **服务端** | `METHOD_TIMEOUT['ai.chat'] || 30000` → **30 秒掐断** |

**客户端设了 300 秒，服务端 30 秒就把请求掐了。**
用户看到「ai.chat 超时（30000ms）」，而代码里根本找不到那个 30000 ——
因为它来自一个**默认值**。很容易误判成「模型太慢」。

**这和老早就记录过的 `asr.transcribe` 事故是同一个坑**
（`AGENTS.md` §3.2 写得很清楚：「新增任何耗时 RPC 方法，必须登记到
METHOD_TIMEOUT」）。`ai.chat` 一直漏登记，直到这一轮才暴露。

### 修法

**① 补登记 15 个方法**（全量扫描出来的、被调用却未登记的服务端方法）

```
ai.chat            600000   ← 总结/校对/章节/提问，长视频分段会连调多次
audio.range        180000   ← 整条音轨直传会一次拉十几 MB
platform.probe     120000
batch.resolve       90000
audio.candidates    40000
subtitle.api        40000
audio.refresh       30000
subtitle.trigger    30000
bili.comments       20000
page.refresh        20000
page.reinject       20000
tab.open            15000
batch.release       15000
build.info           8000
settings.patch       8000
```

并在表里写清楚**为什么必须登记**（服务端忽略调用方的 timeoutMs），
免得下一个人又踩。

**② 把回归测试从「手工清单」改成「自动扫描」**

原来的断言是：

```js
const mustRegister = ['asr.transcribe', 'asr.probe', 'platform.test', ...];
check('所有重方法都已显式登记超时', missing.length === 0);
```

**这份清单是手工维护的 —— 这正是 `ai.chat` 漏掉的原因。**
现在改成从源码里自动提取：

- 从 `service-worker.js` 解析出**服务端注册的全部方法**
- 从所有 `call('xxx'` 调用点提取**被调用的方法**
- 断言「被调用 ∧ 服务端存在」的方法**全部**已登记

**并验证了这条自动检查真的有效**：临时把 `ai.chat` 的登记去掉，
它立刻报 `FAIL 1 个未登记：ai.chat`；恢复后 PASS。

### 新增 1 项断言（但覆盖了整类问题）

```
PASS  所有被调用的服务端方法都已登记超时（自动扫描）
```

### 测试

```
24 个套件，共 1298 项断言，全部通过
```

## 第七十八轮（1.62.0）—— 总结里时间戳太多，影响阅读

用户反馈：「和之前的总结相比，这次怎么里面有很多时间，影响阅读了。」

### 根因：是我上一轮加的要求

在做「长视频分段总结」时，我在两处提示词里写了要保留时间：

```js
// 分段提取
'- 关键处保留时间，写成 `[mm:ss]`',
// 合并
'- 保留关键时间点，写成 `[mm:ss]`，方便用户跳转',
```

**"方便跳转"这个动机本身没错，但措辞太强** ——
模型把它理解成"每条要点都要交代时间"，于是几乎每行都塞一个 `[mm:ss]`，
整篇总结被时间戳淹没。

对比之下，**旧版（未分段时）的总结没有这个问题**，因为我没在提示词里
提过时间。所以用户感觉"这次和以前不一样了" —— 确实是这次才引入的。

### 修法：把"要求"改成"限制"

```js
// 分段
'不要给每条要点都标时间；只有极少数确实需要跳转的位置才写 `[mm:ss]`（整段最多一两处）。'
// 合并
'- **不要**在正文里大量标注时间。时间只保留在**极少数**真正需要跳转的位置（全篇最多 2~3 处），'
+ '其余一律不写时间，保持正文可读。'
```

关键在于**给出数量的上限**：「最多 2~3 处」比「只在关键处」有效得多 ——
后者模型无法判断"关键"到什么程度，索性全标上。

### 新增 4 项断言

```
PASS  分段提示词不再要求每条要点带时间
PASS  分段提示词明确限制时间数量
PASS  合并提示词也不再要求保留关键时间点
PASS  合并提示词限制时间数量（全篇最多 2~3 处）
```

> 写这几条断言时踩了一个小坑：我第一版把原来的措辞
> 「关键处保留时间，写成」留在了**注释里**解释原因，
> 结果 `!/关键处保留时间，写成/.test(src)` 因为注释也命中而失败。
> 改成用别的措辞描述历史即可 —— 这也提醒我：
> **用正则断言源码时，注释也在扫描范围内。**

### 测试

```
24 个套件，共 1302 项断言，全部通过
```

## 第七十九轮（1.63.0）—— 接入基元律动（TokenRhythm）

用户要求：「将基元流动这个平台加入到AI模型里面 https://tokenrhythm.studio/」

（用户写的「基元流动」是笔误，官方名是**基元律动** —— 页脚写着
「© 北京基元律动智能科技有限公司」。）

### 这个平台是什么

看清了它的三条文档才动手：

| 项 | 内容 |
|---|---|
| 基础地址 | `https://tokenrhythm.studio/v1` |
| 对话接口 | `POST /v1/chat/completions`，字段与 OpenAI 完全一致 |
| 模型列表 | `GET /v1/models` |
| 鉴权 | `Authorization: Bearer sk_tr_...` |
| Key 申请 | `https://tokenrhythm.studio/account` |

它还提供一个 Anthropic 协议的 `POST /v1/messages`，但**我们用不上** ——
`buildAiUrl()` 的 `isAnthropic()` 只认 `/anthropic\.com/i`，
所以它自然落到 OpenAI 分支，得到
`https://tokenrhythm.studio/v1/chat/completions`。

### 三件「接一个 OpenAI 兼容平台并不只是加一行配置」的事

**① 它的错误信封是自家格式，不是 OpenAI 的**

```json
{ "code": "UNAUTHORIZED", "message": "未认证或登录已过期", "traceId": "trace_45f6e697-…" }
```

而 OpenAI 是 `{ "error": { "message": … } }`。
`classifyHttp()` 原来只会把原始 JSON 截前 600 字符丢给用户 ——
用户看到的就是一坨 `{"code":"UNAUTHORIZED",...}`，**看不出发生了什么**。

新增 `errorEnvelope(bodyText)` 把它压成一句人话，并且**保留 traceId**
（向平台排查工单时要用）：

```
平台「基元律动（TokenRhythm）」 返回 401：UNAUTHORIZED：未认证或登录已过期（traceId trace_45f6e697-…）
```

几个刻意的边界：

- 只认**顶层**的 `code` + `message`；遇到 `json.error` 主动让路，
  保证 OpenAI 标准信封仍走原逻辑（有断言锁住）
- 解析失败返回 `null` 而不是抛错 —— 它不是校验器，只是个格式化器
- **关键词判定（quota / balance / 限流）仍用原文 600 字符**，
  不能改用解析后的中文文案：`MAX_TOKENS_EXCEEDED` 之类的英文码
  一旦被翻译掉就匹配不上了
- `MAX_TOKENS_EXCEEDED` 单独给了一条可操作的建议：
  「设置 → AI 模型 里把「最大输出长度」调小」

**② 网关可能在**流建立之后**才抛这个信封**

`chatStream` 原本只处理 `json.error`。如果数据流已经开始、
然后来一个 `{code, message}`，旧代码会把它当成「一个没有 choices 的增量」
**静默跳过** —— 用户最后拿到一段**被截断但看起来正常**的总结，
这是最难发现的一类故障。

所以在 `if (json.error)` 之后补了一段：

```js
if (!json.choices && typeof json.code === 'string' && typeof json.message === 'string') {
  throw new AppError('server', '模型返回错误', `${json.code}：${json.message}（traceId …）`, …);
}
```

**③ 它不在静态授权的 6 个域名里**

`manifest.json` 的 `host_permissions` 只硬编码了 deepseek / siliconflow /
openai / moonshot / bigmodel / groq 六个域名，其它域名靠
`optional_host_permissions` + `ensureOriginPermission()` 弹窗申请。

为了不让用户先踩一次「申请域名权限」，直接把
`https://tokenrhythm.studio/*` 加进静态列表。

### 改动的 5 处

| 文件 | 改动 |
|---|---|
| `src/shared/settings.js` | `defaultAiPlatforms()` 新增 `tokenrhythm`（`together` 之后、`custom-ai` 之前），12 个模型，不预置 Key |
| `manifest.json` | `host_permissions` 加 `https://tokenrhythm.studio/*` |
| `src/background/errors.js` | 新增 `errorEnvelope()`；`classifyHttp` 用它做文案；新增 `MAX_TOKENS_EXCEEDED` 分支 |
| `src/background/providers.js` | `chatStream` 拦截流内自家错误信封 |
| 版本 | 1.62.0 → 1.63.0（18 处，含测试里的「构建指纹」断言） |

**老用户不需要任何迁移**：`mergeBuiltinPlatforms()` 会把缺失的内置平台
以 `apiKey: ''` 追加，`migrateSettings()` 里已经调了三处（ai/asr/search）。
默认 `apiKey` 为空，所以它**不会**出现在「模型下拉框」里（那个框只列已配置
的平台），不会污染现有用户的界面。

### 真机验证（用假 Key 打真实接口）

沙箱里没有真 Key，但**错误路径本身就能验证接入是否正确**：

```
chat URL: https://tokenrhythm.studio/v1/chat/completions   ← 地址对
chatStream      → 401，kind=auth，title=API Key 无效或没有权限
listModelsWithSource → 401（说明「刷新模型列表」这条路也通）
detail: 平台「基元律动（TokenRhythm）」 返回 401：UNAUTHORIZED：未认证或登录已过期（traceId trace_45f6e697-…）
```

**这条 detail 是重点**：改之前这里会是原始 JSON。现在它证明
`errorEnvelope()` 在**真实响应**上生效，不只是在单测的构造字符串上生效。

### 新增 13 项断言（`verify/asr-test.mjs` 第 34b 节）

```
PASS  AI 平台里含基元律动（TokenRhythm）
PASS  基元律动的基础地址是 https://tokenrhythm.studio/v1
PASS  基元律动默认模型在自己的模型清单里
PASS  基元律动不预置任何人的 Key
PASS  基元律动给了申请 Key 的地址
PASS  基元律动走 OpenAI 协议 /chat/completions
PASS  manifest 已静态授权 tokenrhythm.studio
PASS  基元律动的错误信封被读成可读文案
PASS  错误信封保留了 traceId，便于向平台排查
PASS  错误信封里的原因也被保留
PASS  OpenAI 标准 error 信封仍按原逻辑处理
PASS  errorEnvelope 对标准信封返回 null
PASS  errorEnvelope 对非 JSON 返回 null
```

写成 `plain.kind === 'server'`（**不是 `code`**）—— 这个项目里 `AppError`
的字段一直叫 `kind`，第一版断言写错了一次。

### 一个自己踩的坑：版本断言是**转义正则**

bump 版本时我按 `1.62.0` 做字符串替换，18 处都换了，
但 `panel-test` 还是红了一项：

```js
// verify/panel-test.js:236
/构建指纹 1\.62\.0 · 8 模块 · 2025-06-01/.test(doc.getElementById('fingerprint').textContent)
//                    ^^ 转义了，纯字符串替换匹配不到
```

单独替换 `1\.62\.0` → `1\.63\.0` 才好。**纯数字的版本串会藏在转义正则里**，
下次 bump 要连 `\.` 形式一起搜。

### 测试

```
24 个套件，共 1315 项断言，全部通过
```

---

## 第八十轮（1.63.1）—— 修掉基元律动的 403 CSRF_INVALID

### 用户的报告

平台加好、Key 也填了，点「测试连接」却是：

```
API Key 无效或没有权限
平台「基元律动（TokenRhythm）」 返回 403：CSRF_INVALID：请求安全校验失败，请刷新页面后重试（traceId trace_87f90e17-…）
当前使用的 Key：长度 49，末四位 Cbig
```

Key 长度 49 说明不是空值也不是掩码，是**真 Key**。同一把 Key 用 curl 打
`https://tokenrhythm.studio/v1/chat/completions` 是好的（Cherry Studio 的
[CherryHQ/cherry-studio#18362](https://github.com/CherryHQ/cherry-studio/issues/18362)
里，报告者贴的 curl 也成功，因此这条线索可以复用）。

### 排查：不是 Key 的问题，是「浏览器上下文」的头

1. **假 Key 探针矩阵**（Node fetch 直打真实接口）：无 Origin / `Origin: chrome-extension://…` /
   `Origin: https://tokenrhythm.studio` / `Referer` / `X-Requested-With` / 全套浏览器头 /
   `GET /v1/models` —— **全部 401 UNAUTHORIZED**。说明鉴权在 CSRF 之前执行，
   假 Key **永远到不了** CSRF 检查，本地无法用它复现 403。继续打还被限流成 429。
2. **从他们前端 bundle 里挖到 CSRF 客户端逻辑**：Cookie 名 `tr_csrf`、头名 `X-CSRF-Token`，
   并且 `if (GET/HEAD/OPTIONS || headers.has('Authorization') || headers.has('X-CSRF-Token')) return;`
   —— 即带 Authorization 的请求前端**根本不加 CSRF token**。所以后端拦的不是「缺 token」。
3. **cherry-studio#18362 的结论**：触发头是 `Sec-Fetch-Site: cross-site`、`http-referer`、
   `x-title`（「尤其是 x-title」），去掉归属头就好了。也就是说：**是浏览器/Electron 自动附加的头**
   让网关判成「跨站伪造」。
4. 我们扩展的 service worker 发跨域请求时会带 `Origin: chrome-extension://<id>` 和
   `Sec-Fetch-Site` —— 用本地 echo 服务器实测确认了这一点。

### 修法：用 declarativeNetRequest 把这三个头摘掉

新增 `src/background/header-rules.js`：

* `headerStripRule(host, id)` 生成 `modifyHeaders` 规则，移除
  `origin` / `referer` / `sec-fetch-site`，`condition` 只写 `urlFilter: '||'+host`
  与 `resourceTypes: ['xmlhttprequest','other']`；
* `ensureHeaderRules(platform, url)`：**只有平台定义里 `stripBrowserHeaders === true` 才装规则**，
  按域名去重、SW 内缓存、并发去抖，并先 `getSessionRules()` 查重
  （session 规则活在浏览器会话里，SW 被回收后还在）。

接在 `providers.js` 的三处真实出口：`listModels()`、`chatStream()`、`chatOnce()`
（都必须在 `timedFetch` **之前** await，否则规则还没生效请求就发走了）。

`settings.js` 的基元律动平台加 `stripBrowserHeaders: true`，并写明原因。

### 关键技术事实（两次试错换来的，别再重走）

* **`condition` 里绝对不能写 `initiatorDomains: [chrome.runtime.getURL('')]`。**
  规则注册成功、`updateSessionRules` 不报错、`getSessionRules` 也看得到，
  但**永不匹配**（`onRuleMatchedDebug` 无任何回调）。只写 `urlFilter` 就正常命中。
  这是从 StackOverflow 抄来的「用 runtime.getURL() 当 initiatorDomains」的做法，实测是错的。
* **`--load-extension` 在 Chrome 137+ 已被移除**（本机 Chrome 155 实测：
  `--disable-extensions-except` + `--load-extension` 完全无效，target 列表里只有 Chrome
  自带的 `fignfif…` 组件扩展）。想用真机验证 unpacked 扩展，正确姿势是：
  ```js
  // 启动：chrome --headless=new --enable-unsafe-extension-debugging --remote-debugging-port=PORT
  // 然后走 CDP：
  await browserTarget.send('Extensions.loadUnpacked', { path: '…/bilibili-subtitle-assistant' });
  // 返回 { id }，SW target 的 url 是 chrome-extension://<id>/…
  ```
  配套注意：`Runtime.evaluate` 里 **`import()` 在 ServiceWorkerGlobalScope 被禁止**
  （HTML 规范），要调我们自己的模块就从**扩展页面**（`panel.html`）里 `import('/src/background/providers.js')`。

### 真机验证（不是猜的）

复制一份真实扩展（只额外把 `http://127.0.0.1/*` 加进 `host_permissions`），
用 CDP `Extensions.loadUnpacked` 装进 headless Chrome，在扩展页面里直接调 `providers.chatOnce()`，
打本地 echo 服务器，对比两次请求：

| 调用 | 服务器看到的 `origin` | `sec-fetch-site` | `referer` |
| --- | --- | --- | --- |
| 不加 `stripBrowserHeaders` | `chrome-extension://ekemcda…` | `none` | null |
| 加 `stripBrowserHeaders: true` | **null** | **null** | **null** |

第二次与 curl 发出的请求头一致 —— 这正是能通过 CSRF 校验的形态。

### 新增断言（`verify/asr-test.mjs` 第 34c 节，共 9 项）

基元律动带 `stripBrowserHeaders`；没有别的平台被误开；规则恰好移除三个头；
`urlFilter` 正确；覆盖 `xmlhttprequest`；**规则不带 `initiatorDomains`**（回归防线）；
`hostOfUrl` 取域名/非法地址返回空串；没声明该字段的平台 `ensureHeaderRules` 直接返回 false。

### 版本

1.63.0 → 1.63.1，18 处（含 `verify/panel-test.js:236` 里的**转义正则** `1\.63\.1`）。

### 测试

```
24 个套件，共 1324 项断言，全部通过
```

---

## 第八十一轮（1.63.2）—— 身份签名被后台吞掉，以及一批「看起来在生效」的死代码

### 起因

`audio.candidates` 在 service worker 里只透传 `aid/bvid/cid`，把面板传的 `signature` 丢了。
页面桥的 `getAudioCandidates` 用 `wantSig` 做「采集前 / 采集后」一致性校验；
`wantSig` 为空时 `if (wantSig && ...)` 直接跳过 —— 于是「页面切到别的视频」这道防线
在**最常见的路径上根本没生效**。这类 bug 不会报错，只会在切视频时偶尔转录出别的内容。

### 同批修掉的问题

1. **页面调用超时永远 15s**：`rpcPage` 用 `METHOD_TIMEOUT['page.' + method]` 查表，
   而 method 是 `getInfo` / `getAudioCandidates` / `fetchAudioRange`，
   表里却是 `page.info` / `audio.candidates` / `audio.range` —— 两边永远对不上。
   改为显式 `PAGE_METHOD_TIMEOUT` 映射；`fetchAudioRange` 恢复到 180s
   （整条音轨十几 MB，以前后台 15s 就掐断，表现为「大文件偶发失败」）。
2. **`triggerSubtitleMenu` 用 `subtitleSniff.items.size`** 判断「已有字幕」——
   这个 Map 跨视频从不清空，换视频后的第一次抓取会直接返回 already，
   根本没去点播放器字幕菜单。改用 `freshSniffed()`；同时把尝试次数改为**按视频**计数，
   否则页面里累积 6 次后会对所有后续视频永久返回 `too-many-attempts`。
3. **给不可信来源贴 `currentCid()`**：`player.getAudioTracks()` 与 `<audio>/<video>`
   元素都被贴上当前 cid。前者改为只认播放器 `getVideoMessage().cid`，后者标 `null`。
   这正是「识别成推荐视频」的入口。
4. **后台设 Referer / Origin 是死代码**：`fetchSubtitleBody` / `fetchAudioChunk` /
   `headAudio` 里设置的 forbidden header 会被浏览器静默丢弃，真正生效的是
   `rules.json` 的 DNR。删掉无效头并写明原因；测试改为断言「不设 forbidden 头 + 带 Cookie」。
5. **构建指纹失真**：`BUILD_TIME` 固定为 `2025-06-01`，`BUILD_MODULES` 只列 8 个模块
   （漏 `mcp` / `tools` / `bili` / `keyless-search` 等），但 README 让用户用它判断
   是否加载了新版本。补全为 17 个模块并更新构建时间。
6. **前台空转**：内容脚本 90ms 轮询 DOM（约 11 次/秒）、页面在后台时仍每秒发一次
   time 事件唤醒 SW。轮询降到 250ms；`document.hidden` 时跳过 follow 上报。
7. **死代码**：删除内容脚本里永远返回 false 的 `tryOpenSidePanelDirect()`，
   以及初始化时发出却完全忽略返回值的 `page.options` RPC。
8. **仓库卫生**：删掉根目录两个 0 字节文件与 Chrome 生成的 `_metadata/`，
   `.gitignore` 增加 `_metadata/`。
9. **README 漂移**：平台数量写成 5/3/3（实际 28/3/11）、默认并发写 1（实际 4）、
   测试数量 727（实际 1300+）、重复段落与断裂表格，逐项修正。

### 没改的（记录在案）

- 音频下载仍有两条入口：`AudioDownloader` 走 `audio.range`（页面优先、后台兜底），
  整条音轨重封装走 `page.call fetchAudioRange`。两条最终都到页面，
  但错误分类与凭证语义不同，后续可合并。
- `collectAudioCandidatesWithRefresh` 在候选为空时会再刷新一次 playurl
  （`collectAudioCandidates` 内部已经刷过一次），属于同请求重试；暂保留。
- `bili.js` 的 `headerFor()` 仍设置 `Referer` / `User-Agent`。官方接口能工作
  说明它不依赖这些头（或由 DNR 补），本轮未改动。

### 版本

1.63.1 → 1.63.2（manifest / constants / content.js / page-bridge / 测试夹具同步）。

### 测试

```
已跑通的 20 个套件（含 bili-test）共 1296 项断言全部通过
浏览器相关套件（CSP / FFmpeg / M4A / MP4）未在本机跑
```

---

## 第八十二轮（1.63.3）—— 音频下载入口归一；总结的「先校对」变成可见事实

### 1. 音频下载只剩一个入口

上一轮记录了两条入口，这一轮合并：

* `audio.range` 现在同时接受 `{start,end}`（分块）与 `{range}`（整条，如 `bytes=0-`），
  并把 range 串原样透传给页面桥。
* `original-audio` 的整条音轨下载不再自己 `page.call fetchAudioRange`，
  而是走 `audio.range` —— 于是自动获得「页面优先、页面不可用退后台」的兜底，
  以及统一的 403 / 200+HTML → `audio-forbidden` 分类。
* 后台兜底 `fetchAudioChunk` 的返回值补上 `ok: true`，两条路径的返回形状一致。

为什么以前会分成两条：整条直传是后加的，当时只想着「能拿到字节」，
就顺手用了最直接的 `page.call`。结果同一个「下载失败」在两条路径上
会给出不同的错误类型，排查时得先分清走的是哪条。

### 2. 总结按钮如实说明代价

* 主按钮现在按设置显示「生成总结（先校对）」或「生成总结」，
  tooltip 也写明「想跳过点 ⚡ 快速总结」。
* 修掉一个串开关的 bug：校对条件里原来还要求 `capSearch.searchOn`
  （即「对话时自动联网」），用户一关对话自动联网，总结的校对也跟着停了。
  现在只看 `verifyOnSummary` + 检索是否可用。
* `totalSteps` 改为按**本次是否真的校对**计算（3 或 2），
  设置里关闭校对时不会再显示「第 1/3 步」这种对不上的进度。

### 3. 版本与测试

1.63.2 → 1.63.3。

```
panel-test 418 项、bg-test 66 项、content-test 96 项、flow2 39 项、asr 263 项
其余 node 套件同上轮；浏览器相关套件未在本机跑
```

---

## 第八十三轮（1.63.4）—— 去掉重复刷新与最后一批「假请求头」

### 1. 候选为空时不再重复刷新 playurl

`collectAudioCandidates` 本身已经用当前身份主动刷过一次 playurl；
`collectAudioCandidatesWithRefresh` 在结果为空时又原样刷了第二次 —— 同一请求、同一身份，
立刻重试没有意义，只会多打一次接口、多一条误导性的诊断。

* `collectAudioCandidates(ident, meta)` 现在把刷新结果（`ok/code/message/count/attempted`）
  通过 `meta.refresh` 带出去；
* 上层据此填 `diag.refreshed`，并在 `attempted` 为真且候选仍为空时直接返回
  （`stage: '跳过重复刷新'`）；
* 只有「没有 cid、上次根本没刷」的情况才会走到补刷分支；
* 顺带删掉从未被读取的 `verifiedList`（死变量）。

### 2. `bili.js` 不再伪造 Referer / UA

`headerFor()` 以前返回 `User-Agent` + `Referer` + `Accept`。前两个在 service worker 的
fetch 里要么被静默丢弃（Referer 是 forbidden header），要么交给浏览器更可靠（UA）。
现在只带 `Accept`，接口鉴权继续依赖 cookie + wbi 签名。

测试同步改成断言「**不**发送 forbidden 的 Referer/UA，但带 Cookie 凭证」——
这样以后再有人加回这些头，测试会失败，而不是让死代码悄悄复活。

### 3. 版本与测试

1.63.3 → 1.63.4。

```
content/harvest/sniff/bili/bg/panel/asr 全部通过
panel 418、bg 66、content 97、flow2 39、asr 263
```

---

## 第八十四轮（1.63.5）—— 嗅探缓存不再无限增长

`subtitleSniff.items` / `audioSniff.items` 是**页面级**的 Map，
用户可以在同一个 B 站标签页里连刷几十个视频，而每条字幕正文（几百 KB）
都会留在内存里。以前只增不减，属于典型的慢性泄漏。

* `trimSniffMap(map, max)`：超过上限时按 `at` 淘汰最旧的条目；
  字幕保留 32 条、音轨保留 16 条 —— 旧视频的正文本来也不会再被采用
  （采用前会按当前签名过滤），淘汰它们是安全的。
* 单条字幕正文超过 4MB 时直接忽略：正常字幕远小于这个量级，
  更大的更可能是误命中的接口/页面，不值得常驻内存。
* 测试断言：两个 Map 的写入路径都必须调用 `trimSniffMap`。

### 版本与测试

1.63.4 → 1.63.5。content-test 98 项，其余套件同上轮。

---

## 第八十五轮（1.63.6）—— 联网搜索：接入 DeepSeek 官方搜索，并修掉「搜一堆没用的」

### 为什么之前搜出来的东西弱

不是「没联网」，而是**拿到的东西本身就差**：

1. 默认平台 Tavily 没填 Key → 实际走免费引擎的 HTML 解析，只拿到标题 + 一两句摘要；
2. 结果按引擎原始顺序截前 6 条，没有去重、没有重排、没有权威度/时间；
3. 进入上下文时只用了 `snippet`（900 字），把 Provider 给的 `summary` 直接丢了；
4. 查询词是用户的整句口语（「帮我查一下…」），没有清理；
5. 自动检索的触发词太宽（「为什么 / 多少 / 对比 / 区别 / 资料」），大量本该由字幕回答的问题也去搜，自然显得噪声大。

### 接入 DeepSeek 官方搜索（2026-10 上线的 Search API）

* 端点 `POST https://api.deepseek.com/v1/tools/search`，与对话同一把 Bearer Key；
* 平台定义 `deepseek-search`，`reuseAiKey: 'deepseek'` —— **复用 AI 平台里的 DeepSeek Key**，
  用户不用填第二遍；没配 Key 时仍按老规则落到免费引擎兜底；
* 请求带 `query / count / ori_question / need_content`：
  * `ori_question` 是原问题，帮助查询理解；
  * `need_content` 跟随「抓取页面正文」开关，为 true 时直接带回正文，省掉逐条再抓；
  * 时间过滤用官方查询语法 `after:YYYY-MM-DD`（`time-range.js` 映射）；
* 结果保留 `summary / rerank_score / authority / date / site_name`，
  按 `rerank_score → authority` 排序，再去重；
* 正文补抓走官方 `POST /v1/tools/fetch`（返回 Markdown），失败才退回通用「正则去标签」；
* 计费按**成功请求**：$0.75 / 1000 次；失败、空结果不计费。
* 默认 `search.activeId` 改为 `deepseek-search`（老用户配置不会被改，只影响新装）。

### 同时对所有检索平台生效的改进

* 结果统一保留 `summary / site / publishedAt / score / authority`（`sanitizeResult` 也清洗这些字段）；
* 同一 URL 去重后再截断；
* `searchContextBlock` 优先用 `summary`，带站点与发布日期，并加入引用规则
  （只用相关来源、标注 `[来源 N]`、不要编造 URL）；
* 检索词先经 `cleanSearchQuery()` 去掉「帮我查一下 / 请问」等前缀与首尾标点；
* 已有正文的结果不再重复抓取；
* `needsWebSearch` 去掉「为什么 / 多少 / 对比 / 区别 / 资料」这类泛问句触发词，
  「视频里为什么这么说」这类问题不再无脑联网。

### 版本与测试

1.63.5 → 1.63.6。bg-test 新增 DeepSeek 搜索请求/解析/Key 复用/时间过滤/正文抓取断言；
keyless-search-test 新增查询清理与 after 映射；asr-test 补充 summary/site/date 上下文断言。

---

## 第八十六轮（1.63.7）—— UI 体检：按钮、设置项与「点了没反应」

### 设置页

* **「清除」API Key 以前根本清不掉**：空字符串在保存语义里等于「不改动」，
  `mergeSecrets` 会把旧 Key 原样保留。现在用 `apiKeyClear: true` 显式标记，
  保存时真正清空，并在回写前删掉标记。
* **DeepSeek 搜索复用 AI Key 时被显示成「未配 Key」**：新增 `platformKeyState()`，
  把 `reuseAiKey` 解析出的 Key 也算作已配置；Key 输入框提示也区分
  「已保存 / 复用 AI Key / 未配置」。
* 已输入但未保存的 Key 会在重绘（显示/隐藏、切换模型）后留在输入框里；
  以前 `value` 恒为空，点一次就「消失」。
* 设置草稿在没有未保存改动时会跟随外部配置刷新，避免顶栏切主题后设置页仍显示旧值。
* 新增「回车发送消息」开关（`ai.sendOnEnter` 一直存在，但设置页没有入口）。
* 「刷新页面」以前调用 `tab.open` **新开一个标签页**；新增 `tab.reload` RPC，
  现在是真的刷新当前页。
* 批量队列「全部加入」的 toast 以前是「已加入 队列」（计数被空字符串拼掉）。

### 浮层与向导

* 向导是 `dismissable: false`，但以前仍有 ×、Esc 也能关 —— 绕过「跳过 / 完成」后
  `wizardDone` 永远写不进去。现在不可取消的浮层不渲染 ×，Esc 也会被拦住。
* 向导第 1 步「去设置 AI 平台」先渲染再展开分组，点进去看到的是折叠状态；
  顺序改为「切页 → 展开 → 渲染」。

### 生成 / 终止

* `cancel` / `cancel-all` 操作的是 `inflight`，但非流式 RPC 的 controller 注册在
  `externalAborts`，而 `inflight` **从未被写入** —— 这两个接口一直是死代码。
  现在改为操作 `externalAborts`，并在 `handleRpc` 的 `finally` 里清理。
* 长视频「分段总结」走非流式 `ai.chat`，以前点「停止」完全没反应。
  现在每段带 `rid`，停止时按 rid 取消当前请求，并在下一段前检查
  `summaryAbortRequested`；已生成的部分会保留。

### 字幕列表

* 编辑单行时按 Esc 取消，`render()` 移除 textarea 可能触发 blur，
  而 blur 会保存 —— 「取消」反而写入了改动。现在用 `cancelled` 标记拦住。

### 文案

* 顶栏布局按钮标题补上「自动」；自定义接口地址的提示不再一律说
  「需要申请域名权限」；顶部「生成总结」的 tooltip 按当前校对开关显示；
  README 的分组数（14）与字号范围（0.8~1.6）同步。

### 版本与测试

1.63.6 → 1.63.7。panel-test 新增/更新：向导不可 Esc 关闭、清除 Key 语义、
  sendOnEnter 入口、tab.reload、长视频分段总结可终止；共 425 项。

---

## 第八十七轮（1.63.8）—— 校对阶段可终止；清空字幕加确认

### 1. 「生成总结」的校对阶段现在也能停止

以前只有进入「生成」阶段、创建了 stream 之后停止按钮才有意义；
而校对阶段可能连着跑 8 次检索 + 1 次 AI 校正，用户只能干等。

* `generateSummary` 一开始就置 `summaryStreaming/streaming`，停止按钮提前出现；
* `verifyItems` 支持 `shouldAbort`：每条核对前后检查，AbortError 不再被
  「单条失败不影响其它」的 catch 吞掉；
* `proofreadSubtitles` 在核对前、AI 校正前后都检查终止标记；
  AI 校正也带 `rid`，停止时后台能 abort 当前请求；
* `stopStream` 不再要求 `summaryRid` 非空（校对早期还没有 rid）；
* 终止后统一复位状态、结束任务、保留已生成内容。

同时加了并发保护：`generateSummary` 在 `state.streaming` 时直接提示，
避免快捷键或按钮重复触发两次总结。

### 2. 「清空字幕」加二次确认

顶部操作区菜单与字幕面板菜单都改为先弹确认框，文案说明会清掉
字幕 / 校对备份 / 章节 / 统计，并提示可在「历史记录与操作留痕」回退。

### 版本与测试

1.63.7 → 1.63.8。panel-test 新增「校对阶段支持终止」「清空字幕有二次确认」断言，共 428 项。

---

## 第八十八轮（1.63.9）—— 批量队列按钮按状态、来源面板用完整摘要

### 批量队列

* 「暂停 / 继续 / 清空已完成」在队列为空时不再可点；
* 「移除」在处理中的条目上禁用 —— 以前点了只会把它从数组里删掉，
  正在跑的抓取**不会中止**，之后仍会把字幕写回当前面板，属于误导性操作；
  按钮 title 明确提示「可先暂停队列，等这一条完成」；
* 暂停时在队列下方显示一行说明：当前这条会完成，之后不再自动开始下一条；
* 批量输入框内容存进 `ui.batchInput`：排队 / 暂停 / 移除都会重绘设置页，
  以前写了一半的链接会被清空。

### 来源面板

`查看 N 条检索来源` 不再只显示 80 字 `snippet`：

* 优先用 `summary`（DeepSeek 官方搜索会给 600~800 字），回退到 `snippet/content`；
* 带上站点与发布日期（`site · date`）；
* 悬停可看最多 600 字的摘要。

### 版本与测试

1.63.8 → 1.63.9。panel-test 新增批量按钮禁用、批量输入保留与来源面板字段断言，共 431 项。

---

## 第八十九轮（1.63.10）—— 静态审计：死代码、死配置与两个真 bug

### 审计方式

写了一个临时脚本扫描 `src/**/*.js`：跨文件引用计数、同名函数、`defaultSettings` 键引用、
常量导出引用、空 catch、`setInterval`、调试残留。以下结论都经过人工复核。

### 真 bug（已修）

1. **检索缓存键漏了 `oriQuestion`**：`search.provider` 已经把原问题传给 DeepSeek 的
   `ori_question`，但 `ResultCache.keyOf` 没有把它算进 key —— 同一个 query、不同原问题
   会命中同一条缓存。已在 key 里补上。
2. **外部 storage 变更不会让 SW 的设置缓存失效**：`invalidateSettingsCache()` 从来没被调用。
   现在监听 `chrome.storage.onChanged`，设置键变化时清缓存。
3. **检索结果的 URL 没有限制协议**：外部结果若返回 `javascript:` / `data:`，会被原样放进
   来源面板的 `href`。`sanitizeResult` 现在只保留 `http(s)`。

### 死配置（已删）

* `cache.keepAudio`：UI 有开关、storage 有 `putAudioChunk/getAudioChunk`，但**从未被调用**，
  音频分块缓存功能实际不存在。删除开关、默认值与读写函数（保留 `clearAudioChunks` 供清缓存）。
* `prompt.useSystemForSummary`、`optimize.lastAutoApplied`、`search.alwaysVisible`：
  全项目无任何引用，删除。

### 死代码（已删）

`NOOP`、`waitFor`、`pageTypeLabel`、`isVideoLikePage`、`buildToolDescription`、
`activeRuleGroup`、`pickSkillFiles`、`onRuntimeMessage`、`isTwoColumn`、`alertBox`、
`refreshSettings`、`renderActions`、`clamp`、`cancelAll`、`activeLabel`、`inlineToText`、
`resetHeaderRuleCache`，以及只被它们使用的 import。

### 保留的重复（有意为之）

* `page-bridge.js` 里的 MD5 / wbi 实现：MAIN world 是 classic script，不能 import ES module；
* 跨上下文的 base64 编解码：侧边栏 / service worker / 页面桥各有模块边界；
* `original-audio.js` 自带的 `throwIfAborted`：该模块刻意不依赖 `audio.js`（有测试锁定）。

### 版本与测试

1.63.9 → 1.63.10。20 个套件 1331 项断言全部通过；keyless-search-test 增加
「oriQuestion 进缓存键」「非 http(s) URL 被清空」两项。

---

## 第九十轮（1.63.11）—— 扩大联网核对范围，并让总结用上同一批证据

### 起因

用户反馈两点：
1. 联网核对的范围偏小（默认 8 条，且容易只覆盖反复出现的开头术语）；
2. 搜索只在「校对字幕」阶段用，最后生成的总结里看不到任何来源/提示。

### 1. 核对范围

* 默认从 8 条提到 **12 条**（`search.verifyItemCount`），上限从 8 提到 **16**；
* `extractVerifyItems` 改成**按字幕前/中/后段抽样**：先分段各取几个候选，再用全篇结果补齐。
  这样视频后半段的具体数字/术语不会被开头的高频词挤掉；
* 设置页「每次核实几条」的默认值/上限与新逻辑对齐（原来 UI 显示 6、实际跑 8、上限 10 与代码 8 不一致）。

### 2. 总结阶段使用同一批证据

* `proofreadSubtitles` 把 `verify`（条目 + 证据）一并返回；
* 新增 `summaryVerifyBlock()`：把证据以 `[来源 N]` 编号交给总结模型，允许它：
  * 在正文引用来源；
  * 证据与字幕冲突 / 证据不足时提示「（待核实）」并在文末列「⚠️ 待核实」；
  * **仍然禁止**把网页内容扩写成正文；
* 新增 `summarySourcesFooter()`：总结末尾附确定性的来源列表（编号与正文一致），
  设置里可用 `summary.attachSources` 关闭；
* 长视频分段总结只在**最终合并** prompt 里带证据（避免每段重复）。

### 3. 顺带修掉的两个不一致

* `proofreadSubtitles` 不再要求 `cap.searchOn`（「对话时自动联网」）——
  以前关掉对话联网，总结的「先联网校对」会静默退化成纯文本校对；
* 总结的「能力自述」现在按**本轮实际拿到的核对证据**报条数，不再读取上一次手动检索的残留结果。

### 4. 安全

`summaryVerifyBlock` / `verifyContextBlock` 里的外部证据都包进
`<untrusted-web-content>` 边界，并明确要求模型不要执行其中的指令。

### 版本与测试

1.63.10 → 1.63.11。panel-test 新增：分段抽样覆盖结尾、总结证据块/来源列表编号、
默认 12 条与默认附来源、总结阶段拿到证据、校对不再被对话开关卡住；共 442 项。

---

## 第九十一轮（1.63.12）—— 总结去噪：把检索结果“消化”成补充，而不是附来源

### 反馈

1. 总结里附来源、`[来源 N]`、`待核实`、字幕更正清单，显得臃肿；
2. 列出的来源和视频内容联系不大；
3. 想要 DeepSeek 网页版那种“搜索用于补充提醒”的效果，但不需要标来源。

### 改法

* **删掉总结里的检索痕迹**：不再附来源列表、不再要求 `[来源 N]`、不再要求
  「待核实」，也不再往 system 里塞「字幕更正了 N 处」的清单。字幕照常校正，
  但总结只看到校正后的文本。
* **先消化，再交给总结**：新增 `buildSummarySupplement()`——把 12 条证据丢给
  一次轻量 AI 调用，只提炼 **0~3 条**与视频直接相关、证据明确的补充/提醒；
  没有就返回空。总结 prompt 只拿到这几句话，并明确要求自然融入、不要提来源。
* **提高检索相关性**：
  * 中文只出现一次的短词（「正式发布 / 非常便宜」这类）不再作为检索项；
  * 多词查询至少命中两个词才认为相关，减少“只提到一个泛词”的网页混进来；
  * 证据仍按前后段抽样，保留 12 条 / 1~16 的覆盖范围。
* 移除 `summary.attachSources` 设置与 UI；保留简介（默认开）、评论（默认关）。

### 结果

总结正文不再有来源/编号/待核实/更正清单；外部信息以“补充提醒”的方式出现，
不相关就完全不出现。代价是多一次小 AI 调用（约几百 token），但省掉了整段来源列表。

### 版本与测试

1.63.11 → 1.63.12。panel-test 更新为：不再有来源块、总结用 supplement、
中文泛词被过滤；共 439 项。

---

## 第九十二轮（1.64.0）—— 检查更新 + Edge 上架准备

### 更新检查

* 新增 `src/shared/version.js`（数字逐段比较，`1.63.10 > 1.63.9`）与
  `src/background/update.js`（GitHub Releases API、24 小时缓存、手动绕过缓存）。
* 新增 `update.check` / `update.state` RPC；service worker 启动时检查一次，
  并用 `chrome.alarms` 每 24 小时检查一次。
* 设置 → 诊断与关于新增「版本更新」：当前/最新版本、上次检查、自动检查开关、
  检查更新、打开下载页、可折叠的新版本说明。

### 已知限制（重要）

GitHub 仓库目前是 **private**，匿名调用 Releases API 会返回 404。因此：

* 目前只有仓库所有者（或加了 Token 的请求）能真正拿到版本；
* 要让所有用户都能自动检查，需要把仓库改成 **public**（已扫描提交历史，只有测试占位 Key）；
* 商店版由 Edge 自动更新，不依赖这个检查。

### Edge 上架准备

* `content_scripts.matches` 从 `*://*/*` 收窄为 `*://*.bilibili.com/*`，
  避免 Edge 按「读取所有网站」提示权限；`include_globs` 删除。
* 新增 `alarms` 权限；构建模块 17 → 19。
* 新增根目录 `PRIVACY.md`（隐私政策底稿）。
* 新增 `docs/EDGE-STORE.md`：商店描述、权限理由、隐私表单答案、认证备注、素材清单。
* 实际提交必须由账号持有人登录 Partner Center 完成（涉及微软账号与服务协议），
  代码侧只能准备到「上传包 + 文案」为止。

### 版本与测试

1.63.12 → 1.64.0。新增 `update-test.mjs`（版本比较 + 接线检查）；共 17 项。
全量 21 个 node 套件、1356 项断言通过。

---

## 第九十四轮（1.64.2）—— 放弃 Edge 商店，回到 GitHub Releases

### 背景

尝试走 Edge 商店，但 Partner Center 的注册/入口不顺利，作者决定不上了；
改为 **GitHub 公开仓库 + Releases** 分发与更新。

### 改动

* 项目仓库从 private 改回 **public**；
* 恢复 1.64.0 的 GitHub 更新检查（`update.js` / `version.js` / `update-test.mjs`）：
  * 每天自动检查、手动检查、24 小时缓存、版本说明、打开下载页；
* 版本 1.64.0 → **1.64.2**（1.64.1 是 private/Edge 方向的中间提交，未发布）；
* `docs/EDGE-STORE.md` 保留，但注明 Edge 上架暂缓；
* 隐私政策仍用公开 gist，GitHub 公开后仓库内的 `PRIVACY.md` 也可访问。

### 版本与测试

1.64.0 → 1.64.2。恢复 `update-test.mjs`；全量 21 个 node 套件、1356 项断言通过。

---

## 第九十五轮（2.0.0）—— 公开前的仓库整理

### 背景

作者是刚开始用 GitHub / AI 编程的个人开发者，担心仓库“乱”影响后续贡献者。
结论是仓库本身不乱（106 个文件、11MB），不需要新建仓库；只做结构整理与许可证补齐。

### 改动

* 加 **MIT LICENSE**（只覆盖本项目代码）；
* 加 **THIRD-PARTY-NOTICES.md**：确认 `ffmpeg-core.wasm` 是 `--enable-gpl` + libx264/libx265
  的 GPL-2.0-or-later 构建，附 GPL 全文与源码入口；
* 加 **CONTRIBUTING.md**（环境、测试、PR 约定）；
* `docs/DEVELOPMENT-LOG.md` → `docs/history/DEVELOPMENT-LOG.md`，并更新所有链接；
* `verify/` 的三个开发工具移到 `verify/tools/`，同步修正相对路径与提示；
* 删除一次性的 `verify/setup-github.ps1` 和读取本机 Cherry Studio 配置的 `inspect-cherry.mjs`；
* README 增加许可证、贡献、非官方声明与文档索引；
* 版本 1.64.2 → **2.0.0**（保持高于 1.64.2，避免更新检查把版本当降级）。

### 版本与测试

2.0.0。20 个 node 测试套件 + 更新检查套件、1356 项断言通过。

---

## 第九十六轮（2.0.1）—— 侧边栏视觉升级

### 改法

* 不改 DOM 与布局链，只在 `panel.css` 末尾加一层视觉覆盖：
  顶栏品牌细线、标签渐变选中态、按钮/输入框/卡片/提示块/气泡/任务条圆角与阴影、
  设置卡片化、区块标题左侧色条、字幕选中渐变、细滚动条、键盘焦点环。
* 第一次加完按钮 padding 从 4/10 变成 5/11，360px 下超长标题被挤多一行；
  `layout-check` 直接报 `普通 81px vs 超长 104px`。把 padding 恢复为 4/10 后通过。
* 另外修了 CSS 覆盖顺序：基础 `.btn` 不能覆盖 `.btn-sm` / `.btn-danger` / `.btn-accent`；
  `.pill` 不能覆盖 `.pill-brand` / `.pill-warn`。

### 版本与测试

2.0.0 → 2.0.1。20 个 node 套件 1356 项 + 布局体检 5 项通过。

---

## 第九十七轮（2.0.2）—— 评论 aid 修复 + 更新小圆点

### 修复

* `fetchTopComments` 原来用 `oid = aid || bvid`。B 站 `/x/v2/reply` 的 `oid`
  只接受数字 aid，缺 aid 时把 BV 号传过去会查不到评论。现在：
  * 有 aid 直接用；
  * 只有 bvid 时先请求 `/x/web-interface/view?bvid=` 换 aid；
  * 换不到返回明确原因，不再假装成功。
* 用户开启「带上热门评论」但接口返回 `ok:false` 或抛错时，总结前会提示
  「评论获取失败，已跳过」，不再静默少一块上下文。

### 改进

* 自动更新检查发现新版本时，设置 Tab 和齿轮按钮显示小圆点；
  手动检查发现新版也会同步。

### 版本与测试

2.0.1 → 2.0.2。20 个 node 套件 1356 项 + 布局体检 5 项通过。

---

## 第九十八轮（2.1.0）—— 批量取消、搜索可中断、长视频背景

### 批量取消

* `runBatchQueue` 为每个运行中的条目建 `AbortController`，signal 透传给
  `harvestSubtitles`；新增 `batchCancel(id)`：
  * 排队中：直接移除；
  * 运行中：状态变 `cancelling`，abort 当前抓取；
  * 结束后状态 `cancelled`，队列继续下一条。
* 取消/失败也统一在 `finally` 里 `batch.release`，不再泄漏 resolve 打开的标签页。
* 移除运行中条目不再静默删数组，改为调用取消。

### 校对搜索可中断

* `runProviderSearch` 把 `rid` 传给 `search.provider`；后台本来就有
  `registerExternalAbort`，只是客户端没传。
* `proofreadSubtitles` 在搜索开始前就建好 `proofRid` 并写到 `state.summaryRid`，
  搜索和后续 AI 校正共用同一个 rid；点停止能 abort 当前检索。

### 长视频背景

* `summarizeInChunks` 新增 `chunkContext`，把简介/评论压到 900 字后放进每一段
  `chunkUserPrompt`；最后合并仍用完整 `extraContext`。

### 版本与测试

2.0.2 → 2.1.0。20 个 node 套件 1362 项 + 布局体检 5 项通过。补了
`fetchTopComments` 的 bvid→aid 回归（3 项），避免这次修完又退化。

---

## 第九十九轮（2.2.0）—— AI 生成检索词

### 起因

规则抽取的「术语」能过滤泛词，但遇到「正式发布 / 非常重要」这类词仍会搜出无关内容。
更接近 DeepSeek 网页版的做法是：先根据视频标题和字幕生成几条具体 query，再逐条搜。

### 改法

* `buildSearchQueries()`：标题 + 字幕开头/中间/结尾节选（约 3600 字）→ AI 生成
  3~6 条查询，要求包含人名/产品/数字/版本；失败或空结果回退 `extractVerifyItems()`。
* `parseSearchQueries()`：兼容 JSON 数组、`{queries:[]}`、编号/项目符号行；
  过滤 URL、空话、重复项；**不**把「6710 亿」这种数字开头的查询误当列表编号。
* 设置页说明改为「AI 生成查询；失败时用兜底数量」。
* 第一次实现时正则把数字开头的查询前缀吃掉了，panel-test 直接抓出来，
  改成只匹配 `- / 1. / (1)` 这类真正的列表前缀。

### 版本与测试

2.1.0 → 2.2.0。20 个 node 套件 1366 项 + 布局体检 5 项通过；
新增 4 项解析/接线断言。

---

## 第一百轮（2.3.0）—— 跳过此版本

### 改法

* `settings.update.skipVersion` 记录要跳过的版本。
* `checkForUpdate` 计算 `skipped = latest === skipVersion`；
  `hasUpdate` 再与 `!skipped` 相与，小圆点自然消失。
* `setSkippedVersion()` 通过 `patchSettings` 落盘，并清掉 24h 更新缓存；
  `update.skip` RPC 暴露给面板。
* 设置页「版本更新」增加「跳过此版本 / 取消跳过」按钮。
* 缓存命中时也会重新套用 skip，避免跳过之后缓存还显示“有新版”。

### 版本与测试

2.2.0 → 2.3.0。20 个 node 套件 1369 项 + 布局体检 5 项通过。

---

## 第一百零一轮（2.4.0）—— 检索词可见、可补充

### 改法

* `proofreadSubtitles` 把最终使用的 `items` 写进 `store.verifyQueries`，
  总结下方用 `<details>` 展示「本次联网核对的检索词」。
* 设置新增 `search.extraVerifyQueries`（每行一条），与 AI 生成的查询合并、
  去重后最多 12 条；适合补 AI 漏掉的人名/产品名。
* 切换视频、恢复历史结果时清空 `verifyQueries`，避免显示上一轮的词。
* 仍未展示“查询 → 证据”的对应关系，只展示词本身。

### 版本与测试

2.3.0 → 2.4.0。20 个 node 套件 1372 项 + 布局体检 5 项通过。

---

## 第一百零二轮（2.5.0）—— 查询 → 证据映射

### 改法

* `proofreadSubtitles` 搜索完成后生成 `verifyEvidence`：
  `{ q, count, titles }`，与 `verifyQueries` 一起写入 store。
* 总结下方折叠块从「词列表」升级为「词 · N 条证据 · 第一个证据标题」；
  0 条证据的查询会明确显示，便于区分「词不对」和「结果被相关性过滤」。
* 切换视频 / 恢复历史时同时清空 `verifyEvidence`。

### 版本与测试

2.4.0 → 2.5.0。20 个 node 套件 1373 项 + 布局体检 5 项通过。

---

## 第一百零三轮（2.6.0）—— 批量解析阶段可中止

### 改法

* 客户端 `batch.resolve` 带 `rid = batch_<itemId>`；取消时通过 `cancel` RPC
  abort 后台的 external controller。
* 后台新增 `abortable(promise, signal)`：取消立即 reject，底层 Promise 晚完成也不覆盖。
* `waitTabComplete` 接收 signal，取消时立刻结束等待并清理定时器/监听器。
* 开标签页后依次检查 signal；等待加载、注入脚本、读取 getInfo/getSubtitles
  都可中止；取消仍会走 catch 里的 remove tab。
* 客户端 `batchCancel` 同时 abort 本地 signal 和后台 rid。

### 版本与测试

2.5.0 → 2.6.0。20 个 node 套件 1374 项 + 布局体检 5 项通过。

---

## 第一百零四轮（2.7.0）—— 证据可点、权限可撤销

### 证据标题可点击

* `verifyEvidence` 增加 `items: {title,url}`；总结下方每个证据标题渲染为
  `a.verify-link`，点击走 `tab.open` 打开来源（避免页面内导航）。
* 仍然只展示前 2 条证据，避免列表膨胀。

### 域名权限可撤销

* 新增 `revokeOriginPermission()` 与 `permission.revoke` RPC。
* 诊断浮层「已授权域名」每个域名旁加「撤销」；成功移除后行消失，
  必需权限返回 `removed:false`，提示无法撤销。
* 注意：`optional_host_permissions` 不能收窄成“不声明、运行时任意申请”——
  Chrome 要求申请的 origin 必须先声明；实际授权仍只在用户填地址并确认时发生。

### 版本与测试

2.6.0 → 2.7.0。20 个 node 套件 1376 项 + 布局体检 5 项通过。