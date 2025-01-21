from flask import Flask, render_template, request, jsonify
import os
import asyncio
import base64
import gzip
import hmac
import json
import uuid
import wave
from hashlib import sha256
from io import BytesIO
from urllib.parse import urlparse
import websockets
import time

# 创建异步 Flask 应用
app = Flask(__name__)

# 确保 Flask 支持异步视图
from flask.json import jsonify as async_jsonify
def jsonify(*args, **kwargs):
    return async_jsonify(*args, **kwargs)

# 火山引擎配置
from config import VOLC_ACCESS_KEY, VOLC_SECRET_KEY, VOLC_APPID, VOLC_CLUSTER

# 协议相关常量
PROTOCOL_VERSION = 0b0001
CLIENT_FULL_REQUEST = 0b0001
CLIENT_AUDIO_ONLY_REQUEST = 0b0010
NO_SEQUENCE = 0b0000
NEG_SEQUENCE = 0b0010
JSON_FORMAT = 0b0001
GZIP_COMPRESSION = 0b0001

def generate_header(
    version=PROTOCOL_VERSION,
    message_type=CLIENT_FULL_REQUEST,
    message_type_specific_flags=NO_SEQUENCE,
    serial_method=JSON_FORMAT,
    compression_type=GZIP_COMPRESSION,
    reserved_data=0x00,
):
    """生成协议头"""
    header = bytearray()
    header.append((version << 4) | 0x01)  # header size = 1
    header.append((message_type << 4) | message_type_specific_flags)
    header.append((serial_method << 4) | compression_type)
    header.append(reserved_data)
    return header

def generate_audio_header(last=False):
    """生成音频数据的协议头"""
    return generate_header(
        message_type=CLIENT_AUDIO_ONLY_REQUEST,
        message_type_specific_flags=NEG_SEQUENCE if last else NO_SEQUENCE
    )

def read_wav_info(wav_data: bytes):
    """读取WAV文件信息"""
    try:
        with BytesIO(wav_data) as wav_io:
            with wave.open(wav_io, 'rb') as wav_file:
                nchannels = wav_file.getnchannels()
                sampwidth = wav_file.getsampwidth()
                framerate = wav_file.getframerate()
                nframes = wav_file.getnframes()
                # 读取原始音频数据
                raw_data = wav_file.readframes(nframes)
                print(f"WAV info: channels={nchannels}, width={sampwidth}, rate={framerate}, frames={nframes}")
                return nchannels, sampwidth, framerate, nframes, raw_data
    except Exception as e:
        print(f"Error reading WAV file: {str(e)}")
        raise

def parse_response(response_data):
    """解析响应数据"""
    try:
        if isinstance(response_data, bytes):
            # 打印原始数据的前几个字节，帮助调试
            print(f"Raw response first 16 bytes: {response_data[:16].hex()}")
            
            header_size = response_data[0] & 0x0f
            compression_type = response_data[2] & 0x0f
            payload = response_data[header_size * 4:]
            
            # 只有当压缩标志为GZIP_COMPRESSION时才解压
            if compression_type == GZIP_COMPRESSION and len(payload) > 0:
                try:
                    payload = gzip.decompress(payload)
                except gzip.BadGzipFile:
                    print("Warning: Failed to decompress as gzip, treating as uncompressed")
            
            try:
                # 尝试不同的编码方式
                encodings = ['utf-8', 'utf-16', 'utf-16-le', 'utf-16-be', 'ascii']
                decoded_text = None
                
                for encoding in encodings:
                    try:
                        if isinstance(payload, bytes):
                            decoded_text = payload.decode(encoding)
                            print(f"Successfully decoded with {encoding}")
                            break
                    except UnicodeDecodeError:
                        continue
                
                if decoded_text is None:
                    # 如果所有编码都失败了，尝试直接解析字节
                    return {"code": 0, "message": "success"}
                
                return json.loads(decoded_text)
            except json.JSONDecodeError as je:
                print(f"Warning: Failed to parse JSON: {je}")
                # 如果是初始响应，返回成功状态
                if len(payload) < 10:  # 通常初始响应很短
                    return {"code": 0, "message": "success"}
                return {"code": -1, "message": "Failed to parse response"}
        else:
            return json.loads(response_data)
    except Exception as e:
        print(f"Error parsing response: {str(e)}")
        # 如果是初始响应，返回成功状态
        if isinstance(response_data, bytes) and len(response_data) < 10:
            return {"code": 0, "message": "success"}
        return {"code": -1, "message": f"Parse error: {str(e)}"}

