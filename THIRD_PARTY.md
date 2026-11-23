# 语音与课程来源

程序不包含收费语音 API、密钥、绑卡或订阅流程。语音模型在访问者设备运行；网页只下载资源，练习录音不上传。

- sherpa-onnx v1.12.23，Apache-2.0：[官方项目](https://github.com/k2-fsa/sherpa-onnx/tree/v1.12.23)。许可证在 vendor/LICENSE。打包的 runtime 移除了旧模型 .data 自动预加载段，改为加载下列粤语微调模型；保留其余 runtime/API。
- WSYue / SenseVoice int8 2025-09-09：[上游模型卡与 Apache-2.0 说明](https://huggingface.co/ASLP-lab/WSYue-ASR)，[ONNX 转换发布](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09)。237,115,547 bytes，SHA256 12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d。为静态托管分割成15片，浏览器重组并校验，没有修改模型权重。
- 香港语言学学会[粤拼方案](https://jyutping.org/jyutping/)。课程使用粤拼，未转载其示范录音。

2026-11-23 内置课程音频更新：

- 香港母语音节录音来自[粵音資料集叢](https://github.com/jyutnet/jyutnet-cantonese-syllables)，发音者 kt，源版本 `4f4204b03a3694cb4451ffeda064bc1e6c71629f`。[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 允许分发及商业使用，须保留署名、许可与修改说明。音节录音转为 WAV；逐音节拼接示范及相关改编继续按 CC BY-SA 4.0 提供。它们用于拆音跟读，不能代替自然整句连读；来源方未为本产品背书。
- 整句合成使用 [canto-tts 0.1.4](https://github.com/typangaa/canto-tts) 和 [canto-tts-nano](https://huggingface.co/typangaa/canto-tts-nano)，模型版本 `fe17418a293d9be85685ddf750b0cfef9c88abb4`。SDK 与模型标注 Apache-2.0，基础模型为 OpenMOSS MOSS-TTS-Nano。使用模型默认声线，在制作时于本机生成固定课程音频；不克隆用户声音。模型作者说明训练语料私有且未公开，本项目不能独立审计全部训练来源。
- 内置音频位于 `audio/`，每条来源与内容摘要见 `audio/manifest.json`，实际转换及许可范围见 `audio/README.md` 和 `audio/LICENSE.txt`。用户无需安装系统粤语音色或下载合成模型。Mac Sinji 缓存、个人练习录音均未公开。
- 自动识别仅辅助筛查合成音的漏字、增字；不能由识别文字推断声调正确。真人音节及合成整句是不同示范来源，界面在播放时标注。

内容识别一致不证明发音准确。当前无可靠的声母、韵母、韵尾或整句自然度评分。单字模块仅观察音高走势；自由对话只记录练习。合成音、自动转写和课程草稿均可能有误，课程未逐句经过母语教师审听。45分钟为课程目标，尚未完成真实用户计时试学。
