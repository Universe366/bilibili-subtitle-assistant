# 开发日志（逐年逐轮的缺陷与修复）

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
