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
from enum import Enum
from config import VOLC_ACCESS_KEY, VOLC_SECRET_KEY, VOLC_APPID, VOLC_CLUSTER

app = Flask(__name__)

# 完整复制 offical_demo.py 的所有内容
PROTOCOL_VERSION = 0b0001
DEFAULT_HEADER_SIZE = 0b0001
PROTOCOL_VERSION_BITS = 4
HEADER_BITS = 4
MESSAGE_TYPE_BITS = 4
MESSAGE_TYPE_SPECIFIC_FLAGS_BITS = 4
MESSAGE_SERIALIZATION_BITS = 4
MESSAGE_COMPRESSION_BITS = 4
RESERVED_BITS = 8

CLIENT_FULL_REQUEST = 0b0001
CLIENT_AUDIO_ONLY_REQUEST = 0b0010
SERVER_FULL_RESPONSE = 0b1001
SERVER_ACK = 0b1011
SERVER_ERROR_RESPONSE = 0b1111

NO_SEQUENCE = 0b0000
POS_SEQUENCE = 0b0001
NEG_SEQUENCE = 0b0010
NEG_SEQUENCE_1 = 0b0011

NO_SERIALIZATION = 0b0000
JSON = 0b0001
THRIFT = 0b0011
CUSTOM_TYPE = 0b1111

NO_COMPRESSION = 0b0000
GZIP = 0b0001
CUSTOM_COMPRESSION = 0b1111

def generate_header(
    version=PROTOCOL_VERSION,
    message_type=CLIENT_FULL_REQUEST,
    message_type_specific_flags=NO_SEQUENCE,
    serial_method=JSON,
    compression_type=GZIP,
    reserved_data=0x00,
    extension_header=bytes()
):
    header = bytearray()
    header_size = int(len(extension_header) / 4) + 1
    header.append((version << 4) | header_size)
    header.append((message_type << 4) | message_type_specific_flags)
    header.append((serial_method << 4) | compression_type)
    header.append(reserved_data)
    header.extend(extension_header)
    return header

def generate_full_default_header():
    return generate_header()

def generate_audio_default_header():
    return generate_header(
        message_type=CLIENT_AUDIO_ONLY_REQUEST
    )

def generate_last_audio_default_header():
    return generate_header(
        message_type=CLIENT_AUDIO_ONLY_REQUEST,
        message_type_specific_flags=NEG_SEQUENCE
    )

def parse_response(res):
    protocol_version = res[0] >> 4
    header_size = res[0] & 0x0f
    message_type = res[1] >> 4
    message_type_specific_flags = res[1] & 0x0f
    serialization_method = res[2] >> 4
    message_compression = res[2] & 0x0f
    reserved = res[3]
    header_extensions = res[4:header_size * 4]
    payload = res[header_size * 4:]
    result = {}
    payload_msg = None
    payload_size = 0
    if message_type == SERVER_FULL_RESPONSE:
        payload_size = int.from_bytes(payload[:4], "big", signed=True)
        payload_msg = payload[4:]
    elif message_type == SERVER_ACK:
        seq = int.from_bytes(payload[:4], "big", signed=True)
        result['seq'] = seq
        if len(payload) >= 8:
            payload_size = int.from_bytes(payload[4:8], "big", signed=False)
            payload_msg = payload[8:]
    elif message_type == SERVER_ERROR_RESPONSE:
        code = int.from_bytes(payload[:4], "big", signed=False)
        result['code'] = code
        payload_size = int.from_bytes(payload[4:8], "big", signed=False)
        payload_msg = payload[8:]
    if payload_msg is None:
        return result
    if message_compression == GZIP:
        payload_msg = gzip.decompress(payload_msg)
    if serialization_method == JSON:
        payload_msg = json.loads(str(payload_msg, "utf-8"))
    elif serialization_method != NO_SERIALIZATION:
        payload_msg = str(payload_msg, "utf-8")
    result['payload_msg'] = payload_msg
    result['payload_size'] = payload_size
    return result

def read_wav_info(data: bytes = None) -> (int, int, int, int, int):
    with BytesIO(data) as _f:
        wave_fp = wave.open(_f, 'rb')
        nchannels, sampwidth, framerate, nframes = wave_fp.getparams()[:4]
        wave_bytes = wave_fp.readframes(nframes)
    return nchannels, sampwidth, framerate, nframes, len(wave_bytes)

class AudioType(Enum):
    LOCAL = 1

