let mediaRecorder;
let audioContext;
let audioInput;
let recorder;
let audioChunks = [];
let isRecording = false;
let recordingTimer;
let startTime;

document.getElementById('recordBtn').addEventListener('click', toggleRecording);

// 将音频数据转换为WAV格式
function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // WAV文件头
    writeString(view, 0, 'RIFF');                     // RIFF标识
    view.setUint32(4, 36 + samples.length * 2, true); // 文件长度
    writeString(view, 8, 'WAVE');                     // WAVE标识
    writeString(view, 12, 'fmt ');                    // fmt chunk
    view.setUint32(16, 16, true);                     // fmt chunk大小
    view.setUint16(20, 1, true);                      // 音频格式 (1 = PCM)
    view.setUint16(22, 1, true);                      // 声道数 (1 = 单声道)
    view.setUint32(24, sampleRate, true);             // 采样率 (16000)
    view.setUint32(28, sampleRate * 2, true);         // 字节率
    view.setUint16(32, 2, true);                      // 块对齐
    view.setUint16(34, 16, true);                     // 位深度
    writeString(view, 36, 'data');                    // data chunk
    view.setUint32(40, samples.length * 2, true);     // 采样数据大小

    // 写入采样数据
    floatTo16BitPCM(view, 44, samples);

    console.log('WAV header:', {
        chunkId: String.fromCharCode(...new Uint8Array(buffer, 0, 4)),
        chunkSize: view.getUint32(4, true),
        format: String.fromCharCode(...new Uint8Array(buffer, 8, 4)),
        sampleRate: view.getUint32(24, true),
        channels: view.getUint16(22, true),
        bitsPerSample: view.getUint16(34, true)
    });

    return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
}

async function toggleRecording() {
    const recordBtn = document.getElementById('recordBtn');
    const recordIcon = recordBtn.querySelector('.record-icon');
    const recordText = recordBtn.querySelector('.record-text');

    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,        // 单声道
                    sampleRate: 16000,      // 采样率
                    sampleSize: 16,         // 采样大小
                    echoCancellation: true, // 回声消除
                    noiseSuppression: true  // 噪声抑制
                }
            });

            // 创建音频上下文
            audioContext = new AudioContext({ 
                sampleRate: 16000,
                latencyHint: 'interactive'
            });
            
            // 创建音频源
            audioInput = audioContext.createMediaStreamSource(stream);
            
            // 创建录音处理器
            const bufferSize = 4096;
            recorder = audioContext.createScriptProcessor(bufferSize, 1, 1);
            audioChunks = [];

            recorder.onaudioprocess = (e) => {
                const samples = e.inputBuffer.getChannelData(0);
                // 确保采样率
                if (e.inputBuffer.sampleRate !== 16000) {
                    console.warn('Sample rate mismatch:', e.inputBuffer.sampleRate);
                }
                audioChunks.push(new Float32Array(samples));
            };

            audioInput.connect(recorder);
            recorder.connect(audioContext.destination);

            isRecording = true;
            startTime = Date.now();
            updateRecordingTime();
            
            recordBtn.classList.add('recording');
            recordText.textContent = '停止录音';
            showStatus('正在录音...');
            
        } catch (err) {
            console.error('录音失败:', err);
            showStatus('无法访问麦克风，请确保已授予权限');
        }
    } else {
        // 停止录音
        recorder.disconnect();
        audioInput.disconnect();
        
        // 合并所有音频数据
        const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const audioData = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of audioChunks) {
            audioData.set(chunk, offset);
            offset += chunk.length;
        }

        // 转换为WAV格式
        const wavBlob = encodeWAV(audioData, 16000);  // 确保采样率为16kHz
        
        isRecording = false;
        clearInterval(recordingTimer);
        
        recordBtn.classList.remove('recording');
        recordText.textContent = '开始录音';
        showStatus('录音结束，正在转换...');

        // 立即开始转换
        await convertAudio(wavBlob);
    }
}

function updateRecordingTime() {
    const timeDisplay = document.getElementById('recordTime');
    
    recordingTimer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        timeDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }, 1000);
}

async function convertAudio(wavBlob) {
    const progress = document.getElementById('progress');
    progress.style.display = 'block';
    
    const formData = new FormData();
    formData.append('audio', wavBlob, 'recording.wav');

    try {
        const response = await fetch('/convert', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                document.getElementById('result').value = result.text;
                showStatus('转换成功！');
            } else {
                throw new Error(result.error || '转换失败');
            }
        } else {
            throw new Error('服务器错误');
        }
    } catch (err) {
        console.error('转换错误:', err);
        showStatus(err.message || '转换失败，请重试');
    } finally {
        progress.style.display = 'none';
    }
}

function copyResult() {
    const textarea = document.getElementById('result');
    textarea.select();
    document.execCommand('copy');
    showStatus('文本已复制到剪贴板');
}

function showStatus(message) {
    const status = document.getElementById('status');
    status.textContent = message;
    setTimeout(() => {
        status.textContent = '';
    }, 3000);
} 