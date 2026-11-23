# 内置粤语课程示范音

下载后无需安装系统粤语音色，也不需要下载或运行合成模型。所有示范均为固定课程资源，不采集用户声线。每条音频的种类、粤拼、摘要及来源引用见 manifest.json。

## 香港母语音节

署名：**粵音資料集叢**，发音者 kt（香港土生男性）。[原始录音库](https://github.com/jyutnet/jyutnet-cantonese-syllables)，固定版本 `4f4204b03a3694cb4451ffeda064bc1e6c71629f`。

原音节录音及本项目相关改编采用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，允许商业使用、复制和改编，须保留署名、来源及许可，相关改编使用相同许可；[完整条款](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en)。来源方未为本产品背书，原库亦不保证准确性或可靠性。

修改方式：Opus 解码、48 kHz 单声道转为 24 kHz PCM WAV。单音节保留完整录音；逐音节句子仅裁去边界静音并保留100毫秒余量，音节间加入70毫秒间隔，为避免音量跳变，真人片段仅下调音量至 RMS 不高于 0.045；不改变音高或节奏。逐音节拼接文件继续按 CC BY-SA 4.0 提供。清单 sources 列出逐项原文件路径及校验值。

`human-syllable` 是真人音节示范；`human-syllable-sequence` 是逐音节拼读，适合拆音跟读，**不代表自然整句的节奏、连读或语调**。

## 合成整句

[canto-tts 0.1.4](https://github.com/typangaa/canto-tts)、[canto-tts-nano 模型](https://huggingface.co/typangaa/canto-tts-nano)，基础模型 OpenMOSS MOSS-TTS-Nano。SDK和模型标注 Apache-2.0，随包保留许可文本。使用默认声线，原模型未修改；优先输入课程粤拼，未标音的提示用本地 G2P 转换。48 kHz双声道转24 kHz单声道。

合成片段经过自动内容筛查和必要的重生成，未逐条经过母语教师审听。ASR、音量、时长及文件校验不证明声调或音素准确；不要据此作精确发音评分。模型作者说明训练数据私有且未公开，本项目不能独立审计其全部训练来源。