class AsrClient:
    def __init__(self):
        self.appid = VOLC_APPID
        self.token = VOLC_ACCESS_KEY
        self.cluster = VOLC_CLUSTER
        self.ws_url = "wss://openspeech.bytedance.com/api/v2/asr"
        self.seg_duration = 200  # 分片时长(ms)
        
    def construct_request(self, reqid):
        return {
            'app': {
                'appid': self.appid,
                'cluster': self.cluster,
                'token': self.token,
            },
            'user': {
                'uid': 'web_demo'
            },
            'request': {
                'reqid': reqid,
                'workflow': 'audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate',
                'language': 'zh-CN',
                'result_type': 'full'
            },
            'audio': {
                'format': 'wav',
                'rate': 16000,
                'channels': 1,
                'bits': 16,
                'codec': 'raw'
            }
        }

    async def _async_process_audio(self, audio_data: bytes):
        try:
            print("Starting ASR process...")
            # 读取音频信息
            nchannels, sampwidth, framerate, nframes, raw_data = read_wav_info(audio_data)
            
            # 验证音频格式
            if nchannels != 1 or sampwidth != 2 or framerate != 16000:
                raise ValueError(f"Invalid audio format: channels={nchannels}, width={sampwidth}, rate={framerate}")
            
            # 生成请求ID
            reqid = str(uuid.uuid4())
            request_params = self.construct_request(reqid)
            print(f"Request params: {request_params}")
            
            # 构建初始请求
            payload_bytes = str.encode(json.dumps(request_params))
            compressed_payload = gzip.compress(payload_bytes)
            
            full_request = bytearray(generate_header())
            full_request.extend(len(compressed_payload).to_bytes(4, 'big'))
            full_request.extend(compressed_payload)
            
            headers = {'Authorization': f'Bearer; {self.token}'}
            final_result = None
            
            async with websockets.connect(self.ws_url, extra_headers=headers) as ws:
                # 发送初始请求
                print("Sending initial request...")
                await ws.send(bytes(full_request))
                
                # 接收初始响应
                init_response = await ws.recv()
                print(f"Initial response received: {init_response}")
                
                # 发送音频数据
                print(f"Sending audio data, size: {len(raw_data)}")
                audio_request = bytearray(generate_audio_header(last=True))
                audio_request.extend(len(raw_data).to_bytes(4, 'big'))
                audio_request.extend(raw_data)
                await ws.send(bytes(audio_request))
                
                # 接收结果
                timeout = 10  # 设置10秒超时
                start_time = time.time()
                
                try:
                    while time.time() - start_time < timeout:
                        try:
                            response = await asyncio.wait_for(ws.recv(), timeout=2.0)
                            print(f"Received raw response: {response[:100] if isinstance(response, bytes) else response}")
                            
                            if isinstance(response, bytes):
                                header_size = response[0] & 0x0f
                                payload = response[header_size * 4:]
                                try:
                                    result = json.loads(payload)
                                    print(f"Parsed result: {result}")
                                    if result.get('payload_msg', {}).get('text'):
                                        final_result = result
                                        break  # 获取到文本结果后退出
                                except json.JSONDecodeError:
                                    print(f"Failed to decode response: {payload[:100]}")
                            else:
                                try:
                                    result = json.loads(response)
                                    print(f"Parsed result: {result}")
                                    if result.get('payload_msg', {}).get('text'):
                                        final_result = result
                                        break  # 获取到文本结果后退出
                                except json.JSONDecodeError:
                                    print(f"Failed to decode response: {response[:100]}")
                                    
                        except asyncio.TimeoutError:
                            print("Timeout waiting for response, retrying...")
                            continue
                            
                except websockets.exceptions.ConnectionClosed as e:
                    print(f"WebSocket connection closed: {e}")
                    if not final_result:
                        raise Exception("Connection closed without receiving result")
                
                if not final_result:
                    raise Exception("No valid result received within timeout")
                
                return final_result
                
        except Exception as e:
            print(f"ASR Error: {str(e)}")
            import traceback
            print("ASR Traceback:")
            print(traceback.format_exc())
            raise

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/convert', methods=['POST'])
async def convert():
    try:
        if 'audio' not in request.files:
            print("Error: No audio file in request")
            return jsonify({'error': '没有收到音频文件'}), 400
        
        audio_file = request.files['audio']
        print(f"Received audio file: {audio_file.filename}, Content-Type: {audio_file.content_type}")
        
        # 保存临时文件
        temp_path = 'temp_audio.wav'
        audio_file.save(temp_path)
        
        # 检查文件大小
        file_size = os.path.getsize(temp_path)
        print(f"Saved temporary file: {temp_path}, size: {file_size} bytes")
        
        try:
            # 尝试读取音频数据
            with open(temp_path, 'rb') as f:
                audio_data = f.read()
                print(f"Read audio data, first 32 bytes: {audio_data[:32]}")
                
                # 检查文件头
                if len(audio_data) >= 4:
                    header = audio_data[:4]
                    print(f"File header: {header}")
                    if header != b'RIFF':
                        print(f"Invalid WAV header: expected 'RIFF', got {header}")
            
            # 创建 ASR 客户端并处理音频
            asr_client = AsrClient()
            result = await asr_client._async_process_audio(audio_data)
            print(f"ASR result: {result}")
            
        except wave.Error as we:
            print(f"Wave file error: {str(we)}")
            raise
        except Exception as e:
            print(f"Error processing audio data: {str(e)}")
            raise
        finally:
            # 删除临时文件
            if os.path.exists(temp_path):
                # os.remove(temp_path)
                print(f"Removed temporary file: {temp_path}")
        
        if result:
            text = result.get('payload_msg', {}).get('text', '')
            if not text:
                text = result.get('text', '')
            print(f"Extracted text: {text}")
            
            if not text:
                return jsonify({
                    'success': False,
                    'error': '未能识别出文字'
                }), 500
            
            return jsonify({
                'success': True,
                'text': text
            })
        else:
            print("No result from ASR service")
            return jsonify({
                'success': False,
                'error': '转换失败'
            }), 500
            
    except Exception as e:
        error_msg = f"Convert Error: {str(e)}"
        print(error_msg)
        import traceback
        print("Traceback:")
        print(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True) 