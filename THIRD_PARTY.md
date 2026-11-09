# 语音与课程来源

程序不包含收费语音 API、密钥、绑卡或订阅流程。语音模型在访问者设备运行；网页只下载资源，练习录音不上传。

- sherpa-onnx v1.12.23，Apache-2.0：[官方项目](https://github.com/k2-fsa/sherpa-onnx/tree/v1.12.23)。许可证在 vendor/LICENSE。打包的 runtime 移除了旧模型 .data 自动预加载段，改为加载下列粤语微调模型；保留其余 runtime/API。
- WSYue / SenseVoice int8 2025-09-09：[上游模型卡与 Apache-2.0 说明](https://huggingface.co/ASLP-lab/WSYue-ASR)，[ONNX 转换发布](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09)。237,115,547 bytes，SHA256 12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d。为静态托管分割成15片，浏览器重组并校验，没有修改模型权重。
- 香港语言学学会[粤拼方案](https://jyutping.org/jyutping/)。课程使用粤拼，未转载其示范录音。

共享网页调用访问者自己的系统粤语音色。未把 Mac Sinji 生成的个人练习音频打包公开。没有粤语音色的设备需自行添加后使用听音任务。

内容识别一致不证明发音准确。当前无可靠的声母、韵母、韵尾或整句自然度评分。单字模块仅观察音高走势；自由对话只记录练习。合成音、自动转写和课程草稿均可能有误，课程未逐句经过母语教师审听。45分钟为课程目标，尚未完成真实用户计时试学。