class AsrWsClient:
    def __init__(self, audio_path, cluster, **kwargs):
        self.audio_path = audio_path
        self.cluster = cluster
        self.success_code = 1000
        self.seg_duration = int(kwargs.get("seg_duration", 15000))
        self.nbest = int(kwargs.get("nbest", 1))
        self.appid = kwargs.get("appid", "")
        self.token = kwargs.get("token", "")
        self.ws_url = kwargs.get("ws_url", "wss://openspeech.bytedance.com/api/v2/asr")
        self.uid = kwargs.get("uid", "streaming_asr_demo")
        self.workflow = kwargs.get("workflow", "audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate")
        self.show_language = kwargs.get("show_language", False)
        self.show_utterances = kwargs.get("show_utterances", False)
        self.result_type = kwargs.get("result_type", "full")
        self.format = kwargs.get("format", "wav")
        self.rate = kwargs.get("sample_rate", 16000)
        self.language = kwargs.get("language", "zh-CN")
        self.bits = kwargs.get("bits", 16)
        self.channel = kwargs.get("channel", 1)
        self.codec = kwargs.get("codec", "raw")
        self.audio_type = kwargs.get("audio_type", AudioType.LOCAL)

    def construct_request(self, reqid):
        req = {
            'app': {
                'appid': self.appid,
                'cluster': self.cluster,
                'token': self.token,
            },
            'user': {
                'uid': self.uid
            },
            'request': {
                'reqid': reqid,
                'nbest': self.nbest,
                'workflow': self.workflow,
                'show_language': self.show_language,
                'show_utterances': self.show_utterances,
                'result_type': self.result_type,
                "sequence": 1
            },
            'audio': {
                'format': self.format,
                'rate': self.rate,
                'language': self.language,
                'bits': self.bits,
                'channel': self.channel,
                'codec': self.codec
            }
        }
        return req

    @staticmethod
    def slice_data(data: bytes, chunk_size: int):
        data_len = len(data)
        offset = 0
        while offset + chunk_size < data_len:
            yield data[offset: offset + chunk_size], False
            offset += chunk_size
        else:
            yield data[offset: data_len], True

    async def segment_data_processor(self, wav_data: bytes, segment_size: int):
        reqid = str(uuid.uuid4())
        request_params = self.construct_request(reqid)
        payload_bytes = str.encode(json.dumps(request_params))
        payload_bytes = gzip.compress(payload_bytes)
        
        full_client_request = bytearray(generate_full_default_header())
        full_client_request.extend((len(payload_bytes)).to_bytes(4, 'big'))
        full_client_request.extend(payload_bytes)
        
        header = {'Authorization': f'Bearer; {self.token}'}
        
        async with websockets.connect(self.ws_url, extra_headers=header, max_size=1000000000) as ws:
            await ws.send(full_client_request)
            res = await ws.recv()
            result = parse_response(res)
            if 'payload_msg' in result and result['payload_msg']['code'] != self.success_code:
                return result
                
            for seq, (chunk, last) in enumerate(AsrWsClient.slice_data(wav_data, segment_size), 1):
                payload_bytes = gzip.compress(chunk)
                audio_only_request = bytearray(generate_audio_default_header())
                if last:
                    audio_only_request = bytearray(generate_last_audio_default_header())
                audio_only_request.extend((len(payload_bytes)).to_bytes(4, 'big'))
                audio_only_request.extend(payload_bytes)
                
                await ws.send(audio_only_request)
                res = await ws.recv()
                result = parse_response(res)
                if 'payload_msg' in result and result['payload_msg']['code'] != self.success_code:
                    return result
        return result

    async def execute(self):
        with open(self.audio_path, mode="rb") as _f:
            data = _f.read()
        audio_data = bytes(data)
        if self.format == "mp3":
            segment_size = self.mp3_seg_size
            return await self.segment_data_processor(audio_data, segment_size)
        if self.format != "wav":
            raise Exception("format should in wav or mp3")
        nchannels, sampwidth, framerate, nframes, wav_len = read_wav_info(audio_data)
        size_per_sec = nchannels * sampwidth * framerate
        segment_size = int(size_per_sec * self.seg_duration / 1000)
        return await self.segment_data_processor(audio_data, segment_size)

async def execute_one_async(audio_item, cluster, **kwargs):
    assert 'id' in audio_item
    assert 'path' in audio_item
    audio_id = audio_item['id']
    audio_path = audio_item['path']
    audio_type = AudioType.LOCAL
    asr_client = AsrWsClient(
        audio_path=audio_path,
        cluster=cluster,
        audio_type=audio_type,
        **kwargs
    )
    result = await asr_client.execute()
    return {"id": audio_id, "path": audio_path, "result": result}

# Flask 路由
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/convert', methods=['POST'])
def convert():
    try:
        if 'audio' not in request.files:
            return jsonify({'error': '没有收到音频文件'}), 400
        
        audio_file = request.files['audio']
        temp_path = 'temp_audio_test.wav'  # 使用和官方示例相同的文件名
        audio_file.save(temp_path)
        
        try:
            # 直接使用官方示例的 test_one 函数
            from offical_demo import test_one
            result_str = test_one()  # 返回的是 JSON 字符串
            result = json.loads(result_str)  # 解析成 Python 对象
            print(f"ASR Result: {result_str}")
            
            if result and isinstance(result, dict):
                # 获取 result.result.payload_msg 中的内容
                payload_msg = result.get('result', {}).get('payload_msg', {})
                if payload_msg.get('code') == 1000:  # 成功状态码
                    text = payload_msg.get('result', [{}])[0].get('text', '')
                    return jsonify({
                        'success': True,
                        'text': text
                    })
            
            return jsonify({
                'success': False,
                'error': '转换失败'
            }), 500
            
        except Exception as e:
            print(f"Error: {str(e)}")
            import traceback
            print(traceback.format_exc())
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
            
        finally:
            if os.path.exists(temp_path):
                # os.remove(temp_path)
                pass
                
    except Exception as e:
        print(f"Error: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True)